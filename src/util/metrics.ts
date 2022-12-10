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

export const dataProviderRequestsQueued = new client.Gauge({
  name: 'data_provider_requests_queued',
  help: 'The number of provider http requests currently queued to be executed',
})
