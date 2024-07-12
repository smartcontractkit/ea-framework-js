import { TransportGenerics } from '..'
import { EndpointContext } from '../../adapter'
import { censorLogs, makeLogger } from '../../util'
import { TypeFromDefinition } from '../../validation/input-params'
import { SubscriptionTransport } from './subscription'
import { metrics } from '../../metrics'

const logger = makeLogger('StreamingTransport')

/**
 * Object to carry details about the current subscriptions for a StreamingTransport.
 */
export type SubscriptionDeltas<T> = {
  /** All the subscriptions that are valid at this point in time */
  desired: T[]

  /** The subscriptions that have not been processed yet (also included in the desired property) */
  new: T[]

  /** Subscriptions that have expired from the subscription set */
  stale: T[]
}

/**
 * Abstract Transport that will take incoming requests and add them to a subscription set as part
 * of the registration. It also defines an abstract stream handler method, that will be called by the
 * background execute and provided with calculated subscription deltas.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export abstract class StreamingTransport<
  const T extends TransportGenerics,
> extends SubscriptionTransport<T> {
  // The double sets serve to create a simple polling mechanism instead of needing a subscription
  // This one would not; this is always local state
  localSubscriptions: TypeFromDefinition<T['Parameters']>[] = []

  // This only tracks when the connection was established, not when the subscription was requested
  providerDataStreamEstablished = 0

  retryCount = 0
  retryTime = 0

  override async backgroundHandler(
    context: EndpointContext<T>,
    desiredSubs: TypeFromDefinition<T['Parameters']>[],
  ): Promise<void> {
    if (this.retryTime > Date.now()) {
      return
    }

    logger.debug('Generating delta (subscribes & unsubscribes)')

    const desiredSubsSet = new Set(desiredSubs.map((s) => JSON.stringify(s)))
    const localSubscriptionsSet = new Set(this.localSubscriptions.map((s) => JSON.stringify(s)))

    const subscriptions = {
      desired: desiredSubs,
      new: desiredSubs.filter((s) => !localSubscriptionsSet.has(JSON.stringify(s))),
      stale: this.localSubscriptions.filter((s) => !desiredSubsSet.has(JSON.stringify(s))),
    }

    logger.debug(
      `${subscriptions.new.length} new subscriptions; ${subscriptions.stale.length} to unsubscribe`,
    )
    if (subscriptions.new.length) {
      censorLogs(() => logger.trace(`Will subscribe to: ${JSON.stringify(subscriptions.new)}`))
    }
    if (subscriptions.stale.length) {
      censorLogs(() => logger.trace(`Will unsubscribe to: ${JSON.stringify(subscriptions.stale)}`))
    }

    try {
      await this.streamHandler(context, subscriptions)
      this.retryCount = 0
    } catch (error) {
      censorLogs(() => logger.error(error, (error as Error).stack))
      metrics
        .get('streamHandlerErrors')
        .labels({ adapter_endpoint: context.endpointName, transport: this.name })
        .inc()
      const timeout = Math.min(
        context.adapterSettings.STREAM_HANDLER_RETRY_MIN_MS *
          context.adapterSettings.STREAM_HANDLER_RETRY_EXP_FACTOR ** this.retryCount,
        context.adapterSettings.STREAM_HANDLER_RETRY_MAX_MS,
      )
      this.retryTime = Date.now() + timeout
      this.retryCount += 1
      logger.info(`Waiting ${timeout}ms before backgroundHandler retry #${this.retryCount}`)
      return
    }

    logger.debug('Setting local state to subscription set value')
    this.localSubscriptions = desiredSubs

    return
  }

  /**
   * Abstract method that will be provided with context and subscription details, and should take care of
   * handling the connection and messages sent to whatever streaming source is used.
   *
   * @param context - the context related to this background execution
   * @param subscriptions - object containing details for the desired, new, and stale subscriptions
   */
  abstract streamHandler(
    context: EndpointContext<T>,
    subscriptions: SubscriptionDeltas<TypeFromDefinition<T['Parameters']>>,
  ): Promise<void>
}
