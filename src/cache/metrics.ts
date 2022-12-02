import * as client from 'prom-client'

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
      cacheDataGetValues.labels(label).set(parsedValue)
    }
  }
  cacheDataGetCount.labels(label).inc()
  cacheDataStalenessSeconds.labels(label).set(staleness.cache)
  if (staleness.total) {
    totalDataStalenessSeconds.labels(label).set(staleness.total)
  }
}

export const cacheSet = (
  label: CacheMetricsLabels,
  maxAge: number,
  timeDelta: number | undefined,
) => {
  cacheDataSetCount.labels(label).inc()
  cacheDataMaxAge.labels(label).set(maxAge)
  cacheDataStalenessSeconds.labels(label).set(0)
  if (timeDelta) {
    providerTimeDelta.labels({ feed_id: label.feed_id }).set(timeDelta)
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

const baseLabels = [
  'feed_id',
  'participant_id',
  'cache_type',
  'is_from_ws',
  'experimental',
] as const

// Skipping this metrics for v3
// const cache_execution_duration_seconds = new client.Histogram({
//   name: 'cache_execution_duration_seconds',
//   help: 'A histogram bucket of the distribution of cache execution durations',
//   labelNames: [...baseLabels, 'cache_hit'] as const,
//   buckets: [0.01, 0.1, 1, 10],
// })

const cacheDataGetCount = new client.Counter({
  name: 'cache_data_get_count',
  help: 'A counter that increments every time a value is fetched from the cache',
  labelNames: baseLabels,
})

const cacheDataGetValues = new client.Gauge({
  name: 'cache_data_get_values',
  help: 'A gauge keeping track of values being fetched from cache',
  labelNames: baseLabels,
})

const cacheDataMaxAge = new client.Gauge({
  name: 'cache_data_max_age',
  help: 'A gauge tracking the max age of stored values in the cache',
  labelNames: baseLabels,
})

const cacheDataSetCount = new client.Counter({
  name: 'cache_data_set_count',
  help: 'A counter that increments every time a value is set to the cache',
  labelNames: [...baseLabels, 'status_code'],
})

const cacheDataStalenessSeconds = new client.Gauge({
  name: 'cache_data_staleness_seconds',
  help: 'Observes the cache staleness of the data returned (i.e., time since the data was written to the cache)',
  labelNames: baseLabels,
})

const totalDataStalenessSeconds = new client.Gauge({
  name: 'total_data_staleness_seconds',
  help: 'Observes the total staleness of the data returned (i.e., time since the provider indicated the data was sent)',
  labelNames: baseLabels,
})

const providerTimeDelta = new client.Gauge({
  name: 'provider_time_delta',
  help: 'Measures the difference between the time indicated by a DP for a value vs the time it was written to cache',
  labelNames: ['feed_id'],
})

// Redis Metrics
export const redisConnectionsOpen = new client.Counter({
  name: 'redis_connections_open',
  help: 'The number of redis connections that are open',
})

export const redisRetriesCount = new client.Counter({
  name: 'redis_retries_count',
  help: 'The number of retries that have been made to establish a redis connection',
})

export const redisCommandsSentCount = new client.Counter({
  name: 'redis_commands_sent_count',
  help: 'The number of redis commands sent',
  labelNames: ['status', 'function_name'],
})

// Cache Warmer Metrics
export const cacheWarmerCount = new client.Gauge({
  name: 'cache_warmer_get_count',
  help: 'The number of cache warmers running',
  labelNames: ['isBatched'] as const,
})
