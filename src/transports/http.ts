import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { TransportDependencies, TransportGenerics } from '.'
import { EndpointContext } from '../adapter'
import { calculateHttpRequestKey } from '../cache'
import { metrics, retrieveCost } from '../metrics'
import { makeLogger, sleep } from '../util'
import { Requester } from '../util/requester'
import { PartialSuccessfulResponse, ProviderResult, TimestampedProviderResult } from '../util/types'
import { AdapterDataProviderError, AdapterRateLimitError } from '../validation/error'
import { SubscriptionTransport } from './abstract/subscription'
import { validator } from '../validation/utils'

const WARMUP_BATCH_REQUEST_ID = '9002'

const logger = makeLogger('HttpTransport')

/**
 * Helper struct type that will be used to pass types to the generic parameters of a Transport.
 * Extends the common TransportGenerics, adding Provider specific types for this Batch endpoint.
 */
type HttpTransportGenerics = TransportGenerics & {
  /**
   * Type details for any provider specific interfaces.
   */
  Provider: {
    /**
     * Structure of the body of the request that will be sent to the data provider.
     */
    RequestBody: unknown

    /**
     * Structure for the body of the response coming from the data provider.
     */
    ResponseBody: unknown
  }
}

/**
 * Structure containing the association between EA params and a provider request.
 */
export type ProviderRequestConfig<T extends HttpTransportGenerics> = {
  /** The input parameters for requests that will get responses from the request in this struct */
  params: T['Request']['Params'][]

  /** The request that will be sent to the data provider to fetch values for the params in this struct */
  request: AxiosRequestConfig<T['Provider']['RequestBody']>
}

/**
 * Config object that is provided to the HttpTransport constructor.
 */
export interface HttpTransportConfig<T extends HttpTransportGenerics> {
  /**
   * This method should take the list of currently valid input parameters in the subscription set,
   * and build however many requests to the data provider are necessary to fullfill all the information.
   * Some constranints:
   *   - Each request should be tied to at least one input parameter
   *   - Input parameters should be tied to only one request. You can technically avoid this, but there will be no way
   *     to consolidate many of them since the parseResponse method is called independently for each of them.
   *
   * @param params - the list of non-expired input parameters sent to this Adapter
   * @param adapterSettings - the config for this Adapter
   * @returns one or multiple request configs
   */
  prepareRequests: (
    params: T['Request']['Params'][],
    adapterSettings: T['Settings'],
  ) => ProviderRequestConfig<T> | ProviderRequestConfig<T>[]

  /**
   * This method should take the incoming response from the data provider, and using that and the params, build a
   * list of ProviderResults that will be stored in the response cache for this endpoint.
   * Some notes:
   *   - The results don't technically need to be related to the requested params; you could use the response
   *     and store more items in the cache than what was requested from the EA (be mindful and do this conservatively if at all)
   *   - If no useful information was received, you can return an empty list
   *   - Alternatively, do make use of the fact that a ProviderResult is not necessarily a successful one, and you can store errors too
   *
   * @param params - the list of input parameters that should be fulfilled by this incoming provider response
   * @param res - the response from the data provider
   * @param adapterSettings - the config for this Adapter
   * @returns a list of ProviderResults
   */
  parseResponse: (
    params: T['Request']['Params'][],
    res: AxiosResponse<T['Provider']['ResponseBody']>,
    adapterSettings: T['Settings'],
  ) => ProviderResult<T>[]
}

