import { AdapterRateLimitTier, BackgroundExecuteRateLimiter, lowestTierLimit } from '..'
import { AdapterEndpoint, EndpointGenerics } from '../../adapter'
import { makeLogger } from '../../util'

const logger = makeLogger('FixedFrequencyRateLimiter')
export const DEFAULT_SHARED_MS_BETWEEN_REQUESTS = 5000

export class FixedFrequencyRateLimiter implements BackgroundExecuteRateLimiter {
  msBetweenRequestsMap: {
    [endpointName: string]: number // In ms
  } = {}

  initialize<T extends EndpointGenerics>(
    endpoints: AdapterEndpoint<T>[],
    limits?: AdapterRateLimitTier,
  ) {
    // Translate the hourly limit into reqs per minute
    let sharedMsBetweenRequests = 1000 / lowestTierLimit(limits)

    // If there is no limit set, we use some reasonable number
    if (!limits?.rateLimit1h && !limits?.rateLimit1m && !limits?.rateLimit1s) {
      // 5s period for all seems good
      sharedMsBetweenRequests = DEFAULT_SHARED_MS_BETWEEN_REQUESTS
    }

    logger.debug('Using fixed frequency batch rate limiting')
    for (const endpoint of endpoints) {
      if (endpoint.rateLimiting?.allocationPercentage == null) {
        throw new Error(`Allocation percentage for endpoint "${endpoint.name}" is null`)
      }

      this.msBetweenRequestsMap[endpoint.name] =
        (sharedMsBetweenRequests / endpoint.rateLimiting?.allocationPercentage) * 100

      logger.debug(
        `Endpoint [${endpoint.name}]: ${
          this.msBetweenRequestsMap[endpoint.name] / 1000
        }s between requests`,
      )
    }

    return this
  }

  msUntilNextExecution(endpointName: string): number {
    return this.msBetweenRequestsMap[endpointName]
  }
}
