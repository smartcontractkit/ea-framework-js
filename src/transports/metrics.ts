import * as client from 'prom-client'
import { TransportGenerics } from '.'
import { EndpointContext } from '../adapter'
import { calculateCacheKey, calculateFeedId } from '../cache'
import { AdapterConfig } from '../config'
import { InputParameters } from '../validation'

// Websocket Metrics
export const connectionErrorLabels = (message: string) => ({
  // Key,
  message,
})

export type MessageDirection = 'sent' | 'received'

export const messageSubsLabels = <T extends TransportGenerics>(
  context: {
    inputParameters: InputParameters
    endpointName: string
    adapterConfig: AdapterConfig<T['CustomSettings']>
  },
  params: T['Request']['Params'],
) => {
  const feedId = calculateFeedId(context, params)
  const cacheKey = calculateCacheKey(context, params)

  return {
    feed_id: feedId,
    subscription_key: cacheKey,
  }
}

// Record WS message and subscription metrics
// Recalculate cacheKey and feedId for metrics
// since avoiding storing extra info in expiring sorted set
export const recordWsMessageMetrics = <T extends TransportGenerics>(
  context: EndpointContext<T>,
  subscribes: T['Request']['Params'][],
  unsubscribes: T['Request']['Params'][],
): void => {
  const recordMetrics = (params: T['Request']['Params'], type: 'sub' | 'unsub') => {
    const baseLabels = messageSubsLabels(context, params)

    // Record total number of ws messages sent
    wsMessageTotal
      .labels({
        ...baseLabels,
        direction: 'sent',
      })
      .inc()

    // Record total number of subscriptions made
    if (type === 'sub') {
      wsSubscriptionTotal.labels(baseLabels).inc()
      wsSubscriptionActive.labels(baseLabels).inc()
    } else {
      wsSubscriptionActive.labels(baseLabels).dec()
    }
  }

  subscribes.forEach((params) => {
    recordMetrics(params, 'sub')
  })
  unsubscribes.forEach((params) => {
    recordMetrics(params, 'unsub')
  })
}

export const wsConnectionActive = new client.Gauge({
  name: 'ws_connection_active',
  help: 'The number of active connections',
  labelNames: ['url'] as const,
})

export const wsConnectionErrors = new client.Counter({
  name: 'ws_connection_errors',
  help: 'The number of connection errors',
  labelNames: ['url', 'message'] as const,
})

export const wsSubscriptionActive = new client.Gauge({
  name: 'ws_subscription_active',
  help: 'The number of currently active subscriptions',
  labelNames: ['connection_url', 'feed_id', 'subscription_key'] as const,
})

export const wsSubscriptionTotal = new client.Counter({
  name: 'ws_subscription_total',
  help: 'The number of subscriptions opened in total',
  labelNames: ['connection_url', 'feed_id', 'subscription_key'] as const,
})

export const wsMessageTotal = new client.Counter({
  name: 'ws_message_total',
  help: 'The number of messages sent in total',
  labelNames: ['feed_id', 'subscription_key', 'direction'] as const,
})

// V3 specific metrics
export const bgExecuteSubscriptionSetCount = new client.Gauge({
  name: 'bg_execute_subscription_set_count',
  help: 'The number of active subscriptions in background execute',
  labelNames: ['endpoint', 'transport_type'] as const,
})

export const transportPollingFailureCount = new client.Counter({
  name: 'transport_polling_failure_count',
  help: 'The number of times the polling mechanism ran out of attempts and failed to return a response',
  labelNames: ['endpoint'] as const,
})

export const transportPollingDurationSeconds = new client.Gauge({
  name: 'transport_polling_duration_seconds',
  help: 'A histogram bucket of the distribution of transport polling idle time durations',
  labelNames: ['endpoint', 'succeeded'] as const,
})
