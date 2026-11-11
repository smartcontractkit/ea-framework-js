import { AdapterDependencies } from '../../adapter'
import { ensureProviderResult, hasInversionEnabled, InversionPolicy } from '../../adapter/inverse'
import { tryClone } from '../../util/clone'
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
import { metrics } from '../../metrics'

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
  resultValidator?: (result: TimestampedProviderResult<T>) => TimestampedProviderResult<T>
  inversionPolicy?: InversionPolicy<T>

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
   * Sets responses in the adapter cache (adding necessary metadata and defaults).
   * Applies the endpoint's optional resultValidator before delegating to the subclass-specific
   * cache write implementation.
   *
   * @param transportName - transport name
   * @param results - the entries to write to the cache
   */
  async write(transportName: string, results: TimestampedProviderResult<T>[]): Promise<void> {
    const inversionPolicy = this.inversionPolicy
    const hasInversion = results.some((result) => hasInversionEnabled(result.params))

    if (hasInversion && !inversionPolicy) {
      const failed = results.map((result) => {
        if (!hasInversionEnabled(result.params) || Boolean(result.response.errorMessage)) {
          return result
        }
        return {
          params: result.params,
          response: {
            statusCode: 502,
            errorMessage: 'Inversion failed: endpoint has no inversion policy',
            timestamps: result.response.timestamps,
          },
        }
      })
      const validated = this.validateResults(failed)
      this.recordInversionMetrics(results, validated, transportName)
      return this._write(transportName, validated)
    }

    const transformed =
      inversionPolicy && hasInversion
        ? results.map((result) => {
            if (!hasInversionEnabled(result.params) || Boolean(result.response.errorMessage)) {
              return result
            }

            const params = tryClone(result.params) ?? { ...result.params }
            const response = tryClone(result.response)
            let inverted: TimestampedProviderResult<T>
            if (!response) {
              inverted = this.inversionFailure(
                params,
                result.response.timestamps,
                'Inversion failed: response could not be cloned',
              )
            } else {
              try {
                inverted =
                  ensureProviderResult(
                    inversionPolicy.transform({
                      params: tryClone(params) ?? { ...params },
                      response,
                    }),
                    { params, response: result.response },
                  ) ??
                  this.inversionFailure(
                    params,
                    result.response.timestamps,
                    'Inversion failed: policy returned an invalid result',
                  )
              } catch (error) {
                const detail =
                  error instanceof Error ? `${error.name}: ${error.message}` : String(error)
                const safeDetail = censor(detail, CensorList.getAll()) ?? detail
                censorLogs(() => logger.warn(`Inversion policy threw: ${safeDetail}`))
                inverted = this.inversionFailure(
                  params,
                  result.response.timestamps,
                  `Inversion failed: policy transform threw: ${safeDetail}`,
                )
              }
            }

            return { params, response: inverted.response }
          })
        : results

    const validated = this.validateResults(transformed)
    this.recordInversionMetrics(results, validated, transportName)
    return this._write(transportName, validated)
  }

  private inversionFailure(
    params: TypeFromDefinition<T['Parameters']>,
    timestamps: TimestampedProviderResult<T>['response']['timestamps'],
    message: string,
  ): TimestampedProviderResult<T> {
    return {
      params,
      response: {
        statusCode: 502,
        errorMessage: message,
        timestamps,
      },
    }
  }

  private recordInversionMetrics(
    original: TimestampedProviderResult<T>[],
    final: TimestampedProviderResult<T>[],
    transportName: string,
  ): void {
    for (let index = 0; index < final.length; index++) {
      const before = original[index]
      if (!hasInversionEnabled(before.params)) {
        continue
      }
      const after = final[index]
      let status: 'applied' | 'rejected' | 'skipped' = 'applied'
      if (before.response.errorMessage) {
        status = 'skipped'
      } else if (after.response.errorMessage) {
        status = 'rejected'
      }
      metrics
        .get('inversionTotal')
        .labels({
          adapter_endpoint: this.endpointName,
          policy: this.inversionPolicy?.id ?? 'none',
          status,
          transport: transportName,
        })
        .inc()
    }
  }

  private validateResults(results: TimestampedProviderResult<T>[]): TimestampedProviderResult<T>[] {
    const resultValidator = this.resultValidator
    if (!resultValidator) {
      return results
    }

    return results.map((result) => {
      const isInversion = hasInversionEnabled(result.params)
      if (!isInversion) {
        return resultValidator(result)
      }
      if (result.response.errorMessage) {
        return result
      }

      const params = tryClone(result.params) ?? { ...result.params }
      try {
        const validated = ensureProviderResult(
          resultValidator({ ...result, params: tryClone(params) ?? { ...params } }),
          result,
        )
        if (!validated) {
          return this.inversionFailure(
            params,
            result.response.timestamps,
            'Result validation failed: invalid result',
          )
        }
        return { params, response: validated.response }
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        const safeDetail = censor(detail, CensorList.getAll()) ?? detail
        censorLogs(() => logger.warn(`Result validator threw: ${safeDetail}`))
        return this.inversionFailure(
          params,
          result.response.timestamps,
          `Result validation failed: ${safeDetail}`,
        )
      }
    })
  }

  /**
   * Subclass-specific implementation of the cache write. Subclasses must implement this instead of
   * overriding write() so that resultValidator is always applied consistently.
   *
   * @param transportName - transport name
   * @param results - the entries to write to the cache
   */
  protected abstract _write(
    transportName: string,
    results: TimestampedProviderResult<T>[],
  ): Promise<void>

  /**
   * Sets responses with metadata in the adapter cache
   *
   * @param entries - the entries to write to the cache
   */
  abstract writeEntries(
    entries: {
      key: string
      value: AdapterResponse<T['Response']>
    }[],
  ): Promise<void>

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

  protected generateCacheEntry(
    transportNameForMeta: string,
    transportNameForCache: string,
    r: TimestampedProviderResult<T>,
  ) {
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
        transportName: transportNameForMeta,
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
      key: this.getCacheKey(transportNameForCache, r.params),
      value: response,
    } as const
  }

  getCacheKey(transportName: string, params: TypeFromDefinition<T['Parameters']>) {
    return calculateCacheKey({
      transportName,
      data: params,
      adapterName: this.adapterName,
      endpointName: this.endpointName,
      adapterSettings: this.adapterSettings,
    })
  }
}
