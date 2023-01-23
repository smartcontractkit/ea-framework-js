import { TransportGenerics } from '..'
import { EndpointContext } from '../../adapter'
import { makeLogger } from '../../util'
import { SubscriptionTransport } from './subscription'

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
  T extends TransportGenerics,
> extends SubscriptionTransport<T> {
  // The double sets serve to create a simple polling mechanism instead of needing a subscription
  // This one would not; this is always local state
  localSubscriptions: T['Request']['Params'][] = []

  // This only tracks when the connection was established, not when the subscription was requested
  providerDataStreamEstablished = 0

  override async backgroundHandler(
    context: EndpointContext<T>,
    desiredSubs: T['Request']['Params'][],
  ): Promise<void> {
    logger.debug('Generating delta (subscribes & unsubscribes)')

    const desiredSubsSet = new Set(desiredSubs)
    const localSubscriptionsSet = new Set(this.localSubscriptions)

    const subscriptions = {
      desired: desiredSubs,
      new: desiredSubs.filter(s => !localSubscriptionsSet.has(s)),
      stale: this.localSubscriptions.filter(s => !desiredSubsSet.has(s)),
    }

    logger.debug(
      `${subscriptions.new.length} new subscriptions; ${subscriptions.stale.length} to unsubscribe`,
    )
    if (subscriptions.new.length) {
      logger.trace(`Will subscribe to: ${JSON.stringify(subscriptions.new)}`)
    }
    if (subscriptions.stale.length) {
      logger.trace(`Will unsubscribe to: ${JSON.stringify(subscriptions.stale)}`)
    }

    await this.streamHandler(context, subscriptions)

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
    subscriptions: SubscriptionDeltas<T['Request']['Params']>,
  ): Promise<void>
}
