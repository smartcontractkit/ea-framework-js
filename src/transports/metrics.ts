import { TransportGenerics } from '.'
import { EndpointContext } from '../adapter'
import { calculateFeedId } from '../cache'
import { metrics } from '../metrics'
import { InputParameters } from '../validation'
import { TypeFromDefinition } from '../validation/input-params'

// Websocket Metrics
export const connectionErrorLabels = (message: string) => ({
  // Key,
  message,
})

export type MessageDirection = 'sent' | 'received'

export const messageSubsLabels = <T extends TransportGenerics>(
  context: {
    inputParameters: InputParameters<T['Parameters']>
    endpointName: string
    adapterSettings: T['Settings']
  },
  params: TypeFromDefinition<T['Parameters']>,
) => {
  const feedId = calculateFeedId(context, params)

  return {
    feed_id: feedId,
    subscription_key: `${context.endpointName}-${feedId}`,
  }
}

export const recordWsMessageSentMetrics = <T extends TransportGenerics>(
  context: EndpointContext<T>,
  subscribes: TypeFromDefinition<T['Parameters']>[],
  unsubscribes: TypeFromDefinition<T['Parameters']>[],
) => {
  for (const params of [...subscribes, ...unsubscribes]) {
    const baseLabels = messageSubsLabels(context, params)

    // Record total number of ws messages sent
    metrics
      .get('wsMessageTotal')
      .labels({ ...baseLabels, direction: 'sent' })
      .inc()
  }
}

// Record WS message and subscription metrics
// Recalculate cacheKey and feedId for metrics
// since avoiding storing extra info in expiring sorted set
export const recordWsMessageSubMetrics = <T extends TransportGenerics>(
  context: EndpointContext<T>,
  subscribes: TypeFromDefinition<T['Parameters']>[],
  unsubscribes: TypeFromDefinition<T['Parameters']>[],
): void => {
  const recordMetrics = (params: TypeFromDefinition<T['Parameters']>, type: 'sub' | 'unsub') => {
    const baseLabels = messageSubsLabels(context, params)

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
