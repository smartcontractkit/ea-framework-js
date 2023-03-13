import { RateLimiter, SimpleCountingRateLimiter } from '.'
import { FixedRateLimiter } from './fixed'

export enum RateLimitingStrategy {
  COUNTING = 'counting',
  FIXED = 'fixed',
}

export class RateLimiterFactory {
  static buildRateLimiter(strategy: RateLimitingStrategy): RateLimiter {
    switch (strategy) {
      case RateLimitingStrategy.COUNTING:
        return new SimpleCountingRateLimiter()
      case RateLimitingStrategy.FIXED:
        return new FixedRateLimiter()
    }
  }
}
