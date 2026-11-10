import { Transport, TransportDependencies, TransportGenerics } from '..'
import { EndpointContext } from '../../adapter'
import {
  calculateProviderParamsKey,
  hasInversionEnabled,
  stableStringify,
  stripInversionConfig,
} from '../../adapter/inverse'
import { ResponseCache } from '../../cache/response'
import { metrics } from '../../metrics'
import { SubscriptionSet, censorLogs, makeLogger } from '../../util'
import { AdapterRequest, TimestampedProviderResult } from '../../util/types'
import { TypeFromDefinition } from '../../validation/input-params'

const logger = makeLogger('SubscriptionTransport')

/**
 * Abstract Transport that will take incoming requests and add them to a subscription set as part
 * of the registration. Then it will provide those entries to the (abstract) backgroundHandler method.
 *
 * @typeParam T - all types related to the [[Transport]]
 */
export abstract class SubscriptionTransport<T extends TransportGenerics> implements Transport<T> {
  responseCache!: ResponseCache<T>
  subscriptionSet!: SubscriptionSet<TypeFromDefinition<T['Parameters']>>
  subscriptionTtl!: number
  name!: string
  initialized = false

  /**
   * Full subscription variants grouped by provider-facing parameters.
   * Only populated when at least one subscription for that provider key has
   * an inversion config.
   */
  protected providerVariants = new Map<string, TypeFromDefinition<T['Parameters']>[]>()

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

    const providerEntries = this.groupProviderEntries(entries)
    await this.backgroundHandler(context, providerEntries)
  }

  /**
   * Groups subscription entries by provider-facing params so raw and inverted
   * output variants share a single provider subscription/request.
   *
   * Existing behavior is preserved for provider keys that do not contain any
   * inversion-enabled variant.
   */
  private groupProviderEntries(
    entries: TypeFromDefinition<T['Parameters']>[],
  ): TypeFromDefinition<T['Parameters']>[] {
    const hasInversion = entries.some((entry) => hasInversionEnabled(entry))

    if (!hasInversion) {
      this.providerVariants.clear()
      return entries
    }

    const groups = new Map<string, TypeFromDefinition<T['Parameters']>[]>()

    for (const entry of entries) {
      const key = calculateProviderParamsKey(entry as Record<string, unknown>)
      const group = groups.get(key)
      if (group) {
        group.push(entry)
      } else {
        groups.set(key, [entry])
      }
    }

    this.providerVariants.clear()

    const providerEntries: TypeFromDefinition<T['Parameters']>[] = []
    for (const [key, group] of groups) {
      const hasInversionVariant = group.some((entry) => hasInversionEnabled(entry))

      if (!hasInversionVariant) {
        // Preserve exact previous behavior for groups without inversion.
        providerEntries.push(...group)
        continue
      }

      const providerParams = stripInversionConfig(
        group[0] as Record<string, unknown>,
      ) as TypeFromDefinition<T['Parameters']>
      providerEntries.push(providerParams)
      this.providerVariants.set(key, group)
    }

    return providerEntries
  }

  /**
   * Expands provider results into all active output variants for their provider key.
   * Shape-agnostic: inversion policy handles response fields.
   */
  protected resolveResultVariants(
    results: TimestampedProviderResult<T>[],
  ): TimestampedProviderResult<T>[] {
    if (!this.providerVariants.size) {
      return results
    }

    return results.flatMap((result) => {
      const params = result.params as Record<string, unknown>
      const key = calculateProviderParamsKey(params)
      const variants = this.providerVariants.get(key)

      if (!variants?.length || hasInversionEnabled(params)) {
        return [result]
      }

      const seen = new Set<string>()
      return variants
        .filter((variant) => {
          const variantKey = stableStringify(variant)
          if (seen.has(variantKey)) {
            return false
          }
          seen.add(variantKey)
          return true
        })
        .map((variant) => ({
          params: variant,
          response: result.response,
        }))
    })
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
