import { metrics } from '../metrics'

export interface CacheMetricsLabels {
  participant_id: string
  feed_id: string
  cache_type: string
}

export const cacheGet = (
  label: CacheMetricsLabels,
  value: unknown,
  staleness: {
    cache: number
    total: number | null
  },
) => {
  if (typeof value === 'number' || typeof value === 'string') {
    const parsedValue = Number(value)
    if (!Number.isNaN(parsedValue) && Number.isFinite(parsedValue)) {
      metrics.get('cacheDataGetValues').labels(label).set(parsedValue)
    }
  }
  metrics.get('cacheDataGetCount').labels(label).inc()
  metrics.get('cacheDataStalenessSeconds').labels(label).set(staleness.cache)
  if (staleness.total) {
    metrics.get('totalDataStalenessSeconds').labels(label).set(staleness.total)
  }
}

export const cacheSet = (
  label: CacheMetricsLabels,
  maxAge: number,
  timeDelta: number | undefined,
) => {
  metrics.get('cacheDataSetCount').labels(label).inc()
  metrics.get('cacheDataMaxAge').labels(label).set(maxAge)
  metrics.get('cacheDataStalenessSeconds').labels(label).set(0)
  if (timeDelta) {
    metrics.get('providerTimeDelta').labels({ feed_id: label.feed_id }).set(timeDelta)
  }
}

export const cacheMetricsLabel = (cacheKey: string, feedId: string, cacheType: string) => ({
  participant_id: cacheKey,
  feed_id: feedId,
  cache_type: cacheType,
})

export enum CacheTypes {
  Redis = 'redis',
  Local = 'local',
}
