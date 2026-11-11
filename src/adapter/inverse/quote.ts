import type {
  ProviderResultGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderResult,
} from '../../util/types'
import { isRecord } from './config'
import { cloneResponse, errorResult, isErrorResponse, isPositiveFinite } from './transform'

type LwbaData = {
  bid?: unknown
  ask?: unknown
  mid?: unknown
  bidSize?: unknown
  askSize?: unknown
}

const validateQuote = (bid: unknown, ask: unknown, mid: unknown): string | undefined => {
  if (!isPositiveFinite(bid) || !isPositiveFinite(ask) || !isPositiveFinite(mid)) {
    return 'Inversion failed: bid, ask and mid must be finite positive numbers'
  }
  if (bid > ask || mid < bid || mid > ask) {
    return 'Inversion failed: bid, ask and mid must satisfy bid <= mid <= ask'
  }
  return undefined
}

export const invertQuote = <T extends ProviderResultGenerics>(
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
    return errorResult(result, 'Inversion failed: data must be an object')
  }

  const { bid, ask, mid, bidSize, askSize } = data as LwbaData
  if (!isPositiveFinite(bid) || !isPositiveFinite(ask)) {
    return errorResult(result, 'Inversion failed: bid and ask must be finite positive numbers')
  }

  const providerMid = mid === undefined || mid === null ? undefined : mid
  if (providerMid !== undefined && !isPositiveFinite(providerMid)) {
    return errorResult(result, 'Inversion failed: mid must be a finite positive number')
  }

  const newBid = 1 / ask
  const newAsk = 1 / bid
  const newMid = providerMid !== undefined ? 1 / providerMid : (newBid + newAsk) / 2

  const outputError = validateQuote(newBid, newAsk, newMid)
  if (outputError) {
    return errorResult(result, outputError)
  }

  const quote = data as LwbaData
  if (bidSize !== undefined || askSize !== undefined) {
    quote.bidSize = askSize
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
