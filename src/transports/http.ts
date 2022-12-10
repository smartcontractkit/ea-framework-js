import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { EndpointContext } from '../adapter'
import * as cacheMetrics from '../cache/metrics'
import { AdapterConfig } from '../config'
import * as rateLimitMetrics from '../rate-limiting/metrics'
import { makeLogger } from '../util'
import {
  PartialSuccessfulResponse,
  ProviderResult,
  TimestampedProviderResult,
} from '../util/request'
import { Requester } from '../util/requester'
import { AdapterDataProviderError } from '../validation/error'
import { TransportDependencies, TransportGenerics } from '.'
import { SubscriptionTransport } from './abstract/subscription'

const WARMUP_BATCH_REQUEST_ID = '9002'

const logger = makeLogger('BatchWarmingTransport')

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
    this.requester = new Requester(dependencies.requestRateLimiter, config as AdapterConfig)
  }

  getSubscriptionTtlFromConfig(config: AdapterConfig<T['CustomSettings']>): number {
    return config.WARMUP_SUBSCRIPTION_TTL
  }

  async backgroundHandler(
    context: EndpointContext<T>,
    entries: T['Request']['Params'][],
  ): Promise<void> {
    if (!entries.length) {
      logger.debug('No entries in batch warming set, skipping')
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

    logger.trace(`Have ${entries.length} entries in batch, preparing request...`)
    const rawRequests = this.config.prepareRequests(entries, context.adapterConfig)
    const requests = Array.isArray(rawRequests) ? rawRequests : [rawRequests]

    logger.trace(`Queueing ${requests.length} requests`)
    await Promise.all(requests.map((r) => this.handleRequest(r, context.adapterConfig)))

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
      } else {
        logger.error(e)
        return []
      }
    }
  }
}
