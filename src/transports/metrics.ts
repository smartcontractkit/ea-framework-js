import { TransportGenerics } from '.'
import { EndpointContext } from '../adapter'
import { calculateFeedId } from '../cache'
import { metrics } from '../metrics'
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
    adapterSettings: T['Settings']
  },
  params: T['Request']['Params'],
) => {
  const feedId = calculateFeedId(context, params)

  return {
    feed_id: feedId,
    subscription_key: `${context.endpointName}-${feedId}`,
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
    metrics
      .get('wsMessageTotal')
      .labels({ ...baseLabels, direction: 'sent' })
      .inc()

    // Record total number of subscriptions made
    if (type === 'sub') {
      metrics.get('wsSubscriptionTotal').labels(baseLabels).inc()
      metrics.get('wsSubscriptionActive').labels(baseLabels).inc()
    } else {
      metrics.get('wsSubscriptionActive').labels(baseLabels).dec()
    }
  }

  subscribes.forEach((params) => {
    recordMetrics(params, 'sub')
  })
  unsubscribes.forEach((params) => {
    recordMetrics(params, 'unsub')
  })
}
