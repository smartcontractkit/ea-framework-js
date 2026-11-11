import type {
  ProviderResultGenerics,
  ResponseGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../util/types'
import { getInversionConfig, INVERSION_PARAM, isRecord } from './config'

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

const getPolicyMetadata = (params: unknown): { policyId?: unknown; policyVersion?: unknown } => {
  if (!isRecord(params)) {
    return {}
  }
  const config = params[INVERSION_PARAM]
  if (!isRecord(config)) {
    return {}
  }
  return {
    policyId: config['policyId'],
    policyVersion: config['policyVersion'],
  }
}

export const assertPolicyMatchesConfig = <T extends ProviderResultGenerics>(
  result: TimestampedProviderResult<T>,
  id: string,
  version: number,
): TimestampedProviderResult<T> | undefined => {
  const config = getInversionConfig(result.params)
  if (!config?.enabled) {
    return result
  }
  const { policyId, policyVersion } = getPolicyMetadata(result.params)
  if (policyId !== id || policyVersion !== version) {
    const configuredPolicy =
      typeof policyId === 'string' && typeof policyVersion === 'number'
        ? `${policyId} v${policyVersion}`
        : 'missing or invalid policy metadata'
    return errorResult(
      result,
      `Inversion failed: config policy ${configuredPolicy} does not match ${id} v${version}`,
    )
  }
  return undefined
}
