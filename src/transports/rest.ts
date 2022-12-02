import { AxiosRequestConfig, AxiosResponse } from 'axios'
import { Cache } from '../cache'
import { ResponseCache } from '../cache/response'
import { AdapterConfig } from '../config'
import { RequestRateLimiter } from '../rate-limiting'
import * as rateLimitMetrics from '../rate-limiting/metrics'
import { makeLogger, sleep } from '../util'
import {
  AdapterRequest,
  AdapterResponse,
  PartialAdapterResponse,
  TimestampedProviderResult,
} from '../util/request'
import { AdapterError } from '../validation/error'
import { Transport, TransportDependencies, TransportGenerics } from './'
import { axiosRequest } from './util'

export { AxiosRequestConfig as HttpRequestConfig, AxiosResponse as HttpResponse }

const IN_FLIGHT_PREFIX = 'InFlight'

const logger = makeLogger('RestTransport')

/**
 * Helper struct type that will be used to pass types to the generic parameters of a Transport.
 * Extends the common TransportGenerics, adding Provider specific types for this Batch endpoint.
 */
type RestTransportGenerics = TransportGenerics & {
  /**
   * Type details for any provider specific interfaces.
   */
  Provider: {
    /**
     * Structure of the body of the request that will be sent to the data provider.
     */
    RequestBody: unknown

    /**
     * Structure for the body of the response coming from the data provider.
     */
    ResponseBody: unknown
  }
}

/**
 * Config object that is provided to the RestTransport constructor.
 */
export interface RestTransportConfig<T extends RestTransportGenerics> {
  prepareRequest: (
    req: AdapterRequest<T['Request']>,
    config: AdapterConfig<T['CustomSettings']>,
  ) =>
    | AxiosRequestConfig<T['Provider']['RequestBody']>
    | Promise<AxiosRequestConfig<T['Provider']['RequestBody']>>
  parseResponse: (
    req: AdapterRequest<T['Request']>,
    res: AxiosResponse<T['Provider']['ResponseBody']>,
    config: AdapterConfig<T['CustomSettings']>,
  ) => PartialAdapterResponse<T['Response']> | Promise<PartialAdapterResponse<T['Response']>>
  options: {
    requestCoalescing: {
      enabled: boolean
      entropyMax?: number
    }
  }
}

/**
 * Transport implementation that takes incoming requests, transforms them into a DataProvider request,
 * and executes that request returning the response immediately from the `setup` function.
 * Optionally, setting the `coalescing` option to `true` will make it so once a request is in flight,
 * new adapter requests for the same feed will not trigger a new one, but return an empty promise from
 * the setup instead so the normal cache polling mechanism is used.
 *
 * @typeParam T - Helper struct type that will be used to pass types to the generic parameters (check [[RestTransportGenerics]])
 */
export class RestTransport<T extends RestTransportGenerics> implements Transport<T> {
  inFlightPrefix!: string
  responseCache!: ResponseCache<{
    Request: T['Request']
    Response: T['Response']
  }>
  inFlightCache!: Cache<boolean>
  rateLimiter!: RequestRateLimiter

  constructor(protected config: RestTransportConfig<T>) {}

  async initialize(
    dependencies: TransportDependencies<T>,
    config: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    this.responseCache = dependencies.responseCache
    this.inFlightPrefix = `${IN_FLIGHT_PREFIX}-`
    this.inFlightCache = dependencies.cache as Cache<boolean>
    this.rateLimiter = dependencies.requestRateLimiter

    // Allow enabling/disabling request coalescing through env var
    this.config.options.requestCoalescing.enabled = config.REQUEST_COALESCING_ENABLED
    this.config.options.requestCoalescing.entropyMax = config.REQUEST_COALESCING_ENTROPY_MAX
  }

  protected async waitUntilUnderRateLimit(
    options: {
      maxRetries: number
      msBetweenRetries: number
    },
    retry = 0,
  ) {
    if (this.rateLimiter.isUnderLimits()) {
      logger.trace('Incoming request would not be under limits, moving on')
      return
    }

    if (retry >= options.maxRetries) {
      throw new AdapterError({
        statusCode: 504,
        message: `REST Transport timed out while waiting for rate limit availability (max retries: ${options.maxRetries})`,
      })
    }

    logger.debug(`Request would be over rate limits, sleeping for ${options.msBetweenRetries}`)
    await sleep(options.msBetweenRetries)
    await this.waitUntilUnderRateLimit(options, retry + 1)
  }

