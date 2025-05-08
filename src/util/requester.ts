import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'

import { censorLogs, makeLogger, sleep } from '.'
import { AdapterSettings } from '../config'
import { dataProviderMetricsLabel, metrics } from '../metrics'
import { RateLimiter } from '../rate-limiting'
import {
  AdapterConnectionError,
  AdapterDataProviderError,
  AdapterRateLimitError,
} from '../validation/error'

const logger = makeLogger('Requester')

interface ListNode<T> {
  value: T
  next: ListNode<T> | undefined
}

class UniqueLinkedList<T> {
  first: ListNode<T> | undefined
  last: ListNode<T> | undefined
  length = 0

  constructor(private maxLength: number) {}

  add(value: T): T | undefined {
    let overflow
    if (this.length === this.maxLength) {
      overflow = this.remove()
    }

    const node: ListNode<T> = { value, next: undefined }

    if (!this.first) {
      this.first = node
    }
    if (this.last) {
      this.last.next = node
    }

    this.last = node
    this.length++
    metrics.get('requesterQueueSize').inc()
    return overflow
  }

  remove() {
    const node = this.first
    if (!node) {
      return
    }
    this.first = node.next
    this.length--
    metrics.get('requesterQueueSize').dec()
    return node.value
  }
}

interface QueuedRequest<T = unknown> {
  key: string
  config: AxiosRequestConfig
  retries: number
  cost?: number
  promise: Promise<RequesterResult<T>>
  reject: (err: unknown) => void
  resolve: (req: RequesterResult<T>) => void
}

interface RequesterResult<T> {
  response: AxiosResponse<T>
  timestamps: {
    providerDataRequestedUnixMs: number
    providerDataReceivedUnixMs: number
  }
}

/**
 * Manages outbound HTTP requests with queueing, rate limiting, and connection reuse.
 *
 * Key features:
 * - **Request Coalescing:** Ignores duplicate outbound requests based on a provided unique key,
 *   returning the promise of the already-queued request. This is useful as request
 *   configs often contain dynamic elements like timestamps or nonces.
 * - **Queueing:** Adds requests to an internal queue (`UniqueLinkedList`) to manage flow.
 *   If the queue reaches its configured maximum length, adding a new request will cause
 *   the oldest request in the queue to be removed and its promise rejected with an
 *   AdapterRateLimitError.
 * - **Rate Limiting:** Enforces rate limits on a per-instance basis before dispatching
 *   requests, complying with typical "N Readers - 1 Writer" EA scaling architectures.
 *   Requests are dequeued sequentially to respect rate limits.
 * - **Connection Reuse:** Utilizes persistent HTTP and HTTPS agents with keep-alive enabled
 *   (via global Axios defaults) to reduce socket churn and improve latency for
 *   concurrent outbound requests. While rate limiting is sequential, actual HTTP
 *   operations can be in-flight concurrently up to `MAX_PARALLEL_HTTP_SOCKETS`.
 *
 * This implementation does not:
 * - Prioritize any specific request over another within the queue (FIFO).
 * - Directly manage rate limiting for architectures with multiple writer EA instances;
 *   rate limiting scope is per-instance.
 */
export class Requester {
  private processing = false
  private queue: UniqueLinkedList<QueuedRequest>
  private map = {} as Record<string, QueuedRequest>
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
    this.queue = new UniqueLinkedList<QueuedRequest>(adapterSettings.MAX_HTTP_REQUEST_QUEUE_LENGTH)

    const maxSockets =
      (adapterSettings as unknown as { MAX_PARALLEL_HTTP_SOCKETS?: number })
        .MAX_PARALLEL_HTTP_SOCKETS ?? 128

