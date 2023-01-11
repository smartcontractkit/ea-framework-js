import { TransportGenerics } from '.'
import { EndpointContext } from '../adapter'
import { calculateCacheKey, calculateFeedId } from '../cache'
import { AdapterConfig } from '../config'
import { Metrics } from '../metrics'
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
    Metrics.wsMessageTotal &&
      Metrics.wsMessageTotal
        .labels({
          ...baseLabels,
          direction: 'sent',
        })
        .inc()

    // Record total number of subscriptions made
    if (type === 'sub') {
      Metrics.wsSubscriptionTotal && Metrics.wsSubscriptionTotal.labels(baseLabels).inc()
      Metrics.wsSubscriptionActive && Metrics.wsSubscriptionActive.labels(baseLabels).inc()
    } else {
      Metrics.wsSubscriptionActive && Metrics.wsSubscriptionActive.labels(baseLabels).dec()
    }
  }

  subscribes.forEach((params) => {
    recordMetrics(params, 'sub')
  })
  unsubscribes.forEach((params) => {
    recordMetrics(params, 'unsub')
  })
}
