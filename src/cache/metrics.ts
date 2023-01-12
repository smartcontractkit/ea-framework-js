import { Metrics } from '../metrics'

export interface CacheMetricsLabels {
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
      Metrics.setCacheDataGetValues(label, parsedValue)
    }
  }
  Metrics.setCacheDataGetCount(label)
  Metrics.setCacheDataStalenessSeconds(label, staleness.cache)
  if (staleness.total) {
    Metrics.setTotalDataStalenessSeconds(label, staleness.total)
  }
}

export const cacheSet = (
  label: CacheMetricsLabels,
  maxAge: number,
  timeDelta: number | undefined,
) => {
  Metrics.setCacheDataSetCount(label)
  Metrics.setCacheDataMaxAge(label, maxAge)
  Metrics.setCacheDataStalenessSeconds(label, 0)
  if (timeDelta) {
    Metrics.setProviderTimeDelta(label.feed_id, timeDelta)
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
