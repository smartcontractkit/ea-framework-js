import { AdapterDependencies } from '../adapter'
import { AdapterConfig } from '../config'
import {
  AdapterResponse,
  RequestGenerics,
  ResponseGenerics,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../util'
import { InputParameters } from '../validation/input-params'
import { Cache, calculateCacheKey, calculateFeedId } from './'
import * as cacheMetrics from './metrics'

/**
 * Special type of cache to store responses for this adapter.
 */
export class ResponseCache<
  T extends {
    Request: RequestGenerics
    Response: ResponseGenerics
  },
> {
  cache: Cache<AdapterResponse<T['Response']>>
  inputParameters: InputParameters
  adapterName: string
  endpointName: string
  config: AdapterConfig

  constructor({
    inputParameters,
    adapterName,
    endpointName,
    config,
    dependencies,
  }: {
    dependencies: AdapterDependencies
    config: AdapterConfig
    adapterName: string
    endpointName: string
    inputParameters: InputParameters
  }) {
    this.cache = dependencies.cache as Cache<AdapterResponse<T['Response']>>
    this.inputParameters = inputParameters
    this.adapterName = adapterName
    this.endpointName = endpointName
    this.config = config
  }

  /**
   * Sets responses in the adapter cache (adding necessary metadata and defaults)
   *
   * @param results - the entries to write to the cache
   */
  async write(results: TimestampedProviderResult<T>[]): Promise<void> {
    const entries = results.map((r) => {
      const response: AdapterResponse<T['Response']> = {
        ...r.response,
        statusCode: (r.response as TimestampedProviderErrorResponse).statusCode || 200,
      }

      if (this.config.METRICS_ENABLED && this.config.EXPERIMENTAL_METRICS_ENABLED) {
        response.meta = {
          metrics: {
            feedId: calculateFeedId(
              {
                inputParameters: this.inputParameters,
                adapterConfig: this.config,
              },
              r.params,
            ),
          },
        }
      }

      return {
        key: calculateCacheKey(
          {
            inputParameters: this.inputParameters,
            adapterName: this.adapterName,
            endpointName: this.endpointName,
            adapterConfig: this.config,
          },
          r.params,
        ),
        value: response,
      } as const
    })

    const ttl = this.config.CACHE_MAX_AGE
    await this.cache.setMany(entries, ttl)

    const now = Date.now()
    for (const { key, value } of entries) {
      // Only record metrics if feed Id is present, otherwise assuming value is not adapter response to record
      const response = value as unknown as AdapterResponse
      const feedId = response.meta?.metrics?.feedId
      if (feedId) {
        const providerTime = response.timestamps?.providerIndicatedTimeUnixMs
        const timeDelta = providerTime ? now - providerTime : undefined

        // Record cache set count, max age, and staleness (set to 0 for cache set)
        const label = cacheMetrics.cacheMetricsLabel(key, feedId, this.cache.type)
        cacheMetrics.cacheSet(label, ttl, timeDelta)
      }
    }

    return
  }

  /**
   * Looks for an adapter response in the cache.
   *
   * @param cacheKey - the key made from the adapter params
   * @returns the associated response if found
   */
  read(cacheKey: string) {
    return this.cache.get(cacheKey)
  }
}
