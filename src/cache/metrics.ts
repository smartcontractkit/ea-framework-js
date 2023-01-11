import { Metrics } from '../metrics'

interface CacheMetricsLabels {
  participant_id: string
  feed_id: string
  cache_type: string
  // Is_from_ws?: string
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
      Metrics.cacheDataGetValues && Metrics.cacheDataGetValues.labels(label).set(parsedValue)
    }
  }
  Metrics.cacheDataGetCount && Metrics.cacheDataGetCount.labels(label).inc()
  Metrics.cacheDataStalenessSeconds &&
    Metrics.cacheDataStalenessSeconds.labels(label).set(staleness.cache)
  if (staleness.total) {
    Metrics.totalDataStalenessSeconds &&
      Metrics.totalDataStalenessSeconds.labels(label).set(staleness.total)
  }
}

export const cacheSet = (
  label: CacheMetricsLabels,
  maxAge: number,
  timeDelta: number | undefined,
) => {
  Metrics.cacheDataSetCount && Metrics.cacheDataSetCount.labels(label).inc()
  Metrics.cacheDataMaxAge && Metrics.cacheDataMaxAge.labels(label).set(maxAge)
  Metrics.cacheDataStalenessSeconds && Metrics.cacheDataStalenessSeconds.labels(label).set(0)
  if (timeDelta) {
    Metrics.providerTimeDelta &&
      Metrics.providerTimeDelta.labels({ feed_id: label.feed_id }).set(timeDelta)
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

export enum CMD_SENT_STATUS {
  TIMEOUT = 'TIMEOUT',
  FAIL = 'FAIL',
  SUCCESS = 'SUCCESS',
}
