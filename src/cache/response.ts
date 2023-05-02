import { AdapterDependencies } from '../adapter'
import { AdapterSettings } from '../config'
import {
  AdapterResponse,
  censor,
  makeLogger,
  ResponseGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../util'
import CensorList from '../util/censor/censor-list'
import { InputParameters, InputParametersDefinition } from '../validation/input-params'
import { validator } from '../validation/utils'
import { Cache, calculateCacheKey, calculateFeedId } from './'
import * as cacheMetrics from './metrics'

const logger = makeLogger('ResponseCache')

/**
 * Special type of cache to store responses for this adapter.
 */
export class ResponseCache<
  T extends {
    Parameters: InputParametersDefinition
    Response: ResponseGenerics
  },
> {
  cache: Cache<AdapterResponse<T['Response']>>
  inputParameters: InputParameters<T['Parameters']>
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
    inputParameters: InputParameters<T['Parameters']>
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
    const censorList = CensorList.getAll()
    const entries = results.map((r) => {
      const { data, result, errorMessage } = r.response
      if (!errorMessage && data === undefined) {
        logger.warn('The "data" property of the response is undefined.')
      } else if (!errorMessage && result === undefined) {
        logger.warn('The "result" property of the response is undefined.')
      }
      let censoredResponse
      if (!censorList.length) {
        censoredResponse = r.response
      } else {
        try {
          censoredResponse = censor(r.response, censorList, true) as TimestampedAdapterResponse<
            T['Response']
          >
        } catch (error) {
          logger.error(`Error censoring response: ${error}`)
          censoredResponse = {
            statusCode: 502,
            errorMessage: 'Response could not be censored due to an error',
            timestamps: r.response.timestamps,
          }
        }
      }

      const response: AdapterResponse<T['Response']> = {
        ...censoredResponse,
        statusCode: (censoredResponse as TimestampedProviderErrorResponse).statusCode || 200,
      }

      if (
        this.adapterSettings.METRICS_ENABLED &&
        this.adapterSettings.EXPERIMENTAL_METRICS_ENABLED
      ) {
        response.meta = {
          adapterName: this.adapterName,
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
        const error = timestampValidator.fn(response.timestamps?.providerIndicatedTimeUnixMs)
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
