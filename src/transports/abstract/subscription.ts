import { Transport, TransportDependencies, TransportGenerics } from '..'
import { EndpointContext } from '../../adapter'
import { hasInversionEnabled } from '../../adapter/inverse'
import { ResponseCache } from '../../cache/response'
import { metrics } from '../../metrics'
import { SubscriptionSet, censorLogs, makeLogger } from '../../util'
import { AdapterRequest, TimestampedProviderResult } from '../../util/types'
import { TypeFromDefinition } from '../../validation/input-params'
import { ProviderVariantResolver } from './provider-variants'

const logger = makeLogger('SubscriptionTransport')

// Avoid polling an empty versioned inversion set on every background cycle.
const INACTIVE_INVERSION_SET_CHECK_MS = 1000

/**
 * Abstract Transport that will take incoming requests and add them to a subscription set as part
 * of the registration. Then it will provide those entries to the (abstract) backgroundHandler method.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export abstract class SubscriptionTransport<T extends TransportGenerics> implements Transport<T> {
  responseCache!: ResponseCache<T>
  subscriptionSet!: SubscriptionSet<TypeFromDefinition<T['Parameters']>>
  protected inversionSubscriptionSet?: SubscriptionSet<TypeFromDefinition<T['Parameters']>>
  subscriptionTtl!: number
  name!: string
  initialized = false

  protected variantResolver = new ProviderVariantResolver<T>()
  private inversionSetActive = false
  private lastInversionSetCheck = 0

  async initialize(
    dependencies: TransportDependencies<T>,
    adapterSettings: T['Settings'],
    endpointName: string,
    name: string,
  ): Promise<void> {
    if (this.initialized) {
      throw new Error(`Transport ${name} has already been initialized`)
    }
    this.initialized = true
    this.responseCache = dependencies.responseCache
    this.subscriptionSet = dependencies.subscriptionSetFactory.buildSet(endpointName, name)
    const inversionPolicy =
      'inversionPolicy' in this.responseCache ? this.responseCache.inversionPolicy : undefined
    if (inversionPolicy) {
      this.inversionSubscriptionSet = dependencies.subscriptionSetFactory.buildSet(
        endpointName,
        name,
        `inversion-${inversionPolicy.id}-v${inversionPolicy.version}`,
      )
    }
    this.subscriptionTtl = this.getSubscriptionTtlFromConfig(adapterSettings) // Will be implemented by subclasses
    this.name = name
  }

  async registerRequest(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    _: T['Settings'],
  ): Promise<void> {
    censorLogs(() =>
      logger.debug(
        `Adding entry to subscription set (ttl ${this.subscriptionTtl}): [${req.requestContext.cacheKey}] = ${req.requestContext.data}`,
      ),
    )

    const inversionSet =
      this.inversionSubscriptionSet && hasInversionEnabled(req.requestContext.data)
        ? this.inversionSubscriptionSet
        : undefined
    if (inversionSet) {
      this.inversionSetActive = true
    }

    // This might need coalescing to avoid too frequent ttl updates
    await (inversionSet ?? this.subscriptionSet).add(
      req.requestContext.data,
      this.subscriptionTtl,
      req.requestContext.cacheKey,
    )
  }

  async backgroundExecute(context: EndpointContext<T>): Promise<void> {
    logger.debug('Starting background execute')

    const [legacyEntries, inversionEntries] = await Promise.all([
      this.subscriptionSet.getAll(),
      this.getInversionEntries(),
    ])
    const entries =
      inversionEntries.length > 0 ? [...legacyEntries, ...inversionEntries] : legacyEntries

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

    const providerEntries = this.variantResolver.group(entries)
    await this.backgroundHandler(context, providerEntries)
  }

  private async getInversionEntries(): Promise<TypeFromDefinition<T['Parameters']>[]> {
    const inversionSet = this.inversionSubscriptionSet
    if (!inversionSet) {
      return []
    }

    if (!this.inversionSetActive) {
      const now = Date.now()
      if (
        this.lastInversionSetCheck !== 0 &&
        now - this.lastInversionSetCheck < INACTIVE_INVERSION_SET_CHECK_MS
      ) {
        return []
      }
      this.lastInversionSetCheck = now
      if (inversionSet.hasEntries && !(await inversionSet.hasEntries())) {
        return []
      }
    }

    const entries = await inversionSet.getAll()
    this.inversionSetActive = entries.length > 0
    return entries
  }

  /**
   * Writes provider results through the variant resolver so raw and inverted
   * subscriptions receive the same provider value.
   */
  protected async writeResults(results: TimestampedProviderResult<T>[]): Promise<void> {
    await this.responseCache.write(this.name, this.variantResolver.resolve(results))
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
