import * as client from 'prom-client'
import { HttpRequestType, requestDurationBuckets } from './constants'
import { AdapterRequest, makeLogger } from '../util'
import { AdapterConfig } from '../config'
import fastify, { FastifyReply, HookHandlerDoneFunction } from 'fastify'
import { join } from 'path'
import { AdapterError } from '../validation/error'
import { getMTLSOptions, httpsOptions } from '../index'

const logger = makeLogger('Metrics')

export function setupMetricsServer(name: string, config: AdapterConfig) {
  const mTLSOptions: httpsOptions | Record<string, unknown> = getMTLSOptions(config)
  const metricsApp = fastify({
    ...mTLSOptions,
    logger: false,
  })
  const metricsPort = config.METRICS_PORT
  const endpoint = config.METRICS_USE_BASE_URL ? join(config.BASE_URL, 'metrics') : '/metrics'
  const eaHost = config.EA_HOST
  logger.info(`Metrics endpoint: http://${eaHost}:${metricsPort}${endpoint}`)

  setupMetrics(name)

  metricsApp.get(endpoint, async (_, res) => {
    res.type('txt')
    res.send(await client.register.metrics())
  })

  metricsApp.listen({
    port: metricsPort,
    host: eaHost,
  })
}

export const setupMetrics = (name: string): void => {
  client.collectDefaultMetrics()
  client.register.setDefaultLabels({
    app_name: name || 'N/A',
    app_version: process.env['npm_package_version'],
  })
}

/**
 * Builds metrics middleware that records end to end EA response times
 * and count of requests
 *
 * @returns the cache middleware function
 */
export const buildMetricsMiddleware = (
  req: AdapterRequest,
  res: FastifyReply,
  done: HookHandlerDoneFunction,
) => {
  // The request context can technically be empty if the input validation failed
  const feedId = req.requestContext?.meta?.metrics?.feedId || 'N/A'
  const labels = buildHttpRequestMetricsLabel(
    feedId,
    req.requestContext?.meta?.error,
    req.requestContext?.meta?.metrics?.cacheHit,
  )

  // Record number of requests sent to EA
  httpRequestsTotal.labels(labels).inc()

  // Record response time of request through entire EA
  httpRequestDurationSeconds.observe(res.getResponseTime() / 1000)
  logger.debug(`Response time for ${feedId}: ${res.getResponseTime()}ms`)
  done()
}

export const buildHttpRequestMetricsLabel = (
  feedId: string,
  error?: AdapterError | Error,
  cacheHit?: boolean,
): Parameters<typeof httpRequestsTotal.labels>[0] => {
  const labels: Parameters<typeof httpRequestsTotal.labels>[0] = {}
  labels.method = 'POST'
  labels.feed_id = feedId
  if (error instanceof AdapterError) {
    // If error present and an instace of AdapterError, build label from error info
    labels.type = error?.metricsLabel || HttpRequestType.ADAPTER_ERROR
    labels.status_code = error?.statusCode
    labels.provider_status_code = error?.providerStatusCode
  } else if (error instanceof Error) {
    // If error present and not instance of generic Error, unexpected failure occurred
    labels.type = HttpRequestType.ADAPTER_ERROR
    labels.status_code = 500
  } else {
    // If no error present, request went as expected
    labels.status_code = 200
    if (cacheHit) {
      labels.type = HttpRequestType.CACHE_HIT
    } else {
      labels.type = HttpRequestType.DATA_PROVIDER_HIT
      labels.provider_status_code = 200
    }
  }

  return labels
}

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'The number of http requests this external adapter has serviced for its entire uptime',
  labelNames: [
    'method',
    'status_code',
    'retry',
    'type',
    'is_cache_warming',
    'feed_id',
    'provider_status_code',
  ] as const,
})

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'A histogram bucket of the distribution of http request durations',
  buckets: requestDurationBuckets,
})

// V3 specific metrics
export const bgExecuteTotal = new client.Counter({
  name: 'bg_execute_total',
  help: 'The number of background executes performed per endpoint',
  labelNames: ['endpoint'] as const,
})

export const bgExecuteDurationSeconds = new client.Gauge({
  name: 'bg_execute_duration_seconds',
  help: 'A histogram bucket of the distribution of background execute durations',
  labelNames: ['endpoint'] as const,
})
