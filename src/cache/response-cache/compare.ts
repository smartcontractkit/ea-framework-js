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
  localCache: Map<string, { value: AdapterResponse<T['Response']>; writtenAt: number }>
  staleThreshold: number
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
    staleThreshold = Infinity,
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
    this.staleThreshold = staleThreshold
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
    const now = Date.now()
    const filteredEntries = (
      await Promise.all(
        entries.flatMap(async ({ key, value }) => {
          const local = this.localCache.get(key)
          const isLocalExpired = !!local && now - local.writtenAt >= this.staleThreshold
          const localValue = local && !isLocalExpired ? local.value : undefined
          if (!this.shouldUpdate(value, localValue)) {
            return []
          }
          // Skip the Redis check when the local entry is expired — the incoming write
          // should take over regardless of what Redis has at that point.
          if (!isLocalExpired) {
            const entryInCache = await this.get(key)
            if (!this.shouldUpdate(value, entryInCache)) {
              return []
            }
          }
          return [{ key, value }]
        }),
      )
    ).flat()

    if (filteredEntries.length > 0) {
      await this.responseCache.writeEntries(filteredEntries)

      filteredEntries.forEach(({ key, value }) => {
        this.localCache.set(key, { value, writtenAt: now })
      })
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
