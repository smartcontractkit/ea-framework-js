import { AdapterEndpoint, EndpointGenerics } from '../adapter'
import { AdapterSettings } from '../config'
import { makeLogger } from '../util'

export * from './burst'

const logger = makeLogger('RateLimitingUtils')

export interface AdapterRateLimitTier {
  rateLimit1s?: number
  rateLimit1m?: number
  rateLimit1h?: number
  note?: string
}

/**
 * Common interface for all RateLimiter classes to implement
 */
export interface RateLimiter {
  /**
   * Method to ensure all RateLimiters can be initialized in the same manner.
   *
   * @param limits - settings for how much throughput to allow for the Adapter
   * @param endpoints - list of adapter endpoints
   */
  initialize<T extends EndpointGenerics>(
    endpoints: AdapterEndpoint<T>[],
    limits?: AdapterRateLimitTier,
  ): this

  /**
   * This method will block (if necessary) until the rate limiter can make sure the
   * next outbound request will be within the specified limits.
   */
  waitForRateLimit(): Promise<void>

  /**
   * Returns the time in milliseconds until the next request would be able to be fired
   */
  msUntilNextExecution(): number
}

/**
 * This method will convert all possible settings for a rate limit tier and
 * convert them all to requests per second
 *
 * @param limits - the rate limit tier set for the adapter
 * @returns all rate limits values in seconds
 */
export const consolidateTierLimits = (limits?: AdapterRateLimitTier) => {
  const perHourLimit = (limits?.rateLimit1h || Infinity) / (60 * 60)
  const perMinuteLimit = (limits?.rateLimit1m || Infinity) / 60
  const perSecondLimit = limits?.rateLimit1s || Infinity
  return [perHourLimit, perMinuteLimit, perSecondLimit]
}

/**
 * This method will convert all possible settings for a rate limit tier and
 * convert them all to requests per second, returning the highest one
 *
 * @param limits - the rate limit tier set for the adapter
 * @returns the most permissive of the set options, in requests per second
 */
export const highestTierLimit = (limits?: AdapterRateLimitTier) => {
  const consolidateLimits = consolidateTierLimits(limits).map((tier) => {
    if (tier === Infinity) {
      return 0
    }
    return tier
  })
  return Math.max(...consolidateLimits)
}

/**
 * This method will convert all possible settings for a rate limit tier and
 * convert them all to requests per second, returning the lowest one
 *
 * @param limits - the rate limit tier set for the adapter
 * @returns the most restrictive of the set options, in requests per second
 */
export const lowestTierLimit = (limits?: AdapterRateLimitTier) => {
  return Math.min(...consolidateTierLimits(limits))
}

/**
 * Validates rate limiting tiers specified for the adapter, and returns the one to use.
 *
 * @param adapterSettings - the adapter config containing the env vars
 * @param tiers - the adapter config listing the different available API tiers
 * @returns the specified API tier, or a default one if none are specified
 */
export const getRateLimitingTier = (
  adapterSettings: AdapterSettings,
  tiers?: Record<string, AdapterRateLimitTier>,
): AdapterRateLimitTier | undefined => {
  if (
    adapterSettings.RATE_LIMIT_CAPACITY ||
    adapterSettings.RATE_LIMIT_CAPACITY_MINUTE ||
    adapterSettings.RATE_LIMIT_CAPACITY_SECOND
  ) {
    return buildRateLimitTiersFromConfig(adapterSettings)
  }
  if (!tiers) {
    return
  }

  // Check that if the tiers object is defined, it has values
  if (Object.values(tiers).length === 0) {
    throw new Error(`The tiers object is defined, but has no entries`)
  }

  // Check that the tier set in the AdapterConfig is a valid one
  const selectedTier = adapterSettings.RATE_LIMIT_API_TIER
  if (selectedTier && !tiers[selectedTier]) {
    const validTiersString = Object.keys(tiers)
      .map((t) => `"${t}"`)
      .join(', ')

    throw new Error(
      `The selected rate limit tier "${selectedTier}" is not valid (can be one of ${validTiersString})`,
    )
  }

  if (!selectedTier) {
    // Sort the tiers by most to least restrictive
    const sortedTiers = Object.entries(tiers).sort(
      ([_, t1], [__, t2]) => lowestTierLimit(t1) - lowestTierLimit(t2),
    )

    const [selectedName, selectedLimits] = sortedTiers[0]
    logger.info(`There was no rate limiting tier specified, will use lowest one (${selectedName})`)
    return selectedLimits
  }

  logger.info(`Using specified tier "${selectedTier}"`)
  return tiers[selectedTier]
}

// Creates adapter rate limit tier using the configs specified in env vars
export const buildRateLimitTiersFromConfig = (
  adapterSettings: AdapterSettings,
): AdapterRateLimitTier | undefined => {
  const rateLimit1s = adapterSettings.RATE_LIMIT_CAPACITY_SECOND
  let rateLimit1m
  if (adapterSettings.RATE_LIMIT_CAPACITY_MINUTE) {
    rateLimit1m = adapterSettings.RATE_LIMIT_CAPACITY_MINUTE
  } else if (adapterSettings.RATE_LIMIT_CAPACITY) {
    rateLimit1m = adapterSettings.RATE_LIMIT_CAPACITY
  }
  return {
    rateLimit1s,
    rateLimit1m,
  }
}

export const highestRateLimitTiers = (tiers?: Record<string, AdapterRateLimitTier>) => {
  if (!tiers) {
    return 0
  }

  if (Object.values(tiers).length === 0) {
    throw new Error(`The tiers object is defined, but has no entries`)
  }

  // Sort tiers in a descending way
  const highestTiers = Object.values(tiers).sort(
    (t1, t2) => highestTierLimit(t2) - highestTierLimit(t1),
  )
  return highestTierLimit(highestTiers[0])
}
