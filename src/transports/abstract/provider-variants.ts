/**
 * Keeps one provider subscription per provider-facing param set and fans each
 * result out to the active raw and inverse cache variants.
 */
import type { TransportGenerics } from '..'
import { hasInversionEnabled, toProviderParams } from '../../adapter/inverse'
import type { TimestampedProviderResult } from '../../util/types'
import type { TypeFromDefinition } from '../../validation/input-params'

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

/** Key for subscriptions sharing provider-facing params. */
export const calculateProviderParamsKey = (params: Record<string, unknown>): string =>
  stableStringify(toProviderParams(params))

export class ProviderVariantResolver<T extends TransportGenerics> {
  private variants = new Map<string, TypeFromDefinition<T['Parameters']>[]>()

  group(entries: TypeFromDefinition<T['Parameters']>[]): TypeFromDefinition<T['Parameters']>[] {
    const hasInversion = entries.some((entry) => hasInversionEnabled(entry))

    if (!hasInversion) {
      this.reset()
      return entries
    }

    const groups = entries.reduce((grouped, entry) => {
      const key = calculateProviderParamsKey(entry as Record<string, unknown>)
      const group = grouped.get(key)
      if (group) {
        group.push(entry)
      } else {
        grouped.set(key, [entry])
      }
      return grouped
    }, new Map<string, TypeFromDefinition<T['Parameters']>[]>())

    this.reset()

    return Array.from(groups, ([key, group]) => {
      const hasInversionVariant = group.some((entry) => hasInversionEnabled(entry))
      if (!hasInversionVariant) {
        return group[0]
      }

      this.variants.set(key, group)
      return toProviderParams(group[0] as Record<string, unknown>) as TypeFromDefinition<
        T['Parameters']
      >
    })
  }

  resolve(results: TimestampedProviderResult<T>[]): TimestampedProviderResult<T>[] {
    if (!this.variants.size) {
      return results
    }

    return results.flatMap((result) => {
      const params = result.params as Record<string, unknown>
      const key = calculateProviderParamsKey(params)
      const variants = this.variants.get(key)

      if (!variants) {
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
  }
}
