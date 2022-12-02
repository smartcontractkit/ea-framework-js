import { AdapterRateLimitTier, RateLimiter } from '..'
import { AdapterEndpoint, EndpointGenerics } from '../../adapter'
import { makeLogger } from '../../util'

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
  requestsThisMinute = 0
  perSecondLimit!: number
  perMinuteLimit!: number

  initialize<T extends EndpointGenerics>(
    endpoints: AdapterEndpoint<T>[],
    limits?: AdapterRateLimitTier,
  ) {
    // Translate the hourly limit into reqs per minute
    const perHourLimit = (limits?.rateLimit1h || Infinity) / 60
    this.perMinuteLimit = Math.min(limits?.rateLimit1m || Infinity, perHourLimit)
    this.perSecondLimit = limits?.rateLimit1s || Infinity
    logger.debug(
      `Using rate limiting settings: perMinute = ${this.perMinuteLimit} | perSecond: = ${this.perSecondLimit}`,
    )

    return this
  }

  msUntilNextExecution(): number {
    // If the limit is set to infinity, there was no tier limit specified
    if (this.perSecondLimit === Infinity && this.perMinuteLimit === Infinity) {
      return 0
    }

    const now = Date.now()
    const nearestSecondInterval = Math.floor(now / 1000)
    const nearestMinuteInterval = Math.floor(now / (1000 * 60))
    const nextSecondInterval = (nearestSecondInterval + 1) * 1000
    const nextMinuteInterval = (nearestMinuteInterval + 1) * 1000 * 60

    // This should always run to completion, even if it doesn't look atomic; therefore the
    // Ops should be "thread safe". Thank JS and its infinite single threaded dumbness.
    if (nearestSecondInterval !== this.latestSecondInterval) {
      logger.trace(
        `Clearing latest second interval, # of requests logged was: ${this.requestsThisSecond} `,
      )
      this.latestSecondInterval = nearestSecondInterval
      this.requestsThisSecond = 0
    }

    if (nearestMinuteInterval !== this.latestMinuteInterval) {
      logger.trace(
        `Clearing latest second minute, # of requests logged was: ${this.requestsThisMinute} `,
      )
      this.latestMinuteInterval = nearestMinuteInterval
      this.requestsThisMinute = 0
    }

    const timeToWaitForNextSecond =
      this.requestsThisSecond < this.perSecondLimit ? 0 : nextSecondInterval - now
    const timeToWaitForNextMinute =
      this.requestsThisMinute < this.perMinuteLimit ? 0 : nextMinuteInterval - now
    const timeToWait = Math.max(timeToWaitForNextSecond, timeToWaitForNextMinute)

    if (timeToWait === 0) {
      logger.trace('Request under limits, counting +1')
      this.requestsThisSecond++
      this.requestsThisMinute++
      return 0
    } else {
      logger.trace(`Requests seen this interval are above limits, need to wait ${timeToWait}ms`)
      return timeToWait
    }
  }
}