  async foregroundExecute(
    req: AdapterRequest<T['Request']>,
    config: AdapterConfig<T['CustomSettings']>,
  ): Promise<AdapterResponse<T['Response']> | undefined> {
    // Add some entropy here because of possible scenario where the key won't be set before multiple
    // other instances in a burst request try to access the coalescing key.
    const randomMs = Math.random() * (this.config.options.requestCoalescing.entropyMax || 0)
    await sleep(randomMs)

    // Check if request is in flight if coalescing is enabled
    const inFlightKey = this.inFlightPrefix + req.requestContext.cacheKey
    const inFlight =
      this.config.options.requestCoalescing.enabled && (await this.inFlightCache.get(inFlightKey))
    if (inFlight) {
      logger.debug('Request is in flight, transport has been set up')
      return
    } else if (this.config.options.requestCoalescing.enabled) {
      // If it wasn't in flight and coalescing is disabled, register it as in flight
      const ttl =
        config.REST_TRANSPORT_MAX_RATE_LIMIT_RETRIES *
        config.REST_TRANSPORT_MS_BETWEEN_RATE_LIMIT_RETRIES
      logger.debug('Setting up rest transport, setting request in flight in cache')
      await this.inFlightCache.set(inFlightKey, true, ttl + 100) // Can't use Infinity for things like Redis
    }

    const request = await this.config.prepareRequest(req, config)

    logger.trace('Check if we are under rate limits to perform request')
    const checkForRateLimit = async () => {
      return this.waitUntilUnderRateLimit({
        maxRetries: config.REST_TRANSPORT_MAX_RATE_LIMIT_RETRIES,
        msBetweenRetries: config.REST_TRANSPORT_MS_BETWEEN_RATE_LIMIT_RETRIES,
      })
    }
    await checkForRateLimit()

    logger.trace('Sending request to data provider...')
    const providerDataRequested = Date.now()
    const providerResponse = await axiosRequest<
      T['Provider']['RequestBody'],
      T['Provider']['ResponseBody'],
      T['CustomSettings']
    >(request, config, checkForRateLimit)
    const providerDataReceived = Date.now()

    logger.debug(`Got response from provider, parsing (raw body: ${providerResponse.data})`)
    const response = (await this.config.parseResponse(
      req,
      providerResponse,
      config,
    )) as AdapterResponse<T['Response']>
    response.timestamps = {
      providerDataRequested,
      providerDataReceived,
      providerIndicatedTime: response.timestamps?.providerIndicatedTime,
    }

    if (config.API_VERBOSE) {
      response.data = providerResponse.data
    }

    if (config.METRICS_ENABLED && config.EXPERIMENTAL_METRICS_ENABLED) {
      response.meta = {
        metrics: { feedId: req.requestContext.meta?.metrics?.feedId || 'N/A' },
      }
    }

    const result: TimestampedProviderResult<T> = {
      params: req.requestContext.data,
      response,
    }

    logger.debug('Setting provider response in cache')
    await this.responseCache.write([result])

    // Record cost of data provider call
    const cost = rateLimitMetrics.retrieveCost(providerResponse.data)
    rateLimitMetrics.rateLimitCreditsSpentTotal
      .labels({
        feed_id: req.requestContext.meta?.metrics?.feedId || 'N/A',
        participant_id: req.requestContext.cacheKey,
      })
      .inc(cost)

    // Update cacheHit flag in request meta for metrics use
    req.requestContext.meta = {
      ...req.requestContext.meta,
      metrics: { ...req.requestContext.meta?.metrics, cacheHit: false },
    }

    if (this.config.options.requestCoalescing.enabled) {
      logger.debug('Set provider response in cache, removing in flight from cache')
      await this.inFlightCache.delete(inFlightKey)
    }

    return response
  }
}
