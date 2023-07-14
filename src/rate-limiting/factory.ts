import { BurstRateLimiter, RateLimiter } from '.'
import { FixedIntervalRateLimiter } from './fixed-interval'

export enum RateLimitingStrategy {
  BURST = 'burst',
  FIXED_INTERVAL = 'fixed-interval',
}

export class RateLimiterFactory {
  static buildRateLimiter(strategy: RateLimitingStrategy): RateLimiter {
    switch (strategy) {
      case RateLimitingStrategy.BURST:
        return new BurstRateLimiter()
      case RateLimitingStrategy.FIXED_INTERVAL:
        return new FixedIntervalRateLimiter()
    }
  }
}
