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
  // A local map to keep track of the most recent entries written to the responseCache
  // We compare with this first before comparing with value in cache
  // so that we can reduce cache reads
  localCache: Map<string, AdapterResponse<T['Response']>>
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
    this.localCache = new Map()
    this.shouldUpdate = shouldUpdate
  }

  async write(transportName: string, results: TimestampedProviderResult<T>[]): Promise<void> {
    const entries: {
      key: string
      value: AdapterResponse<T['Response']>
    }[] = []

    for (const result of results) {
      const { key, value } = this.generateCacheEntry(transportName, this.transportName, result)
      if (!this.shouldUpdate(value, this.localCache.get(key))) {
        continue
      }
      const entryInCache = await this.get(key)
      if (!this.shouldUpdate(value, entryInCache)) {
        continue
      }
      entries.push({ key, value })
    }

    await this.responseCache.writeEntries(entries)

    entries.forEach(({ key, value }) => {
      this.localCache.set(key, value)
    })
  }

  async writeEntries() {
    throw new Error('Use write instead for CompareResponseCache')
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
