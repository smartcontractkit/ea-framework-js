import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { censorLogs, makeLogger, sleep } from '.'
import { AdapterSettings } from '../config'
import { dataProviderMetricsLabel, metrics } from '../metrics'
import { RateLimiter } from '../rate-limiting'
import {
  AdapterConnectionError,
  AdapterDataProviderError,
  AdapterRateLimitError,
} from '../validation/error'
import { EvictedError, TurnQueue } from './turn-queue'

const logger = makeLogger('Requester')

interface PendingRequest<T = unknown> {
  key: string
  config: AxiosRequestConfig
  retries: number
  cost?: number
  promise: Promise<RequesterResult<T>>
}

interface RequesterResult<T> {
  response: AxiosResponse<T>
  timestamps: {
    providerDataRequestedUnixMs: number
    providerDataReceivedUnixMs: number
  }
}

/**
 * Centralized management of outbound http requests.
 * Enforces rate limiting on a single instance (complying with the N Readers - 1 Writer arch for EA scaling)
 * by adding requests into a queue, processing them sequentially and sleeping when it reaches its limit.
 * The queue will throw an error if the Requester attempts to add more items than the max configured.
 * It additionally serves to coalesce requests by utilizing a more complex queue structure:
 *   - ignores duplicate items via a provided key
 *   - doesn't use the request itself because it's common for those to have things like timestamps/nonces
 * This implementation does not:
 *   - Prioritize any request over another
 *   - Contemplate architectures with multiple writer EA instances
 */
export class Requester {
  private queue: TurnQueue
  private pendingRequestMap = new Map<string, PendingRequest>()
  private maxRetries: number
  private timeout: number
  private sleepBeforeRequeueingMs: number

  constructor(
    private rateLimiter: RateLimiter,
    adapterSettings: AdapterSettings,
  ) {
    this.maxRetries = adapterSettings.RETRY
    this.timeout = adapterSettings.API_TIMEOUT
    this.sleepBeforeRequeueingMs = adapterSettings.REQUESTER_SLEEP_BEFORE_REQUEUEING_MS
    this.queue = new TurnQueue(adapterSettings.MAX_HTTP_REQUEST_QUEUE_LENGTH)
  }

  /**
   * Queues the provided request, and returns a promise that will resolve whenever it's executed.
   *
   * @param key - a key to uniquely identify this request, and coalesce new ones that match
   * @param req - a request to send to a data provider
   * @param cost - Data Provider API credit cost of the request
   * @returns a promise that will resolve whenever the request is popped from the queue, sent, and a response is received
   */
  async request<T>(
    key: string,
    req: AxiosRequestConfig,
    cost?: number,
  ): Promise<RequesterResult<T>> {
    // If there's already a queued request, reuse it's existing promise
    const existingQueuedRequest = this.pendingRequestMap.get(key)
    if (existingQueuedRequest) {
      censorLogs(() =>
        logger.trace(`Request already exists, returning queued promise (Key: ${key})`),
      )
      return existingQueuedRequest.promise as Promise<RequesterResult<T>>
    }

    // Set configured timeout for all requests unless manually specified
    req.timeout = req.timeout || this.timeout

    const pendingRequest = {
      key,
      config: req,
      retries: 0,
      cost,
    } as PendingRequest<T>

    this.pendingRequestMap.set(pendingRequest.key, pendingRequest as PendingRequest)

    pendingRequest.promise = this.executeRequestWithRetries(pendingRequest)

    try {
      return await pendingRequest.promise
    } finally {
      this.pendingRequestMap.delete(pendingRequest.key)
    }
  }

