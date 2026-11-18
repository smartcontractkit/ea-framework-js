import { AdapterDependencies } from '../../adapter'
import { AdapterSettings } from '../../config'
import {
  AdapterResponse,
  makeLogger,
  ResponseGenerics,
  ResponseInverter,
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
import {
  Cache,
  calculateAdapterName,
  calculateCacheKey,
  calculateFeedId,
  inverseFeedIdParams,
  toInverseCacheKey,
} from '../'
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
  resultValidator?: (result: TimestampedProviderResult<T>) => TimestampedProviderResult<T>
  invertResponse?: ResponseInverter<T['Response']>

  /** Per transport name: raw cache keys for which an inverse variant is currently requested. */
  private inverseKeys = new Map<string, Set<string>>()

  /** Raw cache keys whose inverse entry is waiting to be seeded. A regular write cancels the seed. */
  protected pendingSeeds = new Set<string>()

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
    const resultValidator = this.resultValidator
    const validated = resultValidator ? results.map((r) => resultValidator(r)) : results
    return this._write(transportName, validated)
  }

  /** Raw cache keys that need an inverse entry for this transport, or undefined when there are none. */
  protected inverseKeysFor(transportName: string): Set<string> | undefined {
    const keys = this.inverseKeys.get(transportName)
    return keys?.size ? keys : undefined
  }

  /**
   * Called by the transport on every background cycle with the params that currently have an
   * inverse variant requested. Seeds newly requested variants from the cached raw value.
   */
  async setInverseParams(
    transportName: string,
    params: TypeFromDefinition<T['Parameters']>[],
  ): Promise<void> {
    const previous = this.inverseKeys.get(transportName)
    if (!params.length && !previous?.size) {
      return
    }
    const next = new Set<string>()
    const added: { rawKey: string; params: TypeFromDefinition<T['Parameters']> }[] = []
    for (const p of params) {
      const rawKey = this.getCacheKey(transportName, p)
      next.add(rawKey)
      if (!previous?.has(rawKey)) {
        added.push({ rawKey, params: p })
        this.pendingSeeds.add(rawKey)
      }
    }
    // Install the keys first: a write that lands while we seed must already fan out.
    this.inverseKeys.set(transportName, next)

    for (const { rawKey, params: p } of added) {
      const cached = await this.cache.get(rawKey)
      // If a write produced the inverse entry while we were reading, it already cancelled this seed.
      if (!this.pendingSeeds.delete(rawKey) || !cached) {
        continue
      }
      const seed = this.generateInverseEntry(
        transportName,
        { params: p, response: cached } as unknown as TimestampedProviderResult<T>,
        rawKey,
      )
      if (seed) {
        await this.writeEntries([seed])
      }
    }
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
    const keys = this.inverseKeys.get(transportName)
    for (const param of params) {
      const key = this.getCacheKey(transportName, param)
      this.cache.setTTL(key, ttl)
      if (keys?.has(key)) {
        this.cache.setTTL(toInverseCacheKey(key), ttl)
      }
    }
  }

  async get(key: string) {
    return this.cache.get(key)
  }

  protected generateCacheEntry(
    transportNameForMeta: string,
    transportNameForCache: string,
    r: TimestampedProviderResult<T>,
    inverseOfKey?: string,
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
            inverseOfKey ? inverseFeedIdParams(r.params) : r.params,
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
      key: inverseOfKey
        ? toInverseCacheKey(inverseOfKey)
        : this.getCacheKey(transportNameForCache, r.params),
      value: response,
    } as const
  }

  /**
   * Builds the inverse cache entry for an already validated raw result.
   * Errors are copied as they are. Returns undefined when the endpoint has no inverter.
   */
  protected generateInverseEntry(
    transportName: string,
    r: TimestampedProviderResult<T>,
    rawKey: string,
  ) {
    const invert = this.invertResponse
    if (!invert) {
      return undefined
    }
    let response = r.response
    if (!response.errorMessage) {
      try {
        const { data, result } = response as {
          data: T['Response']['Data']
          result: T['Response']['Result']
        }
        const inverted: TimestampedProviderResult<T> = {
          params: r.params,
          response: {
            ...response,
            ...invert({ data, result }),
          } as TimestampedAdapterResponse<T['Response']>,
        }
        response = (this.resultValidator ? this.resultValidator(inverted) : inverted).response
      } catch (error) {
        // A failure here must never stop the raw result from being written.
        censorLogs(() => logger.warn(`Inversion failed: ${error}`))
        response = {
          statusCode: 502,
          errorMessage: 'Inversion failed: inverting or validating the result threw',
          timestamps: response.timestamps,
        }
      }
    }
    return this.generateCacheEntry(
      transportName,
      transportName,
      { params: r.params, response },
      rawKey,
    )
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
