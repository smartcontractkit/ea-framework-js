import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { EndpointContext } from '../adapter'
import * as cacheMetrics from '../cache/metrics'
import { AdapterConfig } from '../config'
import * as rateLimitMetrics from '../rate-limiting/metrics'
import { makeLogger } from '../util'
import { PartialSuccessfulResponse, ProviderResult, TimestampedProviderResult } from '../util/types'
import { Requester } from '../util/requester'
import { AdapterDataProviderError, AdapterRateLimitError } from '../validation/error'
import { TransportDependencies, TransportGenerics } from '.'
import { SubscriptionTransport } from './abstract/subscription'

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
 * Config object that is provided to the BatchWarmingTransport constructor.
 */
export interface HttpTransportConfig<T extends HttpTransportGenerics> {
  prepareRequests: (
    params: T['Request']['Params'][],
    config: AdapterConfig<T['CustomSettings']>,
  ) => ProviderRequestConfig<T> | ProviderRequestConfig<T>[]

  parseResponse: (
    params: T['Request']['Params'][],
    res: AxiosResponse<T['Provider']['ResponseBody']>,
    config: AdapterConfig<T['CustomSettings']>,
  ) => ProviderResult<T>[]
}

/**
 * Transport implementation that takes incoming batches requests and keeps a warm cache of values.
 * Within the setup function, adapter params are added to an set that also keeps track and expires values.
 * In the background execute, the list of non-expired items in the set is fetched.
 * Then, the list is passed through the `prepareRequest` function, that returns an AxiosRequestConfig.
 * The Data Provider response is, they are passed through the `parseResponse` function to create a [[CacheEntry]] list.
 * Finally, the items in that [[CacheEntry]] list are set in the Cache so the Adapter can fetch values from there.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export class HttpTransport<T extends HttpTransportGenerics> extends SubscriptionTransport<T> {
  static shortName = 'http'

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
      logger.debug('No entries in subscription set, skipping')
      if (this.WARMER_ACTIVE) {
        // Decrement count when warmer changed from having entries to having none
        cacheMetrics.cacheWarmerCount.labels({ isBatched: 'true' }).dec()
        this.WARMER_ACTIVE = false
      }
      return
    } else if (this.WARMER_ACTIVE === false) {
      // Increment count when warmer changed from having no entries to having some
      cacheMetrics.cacheWarmerCount.labels({ isBatched: 'true' }).inc()
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
      const cost = rateLimitMetrics.retrieveCost(requesterResult.response.data)
      rateLimitMetrics.rateLimitCreditsSpentTotal
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
