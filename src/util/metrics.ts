import * as client from 'prom-client'
import { requestDurationBuckets } from '../metrics/constants'

// Data Provider Requests Metrics
export const dataProviderMetricsLabel = (providerStatusCode?: number, method = 'get') => ({
  provider_status_code: providerStatusCode,
  method: method.toUpperCase(),
})

export const dataProviderRequests = new client.Counter({
  name: 'data_provider_requests',
  help: 'The number of http requests that are made to a data provider',
  labelNames: ['method', 'provider_status_code'] as const,
})

export const dataProviderRequestDurationSeconds = new client.Histogram({
  name: 'data_provider_request_duration_seconds',
  help: 'A histogram bucket of the distribution of data provider request durations',
  buckets: requestDurationBuckets,
})

export const requesterQueueSize = new client.Gauge({
  name: 'requester_queue_size',
  help: 'The number of provider http requests currently queued to be executed',
})

export const requesterQueueOverflow = new client.Counter({
  name: 'requester_queue_overflow',
  help: 'Total times the requester queue replaced the oldest item to avoid an overflow',
})
