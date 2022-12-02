import * as client from 'prom-client'

// Retrieve cost field from response if exists
// If not return default cost of 1
export const retrieveCost = <ProviderResponseBody>(data: ProviderResponseBody): number => {
  const cost = (data as Record<string, unknown>)?.['cost']
  if (typeof cost === 'number' || typeof cost === 'string') {
    return Number(cost)
  } else {
    return 1
  }
}

export const rateLimitCreditsSpentTotal = new client.Counter({
  name: 'rate_limit_credits_spent_total',
  help: 'The number of data provider credits the adapter is consuming',
  labelNames: ['participant_id', 'feed_id'] as const,
})
