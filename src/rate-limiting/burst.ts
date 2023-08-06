import { AdapterRateLimitTier, RateLimiter } from '.'
import { AdapterEndpoint, EndpointGenerics } from '../adapter'
import { makeLogger, sleep } from '../util'

const logger = makeLogger('BurstRateLimiter')

/**
 * This rate limiter is the simplest stateful option.
 * It will keep track of used API credits (by default, one request equals one credit) and
 * upon reaching the limits in a fixed time window, will block the requests until API credits are available again.
 * On startup, it'll compare the different thresholds for each tier, calculate them all
 * in the finest window we'll use (seconds), and use the most restrictive one.
 * This is so if the EA were to restart, we don't need to worry about persisting state
 * for things like daily quotas. The downside is that this does not work well for bursty
 * loads or spikes, in cases where e.g. the per second limit is high but daily quotas low.
 */
export class BurstRateLimiter implements RateLimiter {
  latestSecondInterval = 0
  creditsThisSecond = 0
  latestMinuteInterval = 0
  creditsThisMinute = 0
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
      `Using API credit limit settings: perMinute = ${this.perMinuteLimit} | perSecond: = ${this.perSecondLimit}`,
    )
    return this
  }

  private updateIntervals() {
    const now = Date.now()
    const nearestSecondInterval = Math.floor(now / 1000)
    const nearestMinuteInterval = Math.floor(now / (1000 * 60))
    const nextSecondInterval = (nearestSecondInterval + 1) * 1000
    const nextMinuteInterval = (nearestMinuteInterval + 1) * 1000 * 60

    // This should always run to completion, even if it doesn't look atomic; therefore the
    // Ops should be "thread safe". Thank JS and its infinite single threaded dumbness.
    if (nearestSecondInterval !== this.latestSecondInterval) {
      logger.trace(
        `Clearing latest second interval, # of credits logged was: ${this.creditsThisSecond} `,
      )
      this.latestSecondInterval = nearestSecondInterval
      this.creditsThisSecond = 0
    }

    if (nearestMinuteInterval !== this.latestMinuteInterval) {
      logger.trace(
        `Clearing latest second minute, # of credits logged was: ${this.creditsThisMinute} `,
      )
      this.latestMinuteInterval = nearestMinuteInterval
      this.creditsThisMinute = 0
    }

    return {
      now,
      nextSecondInterval,
      nextMinuteInterval,
    }
  }

  msUntilNextExecution(): number {
    // If the limit is set to infinity, there was no tier limit specified
    if (this.perSecondLimit === Infinity && this.perMinuteLimit === Infinity) {
      return 0
    }

    const { now, nextSecondInterval, nextMinuteInterval } = this.updateIntervals()

    const timeToWaitForNextSecond =
      this.creditsThisSecond < this.perSecondLimit ? 0 : nextSecondInterval - now
    const timeToWaitForNextMinute =
      this.creditsThisMinute < this.perMinuteLimit ? 0 : nextMinuteInterval - now
    const timeToWait = Math.max(timeToWaitForNextSecond, timeToWaitForNextMinute)

    return timeToWait
  }

  async waitForRateLimit(creditCost = 1): Promise<void> {
    const timeToWait = this.msUntilNextExecution()

    if (timeToWait === 0) {
      logger.trace(
        `API credits under limits, current count: (S = ${this.creditsThisSecond} | M = ${this.creditsThisMinute}, | C = ${creditCost})`,
      )
    } else {
      logger.trace(
        `Capacity for provider API credits has been reached this interval (S = ${this.creditsThisSecond} | M = ${this.creditsThisMinute} | C = ${creditCost}), need to wait ${timeToWait}ms`,
      )
      await sleep(timeToWait)
      this.updateIntervals()
    }
    this.creditsThisSecond += creditCost
    this.creditsThisMinute += creditCost

    logger.trace(
      `Request is now ready to go, updated count: (S = ${this.creditsThisSecond} | M = ${this.creditsThisMinute})`,
    )

    return
  }
}
