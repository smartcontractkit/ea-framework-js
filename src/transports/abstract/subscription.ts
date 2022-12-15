import { EndpointContext } from '../../adapter'
import { ResponseCache } from '../../cache/response'
import { AdapterConfig } from '../../config'
import { makeLogger, SubscriptionSet } from '../../util'
import { AdapterRequest } from '../../util/types'
import { Transport, TransportDependencies, TransportGenerics } from '..'
import * as transportMetrics from '../metrics'

const logger = makeLogger('SubscriptionTransport')

/**
 * Abstract Transport that will take incoming requests and add them to a subscription set as part
 * of the registration. Then it will provide those entries to the (abstract) backgroundHandler method.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export abstract class SubscriptionTransport<T extends TransportGenerics> implements Transport<T> {
  responseCache!: ResponseCache<{
    Request: T['Request']
    Response: T['Response']
  }>
  subscriptionSet!: SubscriptionSet<T['Request']['Params']>
  subscriptionTtl!: number

  async initialize(
    dependencies: TransportDependencies<T>,
    config: AdapterConfig<T['CustomSettings']>,
    endpointName: string,
  ): Promise<void> {
    this.responseCache = dependencies.responseCache
    this.subscriptionSet = dependencies.subscriptionSetFactory.buildSet(endpointName)
    this.subscriptionTtl = this.getSubscriptionTtlFromConfig(config) // Will be implemented by subclasses
  }

  async registerRequest(
    req: AdapterRequest<T['Request']>,
    _: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    logger.debug(
      `Adding entry to subscription set (ttl ${this.subscriptionTtl}): [${req.requestContext.cacheKey}] = ${req.requestContext.data}`,
    )

    // This might need coalescing to avoid too frequent ttl updates
    await this.subscriptionSet.add(
      req.requestContext.cacheKey,
      req.requestContext.data,
      this.subscriptionTtl,
    )
  }

  async backgroundExecute(context: EndpointContext<T>): Promise<void> {
    logger.debug('Starting background execute')
    const entries = await this.subscriptionSet.getAll()

    // Keep track of active subscriptions for background execute
    // Note: for those coming from reasonable OOP languages, don't fret; this is JS:
    // this.constructor.name will resolve to the instance name, not the class one (i.e., will use the implementing class' name)
    transportMetrics.bgExecuteSubscriptionSetCount
      .labels({ endpoint: context.endpointName, transport_type: this.constructor.name })
      .set(entries.length)

    await this.backgroundHandler(context, entries)
  }

  /**
   * Handler specific to the subscription transport, that is provided all entries in the subscription set.
   *
   * @param context - background context for the execution of this handler
   * @param entries - all the entries in the subscription set
   */
  abstract backgroundHandler(
    context: EndpointContext<T>,
    entries: T['Request']['Params'][],
  ): Promise<void>

  /**
   * Helper method to be defined in subclasses, for each of them to carry their own TTL definition in the EA config.
   *
   * @param config - the config for this adapter
   */
  abstract getSubscriptionTtlFromConfig(config: AdapterConfig<T['CustomSettings']>): number
}