  private async executeRequestWithRetries<T>(
    pendingRequest: PendingRequest<T>,
  ): Promise<RequesterResult<T>> {
    for (let retries = 0; ; retries++) {
      pendingRequest.retries = retries
      try {
        await this.waitBeforeExecutingRequest(pendingRequest)
        return await this.executeRequest(pendingRequest)
      } catch (e) {
        if (e instanceof AdapterRateLimitError) {
          // Too many requests in the queue. Don't retry.
          throw e
        }
        if (retries === this.maxRetries) {
          logger.trace('No more retries remaining, rejecting promise...')
          throw e
        }
      }

      const timeToSleep = this.sleepBeforeRequeueingMs || (2 ** retries + Math.random()) * 1000
      logger.info(
        `${this.maxRetries - retries} retries remaining, sleeping for ${timeToSleep}ms...`,
      )
      await sleep(timeToSleep)
    }
  }

  // Waits for the request to have its turn in the queue and for the rate
  // limiter. Throws if the request was removed from the queue due to overflow
  // while waiting for its turn.
  private async waitBeforeExecutingRequest<T>(req: PendingRequest<T>): Promise<void> {
    try {
      metrics.get('requesterQueueSize').inc()
      await this.queue.run(async () => {
        metrics.get('requesterQueueSize').dec()
        // Wait until the rate limiter allows the request to be executed
        await this.rateLimiter.waitForRateLimit(req.cost)
      })
    } catch (e) {
      metrics.get('requesterQueueSize').dec()

      if (e instanceof EvictedError) {
        const overflowedRequest = req
        censorLogs(() =>
          logger.debug(
            `Request (Key: ${overflowedRequest.key}, Retry #: ${overflowedRequest.retries}) was removed from the queue to make room for a newer one (Size: ${this.queue.length})`,
          ),
        )
        metrics.get('requesterQueueOverflow').inc()
        throw new AdapterRateLimitError({
          message:
            'The EA was unable to execute the request to fetch the requested data from the DP because the request queue overflowed. This likely indicates that a higher API tier is needed.',
          statusCode: 429,
          msUntilNextExecution: this.rateLimiter.msUntilNextExecution(),
        })
      }
      throw e
    }
  }

  private async executeRequest<T>(req: PendingRequest<T>): Promise<RequesterResult<T>> {
    const { key, config } = req

    const providerDataRequested = Date.now()
    const responseTimer = metrics.get('dataProviderRequestDurationSeconds').startTimer()
    try {
      censorLogs(() => logger.trace(`Sending request (Key: ${key}) to data provider`))
      censorLogs(() => logger.trace(config))
      const response = await axios.request(config)
      censorLogs(() => logger.trace(`Request (Key: ${key}) was successful `))

      // Record count of successful data provider requests
      metrics
        .get('dataProviderRequests')
        .labels(dataProviderMetricsLabel(response.status, config.method))
        .inc()

      return {
        response,
        timestamps: {
          providerDataRequestedUnixMs: providerDataRequested,
          providerDataReceivedUnixMs: Date.now(),
        },
      }
    } catch (e) {
      const err = e as AxiosError
      censorLogs(() =>
        logger.info({
          msg: 'Request failed',
          response: {
            statusCode: err.response?.status,
            data: err.response?.data,
            text: err.response?.statusText,
          },
        }),
      )

      // Record count of failed data provider request
      metrics
        .get('dataProviderRequests')
        .labels(dataProviderMetricsLabel(err.response?.status || 0, config.method))
        .inc()

      const ErrorClass = err.response?.status ? AdapterDataProviderError : AdapterConnectionError

      throw new ErrorClass(
        {
          statusCode: 502,
          name: 'Data Provider error',
          providerStatusCode: err?.response?.status ?? 502,
          message: err?.message,
          cause: e,
          errorResponse: err?.response?.data,
          url: config.url,
        },
        {
          providerDataRequestedUnixMs: providerDataRequested,
          providerDataReceivedUnixMs: Date.now(),
          providerIndicatedTimeUnixMs: undefined,
        },
      )
    } finally {
      // Record time taken for data provider request for success or failure
      responseTimer()
    }
  }
}
