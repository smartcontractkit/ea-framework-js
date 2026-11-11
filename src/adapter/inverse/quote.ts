import type {
  ProviderResultGenerics,
  TimestampedAdapterResponse,
  TimestampedProviderResult,
} from '../../util/types'
import { isRecord } from './config'
import { cloneResponse, errorResult, isErrorResponse, isPositiveFinite } from './shared'

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
