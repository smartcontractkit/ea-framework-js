import { makeLogger } from './logger'

const logger = makeLogger('ResultNumberValidation')

/**
 * Result of validating a numeric value from a data provider.
 * Either the coerced, validated number, or a provider error response
 * (statusCode 502) that can be returned directly as a ProviderResult response.
 */
export type ValidatedResultNumber = { result: number } | { statusCode: 502; errorMessage: string }

export interface ValidateResultNumberOptions {
  /**
   * Whether 0 should be treated as a valid result.
   * Defaults to true (funding rates, realized volatility, yields can legitimately be 0).
   * Set to false for feeds where 0 always indicates missing/invalid data.
   */
  acceptZeroValue?: boolean
}

/**
 * Type guard for the error branch of ValidatedResultNumber.
 */
export const isProviderError = (
  v: ValidatedResultNumber,
): v is { statusCode: 502; errorMessage: string } => 'statusCode' in v

/**
 * Validates that a raw value from a data provider is a usable numeric result.
 *
 * The raw value is checked BEFORE any Number() coercion so that null/undefined
 * cannot silently become 0 (Number(null) === 0). Invalid values produce a 502
 * error response, allowing the Node to fall back to the bridge cache (last
 * known good value).
 *
 * Never throws: transports must RETURN the error object so it flows through
 * the response cache and reaches the Node as a 502. Throwing inside
 * HttpTransport.parseResponse would fall into a generic catch and be dropped.
 *
 * | input            | output           |
 * |------------------|------------------|
 * | null, undefined  | 502              |
 * | NaN, "NaN"       | 502              |
 * | "", "   "        | 502              |
 * | {}, [], booleans | 502              |
 * | +/-Infinity      | 502              |
 * | 12.3, "12.3"     | { result: 12.3 } |
 * | 0, "0"           | { result: 0 }    | (default; see acceptZeroValue)
 *
 * @param value - the raw, uncoerced value from the provider response
 * @param errorMessage - message returned to the caller when the value is invalid
 * @param options - see ValidateResultNumberOptions
 */
export function validateResultNumber(
  value: unknown,
  errorMessage: string,
  options?: ValidateResultNumberOptions,
): ValidatedResultNumber {
  const acceptZeroValue = options?.acceptZeroValue ?? true

  const isWrongType = typeof value !== 'number' && typeof value !== 'string'
  const trimmed = typeof value === 'string' ? value.trim() : value
  const num = Number(trimmed)

  const isInvalid =
    isWrongType || trimmed === '' || !Number.isFinite(num) || (!acceptZeroValue && num === 0)

  if (isInvalid) {
    logger.warn(`${errorMessage} (received: ${JSON.stringify(value)})`)
    return { statusCode: 502, errorMessage }
  }

  return { result: num }
}
