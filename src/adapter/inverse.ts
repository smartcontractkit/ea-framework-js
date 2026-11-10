import { AdapterInputError } from '../validation/error'
import { makeLogger } from '../util/logger'
import type {
  ProviderResultGenerics,
  ResponseGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../util/types'

const logger = makeLogger('Inversion')

/** Name of the reserved request parameter that enables inversion. */
export const INVERSION_PARAM = 'inversion'

/** Config accepted from the request/jobspec. */
export type InversionRequestConfig = {
  enabled: boolean
}

/** Config as received in request params, before the policy metadata is trusted. */
export type RawInversionConfig = InversionRequestConfig & {
  policyId?: unknown
  policyVersion?: unknown
}

/** Config after the endpoint policy has been resolved and persisted in request params. */
export type ResolvedInversionConfig = InversionRequestConfig & {
  policyId: string
  policyVersion: number
}

/**
 * Endpoint-level policy that owns the response-shape-specific inversion behavior.
 * Cache and transport layers must not know whether the payload contains
 * `result`, `bid`, `ask` or any other response field.
 */
export interface InversionPolicy<T extends ProviderResultGenerics> {
  readonly id: string
  readonly version: number

  /** Validate and normalise the request config. Throws AdapterInputError on invalid input. */
  validateRequestConfig(config: unknown): InversionRequestConfig

  /** Resolve the request config against this policy. */
  resolveConfig(config: InversionRequestConfig): ResolvedInversionConfig

  /**
   * Validate the raw result, apply inversion, and validate the output.
   * Returns a 502 error result instead of throwing when inversion cannot be applied.
   */
  transform(result: TimestampedProviderResult<T>): TimestampedProviderResult<T>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isErrorResponse = (
  response: TimestampedAdapterResponse<ResponseGenerics>,
): response is TimestampedProviderErrorResponse => 'errorMessage' in response

const errorResult = <T extends ProviderResultGenerics>(
  result: TimestampedProviderResult<T>,
  message: string,
): TimestampedProviderResult<T> => {
  logger.warn(message)
  return {
    params: result.params,
    response: {
      statusCode: 502,
      errorMessage: message,
      timestamps: result.response.timestamps,
    },
  }
}

const cloneResponse = <T>(response: T): T => JSON.parse(JSON.stringify(response)) as T

const assertPolicyMatchesConfig = <T extends ProviderResultGenerics>(
  result: TimestampedProviderResult<T>,
  id: string,
  version: number,
): TimestampedProviderResult<T> | undefined => {
  const config = getRawInversionConfig(result.params)
  if (!config?.enabled) {
    return result
  }
  if (config.policyId !== id || config.policyVersion !== version) {
    const configuredPolicy =
      typeof config.policyId === 'string' && typeof config.policyVersion === 'number'
        ? `${config.policyId} v${config.policyVersion}`
        : 'missing or invalid policy metadata'
    return errorResult(
      result,
      `Inversion failed: config policy ${configuredPolicy} does not match ${id} v${version}`,
    )
  }
  return undefined
}

const validateRequestConfig = (config: unknown): InversionRequestConfig => {
  if (!isRecord(config)) {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: ${INVERSION_PARAM}] must be an object`,
    })
  }

  const unknownKeys = Object.keys(config).filter((key) => key !== 'enabled')
  if (unknownKeys.length) {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: ${INVERSION_PARAM}] contains unsupported keys: ${unknownKeys.join(', ')}`,
    })
  }

  if (typeof config['enabled'] !== 'boolean') {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: ${INVERSION_PARAM}.enabled] must be a boolean`,
    })
  }

  return { enabled: config['enabled'] as boolean }
}

const resolveConfig = (
  id: string,
  version: number,
  config: InversionRequestConfig,
): ResolvedInversionConfig => ({
  enabled: config.enabled,
  policyId: id,
  policyVersion: version,
})

/**
 * Read the raw inversion config from request/result params.
 *
 * This intentionally checks for the property before reading it so it stays
 * safe for Proxy-based test doubles (e.g. `makeStub`) that throw on unknown
 * property access.
 */
export const getRawInversionConfig = (params: unknown): RawInversionConfig | undefined => {
  if (!isRecord(params)) {
    return undefined
  }
  if (!Object.prototype.hasOwnProperty.call(params, INVERSION_PARAM)) {
    return undefined
  }
  const config = params[INVERSION_PARAM]
  if (!isRecord(config) || typeof config['enabled'] !== 'boolean') {
    return undefined
  }
  return {
    enabled: config['enabled'],
    policyId: config['policyId'],
    policyVersion: config['policyVersion'],
  }
}

/** Whether this request/result params explicitly enable inversion. */
export const hasInversionEnabled = (params: unknown): boolean =>
  getRawInversionConfig(params)?.enabled === true

/** Read and validate a fully resolved inversion config from request/result params. */
export const getInversionConfig = (params: unknown): ResolvedInversionConfig | undefined => {
  const config = getRawInversionConfig(params)
  if (
    !config ||
    typeof config.policyId !== 'string' ||
    typeof config.policyVersion !== 'number' ||
    !Number.isFinite(config.policyVersion)
  ) {
    return undefined
  }
  return {
    enabled: config.enabled,
    policyId: config.policyId,
    policyVersion: config.policyVersion,
  }
}

/** Remove the framework-only inversion config before provider calls. */
export const stripInversionConfig = <T extends Record<string, unknown>>(params: T): T => {
  if (!Object.prototype.hasOwnProperty.call(params, INVERSION_PARAM)) {
    return params
  }
  const copy = { ...params }
  delete copy[INVERSION_PARAM]
  return copy
}

export class SingleValueInversionPolicy<
  T extends ProviderResultGenerics = ProviderResultGenerics,
> implements InversionPolicy<T> {
  readonly id = 'single-value'
  readonly version = 1

  validateRequestConfig(config: unknown): InversionRequestConfig {
    return validateRequestConfig(config)
  }

  resolveConfig(config: InversionRequestConfig): ResolvedInversionConfig {
    return resolveConfig(this.id, this.version, config)
  }

  transform(result: TimestampedProviderResult<T>): TimestampedProviderResult<T> {
    if (isErrorResponse(result.response)) {
      return result
    }

    const mismatch = assertPolicyMatchesConfig(result, this.id, this.version)
    if (mismatch) {
      return mismatch
    }

    let response: TimestampedAdapterResponse<T['Response']>
    try {
      response = cloneResponse(result.response)
    } catch {
      return errorResult(result, 'Inversion failed: response could not be cloned')
    }

    const data = (response as { data?: unknown }).data
    const rawResult = isRecord(data) ? data['result'] : undefined
    if (!isPositiveFinite(rawResult)) {
      return errorResult(result, 'Inversion failed: data.result must be a finite positive number')
    }

    const invertedResult = 1 / rawResult
    if (!isPositiveFinite(invertedResult)) {
      return errorResult(
        result,
        'Inversion failed: inverted result is not a finite positive number',
      )
    }

    if (isRecord(data)) {
      data['result'] = invertedResult
    }
    const responseWithResult = response as { result?: unknown }
    responseWithResult.result = invertedResult

    return {
      params: result.params,
      response,
    }
  }
}

type LwbaData = {
  bid?: unknown
  ask?: unknown
  mid?: unknown
  bidSize?: unknown
  askSize?: unknown
}

const validateQuote = (bid: unknown, ask: unknown, mid: number): string | undefined => {
  if (!isPositiveFinite(bid) || !isPositiveFinite(ask)) {
    return 'Inversion failed: bid and ask must be finite positive numbers'
  }
  if (!isPositiveFinite(mid)) {
    return 'Inversion failed: mid must be a finite positive number'
  }
  if (bid > ask) {
    return 'Inversion failed: bid must be less than or equal to ask'
  }
  if (mid < bid || mid > ask) {
    return 'Inversion failed: mid must be between bid and ask'
  }
  return undefined
}

export class QuoteInversionPolicy<
  T extends ProviderResultGenerics = ProviderResultGenerics,
> implements InversionPolicy<T> {
  readonly id = 'lwba'
  readonly version = 1

  validateRequestConfig(config: unknown): InversionRequestConfig {
    return validateRequestConfig(config)
  }

  resolveConfig(config: InversionRequestConfig): ResolvedInversionConfig {
    return resolveConfig(this.id, this.version, config)
  }

  transform(result: TimestampedProviderResult<T>): TimestampedProviderResult<T> {
    if (isErrorResponse(result.response)) {
      return result
    }

    const mismatch = assertPolicyMatchesConfig(result, this.id, this.version)
    if (mismatch) {
      return mismatch
    }

    let response: TimestampedAdapterResponse<T['Response']>
    try {
      response = cloneResponse(result.response)
    } catch {
      return errorResult(result, 'Inversion failed: response could not be cloned')
    }

    const data = (response as { data?: unknown }).data
    if (!isRecord(data)) {
      return errorResult(result, 'Inversion failed: data must be an object')
    }

    const quote = data as LwbaData
    const providerMidPresent = quote.mid !== undefined && quote.mid !== null
    const rawMid = providerMidPresent ? quote.mid : undefined

    if (providerMidPresent) {
      const error = validateQuote(quote.bid, quote.ask, rawMid as number)
      if (error) {
        return errorResult(result, error)
      }
    } else {
      if (!isPositiveFinite(quote.bid) || !isPositiveFinite(quote.ask)) {
        return errorResult(result, 'Inversion failed: bid and ask must be finite positive numbers')
      }
      if (quote.bid > quote.ask) {
        return errorResult(result, 'Inversion failed: bid must be less than or equal to ask')
      }
    }

    const newBid = 1 / (quote.ask as number)
    const newAsk = 1 / (quote.bid as number)
    const newMid = providerMidPresent ? 1 / (rawMid as number) : (newBid + newAsk) / 2

    const outputError = validateQuote(newBid, newAsk, newMid)
    if (outputError) {
      return errorResult(result, outputError)
    }

    if (quote.bidSize !== undefined || quote.askSize !== undefined) {
      const bidSize = quote.bidSize
      quote.bidSize = quote.askSize
      quote.askSize = bidSize
    }
    quote.bid = newBid
    quote.ask = newAsk
    quote.mid = newMid

    return {
      params: result.params,
      response,
    }
  }
}
