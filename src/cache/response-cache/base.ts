import { AdapterDependencies } from '../../adapter'
import { AdapterSettings } from '../../config'
import {
  AdapterResponse,
  makeLogger,
  ResponseGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderResult,
  censor,
  censorLogs,
  TimestampedProviderErrorResponse,
} from '../../util'
import {
  InputParameters,
  InputParametersDefinition,
  TypeFromDefinition,
} from '../../validation/input-params'
import { Cache, calculateAdapterName, calculateCacheKey, calculateFeedId } from '../'
import CensorList from '../../util/censor/censor-list'
import { validator } from '../../validation/utils'

const logger = makeLogger('ResponseCache')

export abstract class ResponseCache<
  T extends { Parameters: InputParametersDefinition; Response: ResponseGenerics },
> {
  cache: Cache<AdapterResponse<T['Response']>>
  inputParameters: InputParameters<T['Parameters']>
  adapterName: string
  endpointName: string
  adapterSettings: AdapterSettings
  dependencies: AdapterDependencies

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
    this.dependencies = dependencies
    this.cache = dependencies.cache as Cache<AdapterResponse<T['Response']>>
    this.inputParameters = inputParameters
    this.adapterName = adapterName
    this.endpointName = endpointName
    this.adapterSettings = adapterSettings
  }

  /**
   * Sets responses in the adapter cache (adding necessary metadata and defaults)
   *
   * @param transportName - transport name
   * @param results - the entries to write to the cache
   */
  abstract write(transportName: string, results: TimestampedProviderResult<T>[]): Promise<void>

  /**
   * Sets a new TTL value for already cached responses in the adapter cache
   *
   * @param transportName - transport name
   * @param params - set of parameters that uniquely relate to the response
   * @param ttl - a new time in milliseconds until the response expires
   */
  async writeTTL(
    transportName: string,
    params: TypeFromDefinition<T['Parameters']>[],
    ttl: number,
  ): Promise<void> {
    for (const param of params) {
      const key = this.getCacheKey(transportName, param)
      this.cache.setTTL(key, ttl)
    }
  }

  async get(key: string) {
    return this.cache.get(key)
  }

  protected generateCacheEntry(transportName: string, r: TimestampedProviderResult<T>) {
    const censorList = CensorList.getAll()
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
        censorLogs(() => logger.error(`Error censoring response: ${error}`))
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

    if (this.adapterSettings.METRICS_ENABLED && this.adapterSettings.EXPERIMENTAL_METRICS_ENABLED) {
      response.meta = {
        adapterName: calculateAdapterName(this.adapterName, r.params),
        metrics: {
          feedId: calculateFeedId(
            {
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
        censorLogs(() => logger.warn(`Provider indicated time is invalid: ${error}`))
      }
    }

    return {
      key: this.getCacheKey(transportName, r.params),
      value: response,
    } as const
  }

  private getCacheKey(transportName: string, params: TypeFromDefinition<T['Parameters']>) {
    return calculateCacheKey({
      transportName,
      data: params,
      adapterName: this.adapterName,
      endpointName: this.endpointName,
      adapterSettings: this.adapterSettings,
    })
  }
}
