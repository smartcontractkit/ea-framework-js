import { AdapterRateLimitTier, RateLimiter } from '.'
import { AdapterEndpoint, EndpointGenerics } from './../adapter'
import { makeLogger } from './../util'

const logger = makeLogger('SimpleCountingRateLimiter')

/**
 * This rate limiter is the simplest stateful option.
 * On startup, it'll compare the different thresholds for each tier, calculate them all
 * in the finest window we'll use (seconds), and use the most restrictive one.
 * This is so if the EA were to restart, we don't need to worry about persisting state
 * for things like daily quotas. The downside is that this does not work well for bursty
 * loads or spikes, in cases where e.g. the per second limit is high but daily quotas low.
 */
export class SimpleCountingRateLimiter implements RateLimiter {
  latestSecondInterval = 0
  requestsThisSecond = 0
  latestMinuteInterval = 0
  perSecondLimit!: number

  initialize<T extends EndpointGenerics>(
    endpoints: AdapterEndpoint<T>[],
    limits?: AdapterRateLimitTier,
  ) {
    // Translate the limit per hour and minutes into requirements per seconds
    const perHourLimit = (limits?.rateLimit1h || Infinity) / 3600
    const perMinuteLimit = Math.min((limits?.rateLimit1m || Infinity) / 60, perHourLimit)
    this.perSecondLimit = Number(
      Math.min(limits?.rateLimit1s || Infinity, perMinuteLimit).toFixed(2),
    )

    logger.debug(`Using rate limiting settings: perSecond: = ${this.perSecondLimit}`)

    return this
  }

  msUntilNextExecution(): number {
    // If the limit is set to infinity, there was no tier limit specified
    if (this.perSecondLimit === Infinity) {
      return 0
    }

    const now = Date.now()
    const nearestSecondInterval = Math.floor(now / 1000)
    const nextSecondInterval = (nearestSecondInterval + 1) * 1000
    const nextLimitInterval = (nearestSecondInterval + this.perSecondLimit) * 1000

    // This should always run to completion, even if it doesn't look atomic; therefore the
    // Ops should be "thread safe". Thank JS and its infinite single threaded dumbness.
    if (nearestSecondInterval !== this.latestSecondInterval) {
      logger.trace(
        `Clearing latest second interval, # of requests logged was: ${this.requestsThisSecond} `,
      )
      this.latestSecondInterval = nearestSecondInterval
      this.requestsThisSecond = 0
    }

    const timeToWait =
      this.requestsThisSecond + 1 < this.perSecondLimit ? 0 : nextLimitInterval - now

    if (timeToWait === 0) {
      this.requestsThisSecond++
      logger.trace(`Request under limits, counted +1 (S = ${this.requestsThisSecond})`)
      return nextSecondInterval - now
    } else {
      logger.trace(
        `Capacity for provider requests has been reached this interval (S = ${this.requestsThisSecond} , need to wait ${timeToWait}ms`,
      )
      return timeToWait
    }
  }
}
