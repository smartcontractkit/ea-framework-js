import type {
  ProviderResultGenerics,
  ResponseGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../util/types'
import { getRawInversionConfig } from './config'

/** Endpoint policy for response-shape-specific inversion. */
export interface InversionPolicy<T extends ProviderResultGenerics> {
  readonly id: string
  readonly version: number

  /** Invert a result. Returns a 502 result instead of throwing on invalid data. */
  transform(result: TimestampedProviderResult<T>): TimestampedProviderResult<T>
}

export const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export const isErrorResponse = (
  response: TimestampedAdapterResponse<ResponseGenerics>,
): response is TimestampedProviderErrorResponse => Boolean(response.errorMessage)

export const errorResult = <T extends ProviderResultGenerics>(
  result: TimestampedProviderResult<T>,
  message: string,
): TimestampedProviderResult<T> => ({
  params: result.params,
  response: {
    statusCode: 502,
    errorMessage: message,
    timestamps: result.response.timestamps,
  },
})

export const cloneResponse = <T>(response: T): T => JSON.parse(JSON.stringify(response)) as T

export const assertPolicyMatchesConfig = <T extends ProviderResultGenerics>(
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
