import { AdapterDependencies } from '../adapter'
import { AdapterSettings } from '../config'
import {
  AdapterResponse,
  makeLogger,
  RequestGenerics,
  ResponseGenerics,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../util'
import { InputParameters } from '../validation/input-params'
import { Cache, calculateCacheKey, calculateFeedId } from './'
import * as cacheMetrics from './metrics'
import { validator } from '../validation/utils'

const logger = makeLogger('ResponseCache')

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
  adapterSettings: AdapterSettings

  constructor({
    inputParameters,
    adapterName,
    endpointName,
    adapterSettings,
    dependencies,
  }: {
    dependencies: AdapterDependencies
    adapterSettings: AdapterSettings
    adapterName: string
    endpointName: string
    inputParameters: InputParameters
  }) {
    this.cache = dependencies.cache as Cache<AdapterResponse<T['Response']>>
    this.inputParameters = inputParameters
    this.adapterName = adapterName
    this.endpointName = endpointName
    this.adapterSettings = adapterSettings
  }

  /**
   * Sets responses in the adapter cache (adding necessary metadata and defaults)
   *
   * @param results - the entries to write to the cache
   */
  async write(transportName: string, results: TimestampedProviderResult<T>[]): Promise<void> {
    const entries = results.map((r) => {
      const response: AdapterResponse<T['Response']> = {
        ...r.response,
        statusCode: (r.response as TimestampedProviderErrorResponse).statusCode || 200,
      }

      if (
        this.adapterSettings.METRICS_ENABLED &&
        this.adapterSettings.EXPERIMENTAL_METRICS_ENABLED
      ) {
        response.meta = {
          metrics: {
            feedId: calculateFeedId(
              {
                inputParameters: this.inputParameters,
                adapterSettings: this.adapterSettings,
              },
              r.params,
            ),
          },
        }
      }

      if (response.timestamps?.providerIndicatedTimeUnixMs !== undefined) {
        const timestampValidator = validator.responseTimestamp()
        const error = timestampValidator(response.timestamps?.providerIndicatedTimeUnixMs)
        if (error) {
          logger.warn(`Provider indicated time is invalid: ${error}`)
        }
      }

      return {
        key: calculateCacheKey({
          transportName,
          data: r.params,
          inputParameters: this.inputParameters,
          adapterName: this.adapterName,
          endpointName: this.endpointName,
          adapterSettings: this.adapterSettings,
        }),
        value: response,
      } as const
    })

    const ttl = this.adapterSettings.CACHE_MAX_AGE
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
}
