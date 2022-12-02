export enum HttpRequestType {
  CACHE_HIT = 'cacheHit',
  DATA_PROVIDER_HIT = 'dataProviderHit',
  ADAPTER_ERROR = 'adapterError',
  INPUT_ERROR = 'inputError',
  RATE_LIMIT_ERROR = 'rateLimitError',
  // BURST_LIMIT_ERROR = 'burstLimitError',
  // BACKOFF_ERROR = 'backoffError',
  DP_ERROR = 'dataProviderError',
  TIMEOUT_ERROR = 'timeoutError',
  CONNECTION_ERROR = 'connectionError',
  // RES_EMPTY_ERROR = 'responseEmptyError',
  // RES_INVALID_ERROR = 'responseInvalidError',
  CUSTOM_ERROR = 'customError',
}

/**
 * Maxiumum number of characters that a feedId can contain.
 */
export const MAX_FEED_ID_LENGTH = 300

// We should tune these as we collect data, this is the default bucket distribution that prom comes with
export const requestDurationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
