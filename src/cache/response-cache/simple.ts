import { ResponseCache } from './base'
import { AdapterResponse, ResponseGenerics, TimestampedProviderResult } from '../../util'
import { InputParametersDefinition } from '../../validation/input-params'
import * as cacheMetrics from '../metrics'

/**
 * Special type of cache to store responses for this adapter.
 */
export class SimpleResponseCache<
  T extends {
    Parameters: InputParametersDefinition
    Response: ResponseGenerics
  },
> extends ResponseCache<T> {
  async write(transportName: string, results: TimestampedProviderResult<T>[]): Promise<void> {
    const entries = results.map((r) => this.generateCacheEntry(transportName, r))

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
