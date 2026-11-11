import type {
  ProviderResultGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderResult,
} from '../../util/types'
import { isRecord } from './config'
import {
  assertPolicyMatchesConfig,
  cloneResponse,
  errorResult,
  InversionPolicy,
  isErrorResponse,
  isPositiveFinite,
} from './policy'

export class SingleValueInversionPolicy<
  T extends ProviderResultGenerics = ProviderResultGenerics,
> implements InversionPolicy<T> {
  readonly id = 'single-value'
  readonly version = 1

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
