import { AdapterRateLimitTier, RateLimiter } from '.'
import { AdapterEndpoint, EndpointGenerics } from '../adapter'
import { makeLogger, sleep } from '../util'

const logger = makeLogger('FixedRateLimiter')

/**
 * The simplest version of a rate limit. This will not take any bursts into accoung,
 * and always rely on a fixed request per second rate. The only "complex" mechanism it has
 * is checking when the last request was made to this rate limiter, to account for a period
 * of time with no requests and avoiding the wait of the initial request.
 */
export class FixedRateLimiter implements RateLimiter {
  period!: number
  lastRequestAt: number | null = null

  initialize<T extends EndpointGenerics>(
    endpoints: AdapterEndpoint<T>[],
    limits?: AdapterRateLimitTier,
  ) {
    // Translate the hourly and minute limits into reqs per minute
    const perHourLimitInRPS = (limits?.rateLimit1h || Infinity) / 60 / 60
    const perMinuteLimitInRPS = (limits?.rateLimit1m || Infinity) / 60
    const perSecondLimitInRPS = limits?.rateLimit1s || Infinity
    this.period = (1 / Math.min(perHourLimitInRPS, perMinuteLimitInRPS, perSecondLimitInRPS)) * 1000
    logger.debug(`Using fixed rate limiting settings: period = ${this.period}`)

    return this
  }

  msUntilNextExecution(): number {
    const now = Date.now()

    if (!this.lastRequestAt) {
      logger.trace(
        `First request for the rate limiter, sending immediately. All subsequent requests will wait ${this.period}ms.`,
      )
      return 0
    }

    const timeSinceLastRequest = now - this.lastRequestAt // Positive int
    const remainingTime = Math.max(0, this.period - timeSinceLastRequest)
    const timeToWait = Math.min(this.period, remainingTime)
    logger.trace(`Rate limiting details:
      now: ${now}
      timeSinceLastRequest: ${timeSinceLastRequest}
      period: ${this.period}
      remainingTime: ${remainingTime}
      timeToWait: ${timeToWait}
    `)
    return timeToWait
  }

  async waitForRateLimit(): Promise<void> {
    const timeToWait = this.msUntilNextExecution()
    if (timeToWait > 0) {
      logger.debug(`Sleeping for ${timeToWait}ms to wait for rate limiting interval to pass`)
      await sleep(timeToWait)
    } else {
      logger.debug(`Enough time has passed since last request, no need to sleep`)
    }
    this.lastRequestAt = Date.now()
  }
}
