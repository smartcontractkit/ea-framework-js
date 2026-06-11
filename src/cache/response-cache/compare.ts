import { ResponseCache } from './base'
import { AdapterResponse, ResponseGenerics, TimestampedProviderResult } from '../../util'
import { InputParametersDefinition, TypeFromDefinition } from '../../validation/input-params'

/**
 * Compares with existing cache entries before deciding to write or not
 */
export class CompareResponseCache<
  T extends {
    Parameters: InputParametersDefinition
    Response: ResponseGenerics
  },
> extends ResponseCache<T> {
  readonly transportName: string
  // The actual cache where responses are written to
  responseCache: ResponseCache<T>
  // True if next should replace current in cache
  shouldUpdate: (
    next: AdapterResponse<T['Response']>,
    current?: AdapterResponse<T['Response']>,
  ) => boolean

  constructor(
    transportName: string,
    responseCache: ResponseCache<T>,
    shouldUpdate: (
      next: AdapterResponse<T['Response']>,
      current?: AdapterResponse<T['Response']>,
    ) => boolean,
  ) {
    super({
      inputParameters: responseCache.inputParameters,
      adapterName: responseCache.adapterName,
      endpointName: responseCache.endpointName,
      adapterSettings: responseCache.adapterSettings,
      dependencies: responseCache.dependencies,
    })
    this.transportName = transportName
    this.responseCache = responseCache
    this.shouldUpdate = shouldUpdate
  }

  async write(transportName: string, results: TimestampedProviderResult<T>[]): Promise<void> {
    await this.writeEntries(
      results.map((result) => this.generateCacheEntry(transportName, this.transportName, result)),
    )
  }

  async writeEntries(
    entries: {
      key: string
      value: AdapterResponse<T['Response']>
    }[],
  ) {
    const filteredEntries = (
      await Promise.all(
        entries.flatMap(async ({ key, value }) => {
          const current = await this.get(key)
          if (!this.shouldUpdate(value, current)) {
            return []
          }
          return [{ key, value }]
        }),
      )
    ).flat()

    if (filteredEntries.length > 0) {
      await this.responseCache.writeEntries(filteredEntries)
    }
  }

  override async writeTTL(
    _: string,
    params: TypeFromDefinition<T['Parameters']>[],
    ttl: number,
  ): Promise<void> {
    await this.responseCache.writeTTL(this.transportName, params, ttl)
  }

  override async get(key: string) {
    return this.responseCache.get(key)
  }
}
