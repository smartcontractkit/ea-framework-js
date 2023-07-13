import { BurstRateLimiter, RateLimiter } from '.'
import { FixedIntervalRateLimiter } from './fixed-interval'
import { ApiCreditsRateLimiter } from './api-credits'

export enum RateLimitingStrategy {
  BURST = 'burst',
  API_CREDIT = 'api-credit',
  FIXED_INTERVAL = 'fixed-interval',
}

export class RateLimiterFactory {
  static buildRateLimiter(strategy: RateLimitingStrategy): RateLimiter {
    switch (strategy) {
      case RateLimitingStrategy.BURST:
        return new BurstRateLimiter()
      case RateLimitingStrategy.FIXED_INTERVAL:
        return new FixedIntervalRateLimiter()
      case RateLimitingStrategy.API_CREDIT:
        return new ApiCreditsRateLimiter()
    }
  }
}