    axios.defaults.httpAgent = new HttpAgent({ keepAlive: true, maxSockets })
    axios.defaults.httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets })
  }

  async request<T>(
    key: string,
    req: AxiosRequestConfig,
    cost?: number,
  ): Promise<RequesterResult<T>> {
    const existing = this.map[key]
    if (existing) {
      censorLogs(() => logger.trace(`Request already queued, returning promise (Key: ${key})`))
      return existing.promise as Promise<RequesterResult<T>>
    }

    const queuedRequest = {
      key,
      config: req,
      retries: 0,
      cost,
    } as QueuedRequest<T>

    // Create promise whose handlers we store in the queued object
    await new Promise((unblock) => {
      queuedRequest.promise = new Promise<RequesterResult<T>>((resolve, reject) => {
        queuedRequest.resolve = resolve
        queuedRequest.reject = reject
        unblock(0)
      })
    })

    this.queueRequest(queuedRequest)
    return queuedRequest.promise
  }

  private queueRequest<T>(queuedRequest: QueuedRequest<T>): void {
    const overflow = this.queue.add(queuedRequest as QueuedRequest<unknown>)
    if (overflow) {
      censorLogs(() =>
        logger.debug(
          `Request (Key: ${overflow.key}, Retry #: ${overflow.retries}) overflowed queue`,
        ),
      )
      metrics.get('requesterQueueOverflow').inc()
      overflow.reject(
        new AdapterRateLimitError({
          message:
            'The EA was unable to execute the request to fetch the requested data from the DP because the request queue overflowed. This likely indicates that a higher API tier is needed.',
          statusCode: 429,
          msUntilNextExecution: this.rateLimiter.msUntilNextExecution(),
        }),
      )
      delete this.map[overflow.key]
    }

    censorLogs(() =>
      logger.trace(
        `Added request (Key: ${queuedRequest.key}, Retry #: ${queuedRequest.retries}) – queue size ${this.queue.length}`,
      ),
    )
    this.map[queuedRequest.key] = queuedRequest as QueuedRequest

    if (!this.processing) {
      this.processing = true
      logger.debug(`Starting requester queue processing`)
      this.processNext()
    }
  }

  private async processNext(): Promise<void> {
    const next = this.queue.remove()
    if (!next) {
      logger.debug(`Queue empty, stopping processing`)
      this.processing = false
      return
    }

    censorLogs(() =>
      logger.trace(`Processing request (Key: ${next.key}, Retry #: ${next.retries})`),
    )

    await this.rateLimiter.waitForRateLimit(next.cost)
    this.executeRequest.bind(this)(next)

    return this.processNext()
  }

  private async executeRequest(req: QueuedRequest) {
    const { key, config, resolve, reject, retries } = req
    const requestedAt = Date.now()
    const responseTimer = metrics.get('dataProviderRequestDurationSeconds').startTimer()

    config.timeout = config.timeout || this.timeout

    try {
      censorLogs(() => logger.trace(`Sending request (Key: ${key})`))
      censorLogs(() => logger.trace(config))

      const response = await axios.request(config)

      resolve({
        response,
        timestamps: {
          providerDataRequestedUnixMs: requestedAt,
          providerDataReceivedUnixMs: Date.now(),
        },
      })
      delete this.map[key]

      metrics
        .get('dataProviderRequests')
        .labels(dataProviderMetricsLabel(response.status, config.method))
        .inc()
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

      metrics
        .get('dataProviderRequests')
        .labels(dataProviderMetricsLabel(err.response?.status || 0, config.method))
        .inc()

      if (retries >= this.maxRetries) {
        const ErrorClass = err.response?.status ? AdapterDataProviderError : AdapterConnectionError

        reject(
          new ErrorClass(
            {
              statusCode: 502,
              name: 'Data Provider error',
              providerStatusCode: err.response?.status ?? 502,
              message: err.message,
              cause: e,
              errorResponse: err.response?.data,
              url: config.url,
            },
            {
              providerDataRequestedUnixMs: requestedAt,
              providerDataReceivedUnixMs: Date.now(),
              providerIndicatedTimeUnixMs: undefined,
            },
          ),
        )
        delete this.map[key]
      } else {
        const delay = this.sleepBeforeRequeueingMs || (2 ** retries + Math.random()) * 1000
        logger.info(`${this.maxRetries - retries} retries remaining, sleeping ${delay}ms`)
        await sleep(delay)
        req.retries++
        this.queueRequest(req)
      }
    } finally {
      responseTimer()
    }
  }
}
