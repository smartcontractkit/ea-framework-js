import { Transport, TransportDependencies, TransportGenerics } from '..'
import { EndpointContext } from '../../adapter'
import { ResponseCache } from '../../cache/response'
import { metrics } from '../../metrics'
import { SubscriptionSet, makeLogger } from '../../util'
import { AdapterRequest } from '../../util/types'
import { TypeFromDefinition } from '../../validation/input-params'

const logger = makeLogger('SubscriptionTransport')

/**
 * Abstract Transport that will take incoming requests and add them to a subscription set as part
 * of the registration. Then it will provide those entries to the (abstract) backgroundHandler method.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export abstract class SubscriptionTransport<const T extends TransportGenerics>
  implements Transport<T>
{
  responseCache!: ResponseCache<T>
  subscriptionSet!: SubscriptionSet<TypeFromDefinition<T['Parameters']>>
  subscriptionTtl!: number
  name!: string

  async initialize(
    dependencies: TransportDependencies<T>,
    adapterSettings: T['Settings'],
    endpointName: string,
    name: string,
  ): Promise<void> {
    this.responseCache = dependencies.responseCache
    this.subscriptionSet = dependencies.subscriptionSetFactory.buildSet(endpointName, name)
    this.subscriptionTtl = this.getSubscriptionTtlFromConfig(adapterSettings) // Will be implemented by subclasses
    this.name = name
  }

  async registerRequest(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    _: T['Settings'],
  ): Promise<void> {
    logger.debug(
      `Adding entry to subscription set (ttl ${this.subscriptionTtl}): [${req.requestContext.cacheKey}] = ${req.requestContext.data}`,
    )

    // This might need coalescing to avoid too frequent ttl updates
    await this.subscriptionSet.add(
      req.requestContext.data,
      this.subscriptionTtl,
      req.requestContext.cacheKey,
    )
  }

  async backgroundExecute(context: EndpointContext<T>): Promise<void> {
    logger.debug('Starting background execute')
    const entries = await this.subscriptionSet.getAll()

    // Keep track of active subscriptions for background execute
    // Note: for those coming from reasonable OOP languages, don't fret; this is JS:
    // this.constructor.name will resolve to the instance name, not the class one (i.e., will use the implementing class' name)
    metrics
      .get('bgExecuteSubscriptionSetCount')
      .labels({
        adapter_endpoint: context.endpointName,
        transport_type: this.constructor.name,
        transport: this.name,
      })
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
    entries: TypeFromDefinition<T['Parameters']>[],
  ): Promise<void>

  /**
   * Helper method to be defined in subclasses, for each of them to carry their own TTL definition in the EA config.
   *
   * @param adapterSettings - the config for this adapter
   */
  abstract getSubscriptionTtlFromConfig(adapterSettings: T['Settings']): number
}
