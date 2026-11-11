import type {
  ProviderResultGenerics,
  ResponseGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../util/types'

export type InversionTransform<T extends ProviderResultGenerics> = (
  result: TimestampedProviderResult<T>,
) => TimestampedProviderResult<T>

export const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export const isErrorResponse = (
  response: TimestampedAdapterResponse<ResponseGenerics>,
): response is TimestampedProviderErrorResponse => Boolean(response.errorMessage)

export const inversionError = <T extends ProviderResultGenerics>(
  params: TimestampedProviderResult<T>['params'],
  timestamps: TimestampedProviderResult<T>['response']['timestamps'],
  message: string,
): TimestampedProviderResult<T> => ({
  params,
  response: {
    statusCode: 502,
    errorMessage: message,
    timestamps,
  },
})

export const errorResult = <T extends ProviderResultGenerics>(
  result: TimestampedProviderResult<T>,
  message: string,
): TimestampedProviderResult<T> =>
  inversionError(result.params, result.response.timestamps, message)

export const cloneResponse = <T>(response: T): T => JSON.parse(JSON.stringify(response)) as T