/**
 * Transport implementation that takes incoming batches of requests and keeps a warm cache of values.
 * Within the setup function, adapter params are added to a set that also keeps track and expires values.
 * In the background execute, the list of non-expired items in the set is fetched.
 * Then, the list is passed through the `prepareRequest` function, that returns an AxiosRequestConfig.
 * The Data Provider response is then passed through the `parseResponse` function to create a [[CacheEntry]] list.
 * Finally, the items in that [[CacheEntry]] list are set in the Cache so the Adapter can fetch values from there.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export class HttpTransport<T extends HttpTransportGenerics> extends SubscriptionTransport<T> {
  // Flag used to track whether the warmer has moved from having no entries to having some and vice versa
  // Used for recording the cache warmer active metrics accurately
  WARMER_ACTIVE = false
  requester!: Requester

  constructor(private config: HttpTransportConfig<T>) {
    super()
  }

  override async initialize(
    dependencies: TransportDependencies<T>,
    adapterSettings: T['Settings'],
    endpointName: string,
    transportName: string,
  ): Promise<void> {
    await super.initialize(dependencies, adapterSettings, endpointName, transportName)
    this.requester = dependencies.requester
  }

  getSubscriptionTtlFromConfig(adapterSettings: T['Settings']): number {
    return adapterSettings.WARMUP_SUBSCRIPTION_TTL
  }

  async backgroundHandler(
    context: EndpointContext<T>,
    entries: T['Request']['Params'][],
  ): Promise<void> {
    if (!entries.length) {
      logger.debug(
        `No entries in subscription set, sleeping for ${context.adapterSettings.BACKGROUND_EXECUTE_MS_HTTP}ms...`,
      )
      if (this.WARMER_ACTIVE) {
        // Decrement count when warmer changed from having entries to having none
        metrics.get('cacheWarmerCount').labels({ isBatched: 'true' }).dec()
        this.WARMER_ACTIVE = false
      }
      await sleep(context.adapterSettings.BACKGROUND_EXECUTE_MS_HTTP)
      return
    } else if (this.WARMER_ACTIVE === false) {
      // Increment count when warmer changed from having no entries to having some
      metrics.get('cacheWarmerCount').labels({ isBatched: 'true' }).inc()
      this.WARMER_ACTIVE = true
    }

    logger.trace(`Have ${entries.length} entries in batch, preparing requests...`)
    const rawRequests = this.config.prepareRequests(entries, context.adapterSettings)
    const requests = Array.isArray(rawRequests) ? rawRequests : [rawRequests]

    // We're awaiting these promises because although we have request coalescing, new entries
    // could be added to the subscription set if not blocking this operation, so the next time the
    // background execute is triggered if the request is for a fully batched endpoint, we could end up
    // with the full combination of possible params within the request queue
    logger.trace(`Sending ${requests.length} requests...`)
    const start = Date.now()
    await Promise.all(requests.map((r) => this.handleRequest(r, context)))
    const duration = Date.now() - start
    logger.trace(`All requests in the background execute were completed`)

    // These logs will surface warnings that operators should take action on, in case the execution of all
    // requests is taking too long so that entries could have expired within this timeframe
    if (duration > context.adapterSettings.WARMUP_SUBSCRIPTION_TTL) {
      logger.warn(
        `Background execution of all HTTP requests in a batch took ${duration},\
         which is longer than the subscription TTL (${context.adapterSettings.WARMUP_SUBSCRIPTION_TTL}).\
         This might be due to insufficient speed on the selected API tier, please check metrics and logs to confirm and consider moving to a faster tier.`,
      )
    }
    if (duration > context.adapterSettings.CACHE_MAX_AGE) {
      logger.warn(
        `Background execution of all HTTP requests in a batch took ${duration},\
         which is longer than the max cache age (${context.adapterSettings.CACHE_MAX_AGE}).\
         This might be due to insufficient speed on the selected API tier, please check metrics and logs to confirm and consider moving to a faster tier.`,
      )
    }

    // We're not sleeping here on purpose. We sleep when there are no entries in the subscription set to avoid polling too
    // frequently, but if we have entries we want the background execute to be re-run ASAP so we can prepare the next batch
    // of requests, and the sleep to rate-limit will be performed by the rate-limiter in the Requester.
    return
  }

  private async handleRequest(
    requestConfig: ProviderRequestConfig<T>,
    context: EndpointContext<T>,
  ): Promise<void> {
    const { results, msUntilNextExecution } = await this.makeRequest(requestConfig, context)

    if (!results.length) {
      logger.trace('Got no results from the request.')
      return
    }

    logger.debug('Setting adapter responses in cache')
    await this.responseCache.write(this.name, results)

    if (msUntilNextExecution) {
      // If we got this, it means that the queue was unable to accomomdate this request.
      // We want to sleep here for a bit, to avoid running into constant queue overflow replacements in competing threads.
      logger.info(
        `Request queue has overflowed, sleeping for ${msUntilNextExecution}ms until reprocessing...`,
      )
      await sleep(msUntilNextExecution)
    }
  }

  private async makeRequest(
    requestConfig: ProviderRequestConfig<T>,
    context: EndpointContext<T>,
  ): Promise<{
    results: TimestampedProviderResult<T>[]
    msUntilNextExecution?: number
  }> {
    try {
      // The key generated here that we pass to the requester is potentially very long, but we're not considering it an issue given that:
      //   - the requester will store values in memory, so we're not sending the string anywhere
      //   - there's no problems using very large strings as object keys
      //   - there should be a limit on the amount of subscriptions in the set
      // Use cache key to avoid coalescing requests across different endpoints
      const requesterResult = await this.requester.request<T['Provider']['ResponseBody']>(
        calculateHttpRequestKey({
          context,
          data: requestConfig.params,
          transportName: this.name,
        }),
        requestConfig.request,
      )

      // Parse responses and apply timestamps
      const results = this.config
        .parseResponse(requestConfig.params, requesterResult.response, context.adapterSettings)
        .map((r) => {
          const result = r as TimestampedProviderResult<T>
          const partialResponse = r.response as PartialSuccessfulResponse<T['Response']>
          if (partialResponse.timestamps?.providerIndicatedTimeUnixMs !== undefined) {
            const timestampValidator = validator.responseTimestamp()
            const error = timestampValidator(partialResponse.timestamps?.providerIndicatedTimeUnixMs)
            if (error) {
              logger.warn(`Provider indicated time is invalid: ${error}`)
            }
          }
          result.response.timestamps = {
            ...requesterResult.timestamps,
            providerIndicatedTimeUnixMs: partialResponse.timestamps?.providerIndicatedTimeUnixMs,
          }
          return result
        })

      // Record cost of data provider call
      const cost = retrieveCost(requesterResult.response.data)
      metrics
        .get('rateLimitCreditsSpentTotal')
        .labels({ feed_id: 'N/A', participant_id: WARMUP_BATCH_REQUEST_ID })
        .inc(cost)

      logger.trace('Storing successful response')
      return { results }
    } catch (e) {
      if (e instanceof AdapterDataProviderError && e.cause instanceof AxiosError) {
        const err = e as AdapterDataProviderError
        const cause = err.cause as AxiosError
        const errorMessage = `Provider request failed with status ${cause.status}: "${cause.response?.data}"`
        logger.info(errorMessage)
        return {
          results: requestConfig.params.map((entry) => ({
            params: entry,
            response: {
              errorMessage,
              statusCode: 502,
              timestamps: err.timestamps,
            },
          })),
        }
      } else if (e instanceof AdapterRateLimitError) {
        const err = e as AdapterRateLimitError
        logger.info(err.message)
        return {
          results: requestConfig.params.map((entry) => ({
            params: entry,
            response: {
              errorMessage: err.message,
              statusCode: 429,
              timestamps: {
                providerDataReceivedUnixMs: 0,
                providerDataRequestedUnixMs: 0,
                providerIndicatedTimeUnixMs: undefined,
              },
            },
          })),
          msUntilNextExecution: err.msUntilNextExecution,
        }
      } else {
        logger.error(e)
        return { results: [] }
      }
    }
  }
}
