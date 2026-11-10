import type { TransportGenerics } from '..'
import { hasInversionEnabled, stripInversionConfig } from '../../adapter/inverse'
import { censorLogs, makeLogger } from '../../util'
import type { TimestampedProviderResult } from '../../util/types'
import type { TypeFromDefinition } from '../../validation/input-params'

const logger = makeLogger('ProviderVariantResolver')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeParams = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.toLowerCase()
  }
  if (Array.isArray(value)) {
    return value.map(normalizeParams)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeParams(value[key])]),
    )
  }
  return value
}

const stableStringify = (value: unknown): string => JSON.stringify(normalizeParams(value))

/** Stable key for grouping subscriptions that share the same provider-facing params. */
export const calculateProviderParamsKey = (params: Record<string, unknown>): string =>
  stableStringify(stripInversionConfig(params))

/**
 * Groups raw and inverted subscriptions by provider-facing params and fans
 * provider results back out to every active output variant.
 */
export class ProviderVariantResolver<T extends TransportGenerics> {
  private variants = new Map<string, TypeFromDefinition<T['Parameters']>[]>()
  private knownKeys = new Set<string>()
  private missedKeys = new Set<string>()

  get size(): number {
    return this.variants.size
  }

  group(entries: TypeFromDefinition<T['Parameters']>[]): TypeFromDefinition<T['Parameters']>[] {
    const hasInversion = entries.some((entry) => hasInversionEnabled(entry))

    if (!hasInversion) {
      this.reset()
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

    this.reset()

    const providerEntries: TypeFromDefinition<T['Parameters']>[] = []
    for (const [key, group] of groups) {
      this.knownKeys.add(key)
      const hasInversionVariant = group.some((entry) => hasInversionEnabled(entry))

      if (!hasInversionVariant) {
        providerEntries.push(...group)
        continue
      }

      const providerParams = stripInversionConfig(
        group[0] as Record<string, unknown>,
      ) as TypeFromDefinition<T['Parameters']>
      providerEntries.push(providerParams)
      this.variants.set(key, group)
    }

    return providerEntries
  }

  resolve(results: TimestampedProviderResult<T>[]): TimestampedProviderResult<T>[] {
    if (!this.variants.size) {
      return results
    }

    return results.flatMap((result) => {
      const params = result.params as Record<string, unknown>
      const key = calculateProviderParamsKey(params)
      const variants = this.variants.get(key)

      if (!variants?.length) {
        if (!this.knownKeys.has(key) && !this.missedKeys.has(key) && this.missedKeys.size < 1000) {
          this.missedKeys.add(key)
          censorLogs(() =>
            logger.warn(
              `No inversion variant matched provider result params: ${key}. The inverse cache entry was not written.`,
            ),
          )
        }
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

  private reset(): void {
    this.variants.clear()
    this.knownKeys.clear()
  }
}
