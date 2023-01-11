import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { EndpointContext } from '../adapter'
import { AdapterConfig } from '../config'
import { makeLogger, sleep } from '../util'
import { PartialSuccessfulResponse, ProviderResult, TimestampedProviderResult } from '../util/types'
import { Requester } from '../util/requester'
import { AdapterDataProviderError, AdapterRateLimitError } from '../validation/error'
import { TransportDependencies, TransportGenerics } from '.'
import { SubscriptionTransport } from './abstract/subscription'
import { Metrics, retrieveCost } from '../metrics'

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
type ProviderRequestConfig<T extends HttpTransportGenerics> = {
  /** The input paramters for requests that will get responses from the request in this struct */
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
   * @param config - the config for this Adapter
   * @returns one or multiple request configs
   */
  prepareRequests: (
    params: T['Request']['Params'][],
    config: AdapterConfig<T['CustomSettings']>,
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
   * @param config - the config for this Adapter
   * @returns a list of ProviderResults
   */
  parseResponse: (
    params: T['Request']['Params'][],
    res: AxiosResponse<T['Provider']['ResponseBody']>,
    config: AdapterConfig<T['CustomSettings']>,
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
    config: AdapterConfig<T['CustomSettings']>,
    endpointName: string,
  ): Promise<void> {
    await super.initialize(dependencies, config, endpointName)
    this.requester = dependencies.requester
  }

  getSubscriptionTtlFromConfig(config: AdapterConfig<T['CustomSettings']>): number {
    return config.WARMUP_SUBSCRIPTION_TTL
  }

  async backgroundHandler(
    context: EndpointContext<T>,
    entries: T['Request']['Params'][],
  ): Promise<void> {
    if (!entries.length) {
      logger.debug(
        `No entries in subscription set, sleeping for ${context.adapterConfig.BACKGROUND_EXECUTE_MS_HTTP}ms...`,
      )
      if (this.WARMER_ACTIVE) {
        // Decrement count when warmer changed from having entries to having none
        Metrics.cacheWarmerCount && Metrics.cacheWarmerCount.labels({ isBatched: 'true' }).dec()
        this.WARMER_ACTIVE = false
      }
      await sleep(context.adapterConfig.BACKGROUND_EXECUTE_MS_HTTP)
      return
    } else if (this.WARMER_ACTIVE === false) {
      // Increment count when warmer changed from having no entries to having some
      Metrics.cacheWarmerCount && Metrics.cacheWarmerCount.labels({ isBatched: 'true' }).inc()
      this.WARMER_ACTIVE = true
    }

    logger.trace(`Have ${entries.length} entries in batch, preparing requests...`)
    const rawRequests = this.config.prepareRequests(entries, context.adapterConfig)
    const requests = Array.isArray(rawRequests) ? rawRequests : [rawRequests]

    // We're awaiting these promises because although we have request coalescing, new entries
    // could be added to the subscription set if not blocking this operation, so the next time the
    // background execute is triggered if the request is for a fully batched endpoint, we could end up
    // with the full combination of possible params within the request queue
    logger.trace(`Sending ${requests.length} requests...`)
    const start = Date.now()
    await Promise.all(requests.map((r) => this.handleRequest(r, context.adapterConfig)))
    const duration = Date.now() - start
    logger.trace(`All requests in the background execute were completed`)

    // These logs will surface warnings that operators should take action on, in case the execution of all
    // requests is taking too long so that entries could have expired within this timeframe
    if (duration > context.adapterConfig.WARMUP_SUBSCRIPTION_TTL) {
      logger.warn(
        `Background execution of all HTTP requests in a batch took ${duration},\
         which is longer than the subscription TTL (${context.adapterConfig.WARMUP_SUBSCRIPTION_TTL}).\
         This might be due to insufficient speed on the selected API tier, please check metrics and logs to confirm and consider moving to a faster tier.`,
      )
    }
    if (duration > context.adapterConfig.CACHE_MAX_AGE) {
      logger.warn(
        `Background execution of all HTTP requests in a batch took ${duration},\
         which is longer than the max cache age (${context.adapterConfig.CACHE_MAX_AGE}).\
         This might be due to insufficient speed on the selected API tier, please check metrics and logs to confirm and consider moving to a faster tier.`,
      )
    }

    return
  }

  private async handleRequest(
    requestConfig: ProviderRequestConfig<T>,
    adapterConfig: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    const results = await this.makeRequest(requestConfig, adapterConfig)

    if (!results.length) {
      logger.trace('Got no results from the request.')
      return
    }

    logger.debug('Setting adapter responses in cache')
    await this.responseCache.write(results)
  }

  private async makeRequest(
    requestConfig: ProviderRequestConfig<T>,
    adapterConfig: AdapterConfig<T['CustomSettings']>,
  ): Promise<TimestampedProviderResult<T>[]> {
    try {
      // The key generated here that we pass to the requester is potentially very long, but we're not considering it an issue given that:
      //   - the requester will store values in memory, so we're not sending the string anywhere
      //   - there's no problems using very large strings as object keys
      //   - there should be a limit on the amount of subscriptions in the set
      const requesterResult = await this.requester.request<T['Provider']['ResponseBody']>(
        requestConfig.params.map((p) => JSON.stringify(p)).join('|'),
        requestConfig.request,
      )

      // Parse responses and apply timestamps
      const results = this.config
        .parseResponse(requestConfig.params, requesterResult.response, adapterConfig)
        .map((r) => {
          const result = r as TimestampedProviderResult<T>
          const partialResponse = r.response as PartialSuccessfulResponse<T['Response']>
          result.response.timestamps = {
            ...requesterResult.timestamps,
            providerIndicatedTime: partialResponse.timestamps?.providerIndicatedTime,
          }
          return result
        })

      // Record cost of data provider call
      const cost = retrieveCost(requesterResult.response.data)
      Metrics.rateLimitCreditsSpentTotal &&
        Metrics.rateLimitCreditsSpentTotal
          .labels({
            feed_id: 'N/A',
            participant_id: WARMUP_BATCH_REQUEST_ID,
          })
          .inc(cost)

      return results
    } catch (e) {
      if (e instanceof AdapterDataProviderError && e.cause instanceof AxiosError) {
        const err = e as AdapterDataProviderError
        const cause = err.cause as AxiosError
        return requestConfig.params.map((entry) => ({
          params: entry,
          response: {
            errorMessage: `Provider request failed with status ${cause.status}: "${cause.response?.data}"`,
            statusCode: 502,
            timestamps: err.timestamps,
          },
        }))
      } else if (e instanceof AdapterRateLimitError) {
        const err = e as AdapterRateLimitError
        return requestConfig.params.map((entry) => ({
          params: entry,
          response: {
            errorMessage: err.message,
            statusCode: 429,
            timestamps: {
              providerDataReceived: 0,
              providerDataRequested: 0,
              providerIndicatedTime: undefined,
            },
          },
        }))
      } else {
        logger.error(e)
        return []
      }
    }
  }
}
