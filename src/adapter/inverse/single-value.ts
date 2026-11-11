import type {
  ProviderResultGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderResult,
} from '../../util/types'
import { isRecord } from './config'
import { cloneResponse, errorResult, isErrorResponse, isPositiveFinite } from './transform'

export const invertSingleValue = <T extends ProviderResultGenerics>(
  result: TimestampedProviderResult<T>,
): TimestampedProviderResult<T> => {
  if (isErrorResponse(result.response)) {
    return result
  }

  let response: TimestampedAdapterResponse<T['Response']>
  try {
    response = cloneResponse(result.response)
  } catch {
    return errorResult(result, 'Inversion failed: response could not be cloned')
  }

  const data = (response as { data?: unknown }).data
  if (!isRecord(data)) {
    return errorResult(result, 'Inversion failed: data.result must be a finite positive number')
  }

  const rawResult = data['result']
  if (!isPositiveFinite(rawResult)) {
    return errorResult(result, 'Inversion failed: data.result must be a finite positive number')
  }

  const invertedResult = 1 / rawResult
  if (!isPositiveFinite(invertedResult)) {
    return errorResult(result, 'Inversion failed: inverted result is not a finite positive number')
  }

  data['result'] = invertedResult
  const responseWithResult = response as { result?: unknown }
  responseWithResult.result = invertedResult

  return {
    params: result.params,
    response,
  }
}
