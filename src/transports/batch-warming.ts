import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { EndpointContext } from '../adapter'
import * as cacheMetrics from '../cache/metrics'
import { AdapterConfig } from '../config'
import * as rateLimitMetrics from '../rate-limiting/metrics'
import { makeLogger } from '../util'
import {
  AdapterRequest,
  PartialSuccessfulResponse,
  ProviderResult,
  TimestampedProviderResult,
} from '../util/request'
import { AdapterDataProviderError, AdapterError } from '../validation/error'
import { TransportGenerics } from './'
import { SubscriptionTransport } from './abstract/subscription'
import { axiosRequest } from './util'

const WARMUP_BATCH_REQUEST_ID = '9002'

const logger = makeLogger('BatchWarmingTransport')

/**
 * Helper struct type that will be used to pass types to the generic parameters of a Transport.
 * Extends the common TransportGenerics, adding Provider specific types for this Batch endpoint.
 */
type BatchWarmingTransportGenerics = TransportGenerics & {
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
 * Config object that is provided to the BatchWarmingTransport constructor.
 */
export interface BatchWarmingTransportConfig<T extends BatchWarmingTransportGenerics> {
  prepareRequest: (
    params: T['Request']['Params'][],
    config: AdapterConfig<T['CustomSettings']>,
  ) => AxiosRequestConfig<T['Provider']['RequestBody']>
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
export class BatchWarmingTransport<
  T extends BatchWarmingTransportGenerics,
> extends SubscriptionTransport<T> {
  // Flag used to track whether the warmer has moved from having no entries to having some and vice versa
  // Used for recording the cache warmer active metrics accurately
  WARMER_ACTIVE = false

  constructor(private config: BatchWarmingTransportConfig<T>) {
    super()
  }

  getSubscriptionTtlFromConfig(config: AdapterConfig<T['CustomSettings']>): number {
    return config.WARMUP_SUBSCRIPTION_TTL
  }

  override async registerRequest(
    req: AdapterRequest<T['Request']>,
    config: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    if (config.BATCH_TRANSPORT_SETUP_VALIDATION) {
      const response = await this.makeRequest([req.requestContext.data], config)

      if (!response.results.length) {
        throw new AdapterError({
          statusCode: 200,
          providerStatusCode: response.providerResponse.status,
          message:
            (response.providerResponse as unknown as Error).message ||
            'There was an error while validating the incoming request before adding to the batch subscription set',
        })
      }
    }

    return super.registerRequest(req, config)
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

    const response = await this.makeRequest(entries, context.adapterConfig)

    if (!response.results?.length) {
      return
    }

    logger.debug('Setting adapter responses in cache')
    await this.responseCache.write(response.results)

    // Record cost of data provider call
    const cost = rateLimitMetrics.retrieveCost(response.providerResponse.data)
    rateLimitMetrics.rateLimitCreditsSpentTotal
      .labels({
        feed_id: 'N/A',
        participant_id: WARMUP_BATCH_REQUEST_ID,
      })
      .inc(cost)

    return
  }

  private async makeRequest(
    entries: T['Request']['Params'][],
    config: AdapterConfig<T['CustomSettings']>,
  ): Promise<{
    results: TimestampedProviderResult<T>[]
    providerResponse: AxiosResponse<T['Provider']['ResponseBody']>
  }> {
    logger.trace(`Have ${entries.length} entries in batch, preparing request...`)
    const request = this.config.prepareRequest(entries, config)

    logger.trace(`Sending request to data provider: ${JSON.stringify(request)}`)
    const providerDataRequested = Date.now()
    let providerResponse
    try {
      providerResponse = await axiosRequest<
        T['Provider']['RequestBody'],
        T['Provider']['ResponseBody'],
        T['CustomSettings']
      >(request, config)
    } catch (e) {
      const err = (e as AdapterDataProviderError).cause as AxiosError | undefined
      const providerDataReceived = Date.now()
      logger.warn(`There was an error while performing the batch request: ${e}`)
      return {
        results: entries.map((entry) => ({
          params: entry,
          response: {
            errorMessage: `Provider request failed with status ${err?.status}: "${err?.response?.data}"`,
            statusCode: 502,
            timestamps: {
              providerDataRequested,
              providerDataReceived,
              providerIndicatedTime: undefined,
            },
          },
        })),
        providerResponse: e as AxiosResponse,
      }
    }
    const providerDataReceived = Date.now()

    // Parse responses and apply timestamps
    const results = this.config.parseResponse(entries, providerResponse, config).map((r) => {
      const result = r as TimestampedProviderResult<T>
      const partialResponse = r.response as PartialSuccessfulResponse<T['Response']>
      result.response.timestamps = {
        providerDataRequested,
        providerDataReceived,
        providerIndicatedTime: partialResponse.timestamps?.providerIndicatedTime,
      }
      return result
    })

    logger.debug(`Got response from provider, parsing (raw body: ${providerResponse.data})`)
    return {
      results,
      providerResponse,
    }
  }
}
