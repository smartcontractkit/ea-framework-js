import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { makeLogger, sleep } from '.'
import { AdapterConfig } from '../config'
import { RequestRateLimiter } from '../rate-limiting'
import {
  AdapterConnectionError,
  AdapterDataProviderError,
  AdapterTimeoutError,
} from '../validation/error'
import * as metrics from './metrics'

const logger = makeLogger('Requester')

interface ListNode<T> {
  key: string
  value: T
  next: ListNode<T> | undefined
}

class OverflowException<T> extends Error {
  constructor(public item: T) {
    super()
  }
}

class UniqueLinkedList<T> {
  first: ListNode<T> | undefined
  last: ListNode<T> | undefined
  length = 0
  map = {} as Record<string, ListNode<T>>

  constructor(private maxLength: number) {}

  add(key: string, value: T): T | undefined {
    if (this.map[key]) {
      return this.map[key].value
    }

    if (this.length === this.maxLength) {
      // If this new item would put us over max length, remove the first one (i.e. oldest one)
      throw new OverflowException(this.remove())
    }

    const node: ListNode<T> = {
      key,
      value,
      next: undefined,
    }

    if (!this.first) {
      this.first = node
    }
    if (this.last) {
      this.last.next = node
    }

    this.map[key] = node
    this.last = node
    this.length++
    metrics.requesterQueueSize.inc()
  }

  get(key: string) {
    return this.map[key]?.value
  }

  remove() {
    const node = this.first

    if (!node) {
      return
    }

    this.first = node.next
    delete this.map[node.key]
    this.length--
    metrics.requesterQueueSize.dec()
    return node.value
  }
}

interface QueuedRequest<T = unknown> {
  key: string
  config: AxiosRequestConfig
  retries: number
  promise: Promise<RequesterResult<T>>
  reject: (err: unknown) => void
  resolve: (req: RequesterResult<T>) => void
}

interface RequesterResult<T> {
  response: AxiosResponse<T>
  timestamps: {
    providerDataRequested: number
    providerDataReceived: number
  }
}

/**
 * Centralized management of outbound http requests.
 * Enforces rate limiting on a single instance (complying with the N Readers - 1 Writer arch for EA scaling)
 * by adding requests into a a queue, processing them sequentially and sleeping when it reaches its limit.
 * The queue will throw an error if the Requester attempts to add more items than the max configured.
 * It additionally serves to coalesce requests by utilizing a more complex queue structure:
 *   - ignores duplicate items via a provided key
 *   - doesn't use the request itself because it's common for those to have things like timestamps/nonces
 * This implementation does not:
 *   - Prioritize any request over another
 *   - Contemplate architectures with multiple writer EA instances
 */
export class Requester {
  private processing = false
  private queue: UniqueLinkedList<QueuedRequest<unknown>>
  private maxRetries: number
  private timeout: number

  constructor(private rateLimiter: RequestRateLimiter, config: AdapterConfig) {
    this.maxRetries = config.RETRY
    this.timeout = config.API_TIMEOUT
    this.queue = new UniqueLinkedList<QueuedRequest>(config.MAX_HTTP_REQUEST_QUEUE_LENGTH)
  }

  request<T>(key: string, req: AxiosRequestConfig): Promise<RequesterResult<T>> {
    // If there's already a queued request, reuse it's existing promise
    const existingQueuedRequest = this.queue.get(key) as QueuedRequest<T>
    if (existingQueuedRequest) {
      return existingQueuedRequest.promise
    }

    return new Promise((resolve, reject) => {
      const queuedRequest = {
        key,
        config: req,
        retries: 0,
        resolve,
        reject,
      }

      logger.trace(`Adding request to the queue (Key: ${key}, Retry #: ${0})`)
      try {
        this.queue.add(key, queuedRequest as QueuedRequest)
      } catch (e) {
        if (e instanceof OverflowException<QueuedRequest>) {
          // If we have overflow, it means the oldest request needs to be rejected because the queue is at its limits
          metrics.requesterQueueOverflow.inc()
          e.item.reject(
            new AdapterTimeoutError({
              message: 'Timed out waiting for queued request to execute.',
              statusCode: 504,
            }),
          )
        }
      }

      if (!this.processing) {
        logger.debug(`Starting requester queue processing`)
        this.processNext()
      }
    })
  }

  // Will grab from queue sequentially, and sleep just before hitting rate limits
  private async processNext(): Promise<void> {
    const next = this.queue.remove()

    if (!next) {
      logger.debug(`No requests present in the queue, stopping processing until new one comes in`)
      this.processing = false
      return
    }

    // Fire off to complete in the background
    this.executeRequest.bind(this)(next)

    const timeToWait = this.rateLimiter.msUntilNextExecution()
    if (timeToWait) {
      await sleep(timeToWait)
    }

    return this.processNext()
  }

  // Handler for the requests that will be fired off, eventually resolving the promise associated with the queued request
  private async executeRequest(req: QueuedRequest) {
    const { key, config, resolve, reject, retries } = req
    const providerDataRequested = Date.now()
    const responseTimer = metrics.dataProviderRequestDurationSeconds.startTimer()

    // Set configured timeout for all requests unless manually specified
    config.timeout = config.timeout || this.timeout

    try {
      logger.trace(`Sending requests to data provider: ${JSON.stringify(config.data)}`)
      const response = await axios.request(config)
      resolve({
        response,
        timestamps: {
          providerDataRequested,
          providerDataReceived: Date.now(),
        },
      })

      // Record count of successful data provider requests
      metrics.dataProviderRequests
        .labels(metrics.dataProviderMetricsLabel(response.status, config.method))
        .inc()
    } catch (e) {
      if (retries >= this.maxRetries) {
        logger.trace(`Request failed and no more retries remaining, rejecting promise...`)
        const err = e as AxiosError
        const ErrorClass = err.response?.status ? AdapterDataProviderError : AdapterConnectionError

        // Record count of failed data provider request
        metrics.dataProviderRequests
          .labels(metrics.dataProviderMetricsLabel(err.response?.status || 0, config.method))
          .inc()

        reject(
          new ErrorClass(
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
              providerDataRequested,
              providerDataReceived: Date.now(),
              providerIndicatedTime: undefined,
            },
          ),
        )
      } else {
        const timeToSleep = (2 ** retries + Math.random()) * 1000
        logger.trace(`Request failed, sleeping for ${timeToSleep}ms...`)
        await sleep(timeToSleep)

        logger.trace(`Adding request to the queue (Key: ${key}, Retry #: ${retries})`)
        this.queue.add(key, req)
      }
    } finally {
      // Record time taken for data provider request for success or failure
      responseTimer()
    }
  }
}
