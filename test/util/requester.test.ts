import untypedTest, { TestFn, ExecutionContext } from 'ava'
import axios, { AxiosRequestConfig } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import * as promClient from 'prom-client'
import { Clock as InstalledClock } from '@sinonjs/fake-timers'
import { AdapterSettings } from '../../src/config'
import { metrics } from '../../src/metrics'
import { FixedIntervalRateLimiter } from '../../src/rate-limiting/fixed-interval'
import { LoggerFactoryProvider, asyncLocalStorage, sleep } from '../../src/util'
import { Requester } from '../../src/util/requester'
import { TestMetrics, runAllUntilSettled } from '../../src/util/testing-utils'
import { AdapterDataProviderError } from '../../src/validation/error'
import { installTimers } from '../helper'

type TestContext = {
  clock: InstalledClock
  requester: Requester
}

const test = untypedTest as TestFn<TestContext>

type Params = {
  param: string
  statusCode?: number
}

type RecordedRequest = {
  params: Params
  timestamp: number
  asyncLocal?: string
}

const rateLimitIntervalMs = 1234
let requestLatency = 0

const recordedRequests: RecordedRequest[] = []
const axiosMock = new MockAdapter(axios)

const adapterSettings: AdapterSettings = {
  RETRY: 2,
  API_TIMEOUT: 30_123,
  REQUESTER_SLEEP_BEFORE_REQUEUEING_MS: 1500,
  MAX_HTTP_REQUEST_QUEUE_LENGTH: 2,
} as AdapterSettings

axiosMock.onAny().reply(async (config: AxiosRequestConfig) => {
  const asyncLocal = asyncLocalStorage.getStore() as string | undefined
  recordedRequests.push({
    params: config.params,
    timestamp: Date.now(),
    ...(asyncLocal !== undefined ? { asyncLocal } : {}),
    ...(config.timeout !== adapterSettings.API_TIMEOUT ? { timeout: config.timeout } : {}),
  })
  await sleep(requestLatency)
  // We don't care about the response as long as we can associate it with the
  // request so we just put the request params in the response.
  return [config.params?.statusCode ?? 200, config?.params]
})

const makeRequester = () => {
  const rateLimiter = new FixedIntervalRateLimiter()
  rateLimiter.initialize([], { rateLimit1s: 1000 / rateLimitIntervalMs })
  return new Requester(rateLimiter, adapterSettings)
}

LoggerFactoryProvider.set()

test.before((t) => {
  t.context.clock = installTimers()
})

test.beforeEach((t) => {
  metrics.clear()
  promClient.register.setDefaultLabels({
    app_name: 'requester-test',
    app_version: 'test',
  })
  metrics.initialize()
  t.context.clock.reset()
  recordedRequests.length = 0
  t.context.requester = makeRequester()
})

const makeRequest = async (t: ExecutionContext<TestContext>, params: Params) => {
  const key = params.param
  const config: AxiosRequestConfig = {
    method: 'get',
    url: '/test',
    params,
  }

  const result = await t.context.requester.request<Params>(key, config)

  t.deepEqual(result.response.data, params)
  return result.response.data
}

const getMetric = async (t: ExecutionContext, name: string): Promise<number | undefined> => {
  const testMetrics = new TestMetrics(await promClient.register.metrics())
  return testMetrics.get(t, { name })
}

const getTotalRequestDuration = async (t: ExecutionContext): Promise<number> => {
  const seconds = (await getMetric(t, 'data_provider_request_duration_seconds_sum')) ?? 0
  return Math.round(seconds * 1000)
}

// Wrapper to advance time until the entire test is finished to make the tests
// themselves more readable.
const wrapTest = (testFunction: (t: ExecutionContext<TestContext>) => Promise<void>) => {
  return (t: ExecutionContext<TestContext>) => runAllUntilSettled(t.context.clock, testFunction(t))
}

test.serial(
  'should make a request',
  wrapTest(async (t) => {
    const params = { param: 'test1' }

    const t0 = Date.now()

    await makeRequest(t, params)

    t.deepEqual(recordedRequests, [
      {
        params,
        timestamp: t0,
      },
    ])
  }),
)

test.serial(
  'should rate limit a second request',
  wrapTest(async (t) => {
    const params1 = { param: 'test1' }
    const params2 = { param: 'test2' }

    const t0 = Date.now()

    await Promise.all([makeRequest(t, params1), makeRequest(t, params2)])

    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      {
        params: params2,
        timestamp: t0 + rateLimitIntervalMs,
      },
    ])
  }),
)

test.serial(
  'should reject old requests if the queue is full',
  wrapTest(async (t) => {
    const params1 = { param: 'test1' }
    const params2 = { param: 'test2' }
    const params3 = { param: 'test3' }
    const params4 = { param: 'test4' }

    const t0 = Date.now()

    const promise1 = makeRequest(t, params1)
    const promise2 = makeRequest(t, params2)
    const promise3 = makeRequest(t, params3)
    const promise4 = makeRequest(t, params4)

    const results = await Promise.allSettled([promise1, promise2, promise3, promise4])

    // The first request was made immediately so it was already add to and
    // removed from the queue.
    // The second request is being rate limited.
    // The third request is waiting for the second request.
    // The fourth request would overflow the queue, since the maximum length is
    // 2, so this causes the second request (which is currently the oldest in the
    // queue) to be rejected.
    t.deepEqual(
      results.map((result) => result.status),
      ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
    )

    // Convince the compiler that the second result is rejected so we can check
    // the error message.
    if (results[1].status !== 'rejected') {
      t.fail('Expected second request to be rejected')
      return
    }

    t.is(results[1].reason instanceof Error, true)
    t.is(
      (results[1].reason as Error).message,
      'The EA was unable to execute the request to fetch the requested data from the DP because the request queue overflowed. This likely indicates that a higher API tier is needed.',
    )

    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      // The second request was never made.
      {
        params: params3,
        timestamp: t0 + rateLimitIntervalMs,
      },
      {
        params: params4,
        timestamp: t0 + 2 * rateLimitIntervalMs,
      },
    ])
  }),
)

test.serial(
  'should remove request from the queue while its still being rate limited',
  wrapTest(async (t) => {
    const params1 = { param: 'test1' }
    const params2 = { param: 'test2' }
    const params3 = { param: 'test3' }
    const params4 = { param: 'test4' }
    const params5 = { param: 'test5' }

    const t0 = Date.now()

    const promise1 = makeRequest(t, params1)
    const promise2 = makeRequest(t, params2)

    // Sleeping shorter than the rate limit interval so the second request is
    // still being rate limited.
    await sleep(rateLimitIntervalMs - 10)

    // It's already removed from the queue because the rate limiting is
    // specific to (the cost of) the request. So once we start rate limiting
    // the request we are committed to it and don't want to evict it from the
    // queue.
    t.is(await getMetric(t, 'requester_queue_size'), 0)

    const promise3 = makeRequest(t, params3)
    t.is(await getMetric(t, 'requester_queue_size'), 1)
    const promise4 = makeRequest(t, params4)
    t.is(await getMetric(t, 'requester_queue_size'), 2)
    t.is(await getMetric(t, 'requester_queue_overflow'), 0)
    const promise5 = makeRequest(t, params5)

    // When adding the fifth request, the queue overflowed so the queue size is
    // still 2.
    await sleep(0)
    t.is(await getMetric(t, 'requester_queue_size'), 2)
    t.is(await getMetric(t, 'requester_queue_overflow'), 1)

    await sleep(10)
    t.is(await getMetric(t, 'requester_queue_size'), 1)
    await sleep(rateLimitIntervalMs)
    t.is(await getMetric(t, 'requester_queue_size'), 0)

    const results = await Promise.allSettled([promise1, promise2, promise3, promise4, promise5])

    // The second request was removed from the queue when it started waiting
    // for its turn. So the third request was rejected instead of the second
    // request.
    t.deepEqual(
      results.map((result) => result.status),
      ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
    )

    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      {
        params: params2,
        timestamp: t0 + rateLimitIntervalMs,
      },
      // The third request was dropped so it was never made.
      {
        params: params4,
        timestamp: t0 + 2 * rateLimitIntervalMs,
      },
      {
        params: params5,
        timestamp: t0 + 3 * rateLimitIntervalMs,
      },
    ])
  }),
)

test.serial(
  'should retry failed requests',
  wrapTest(async (t) => {
    const params = { param: 'test1', statusCode: 500 }

    const t0 = Date.now()

    try {
      await makeRequest(t, params)
      t.fail('Expected request to fail')
    } catch (error) {
      t.is((error as Error).message, 'Request failed with status code 500')
    }

    t.deepEqual(recordedRequests, [
      {
        params,
        timestamp: t0,
      },
      {
        params,
        timestamp: t0 + adapterSettings.REQUESTER_SLEEP_BEFORE_REQUEUEING_MS,
      },
      {
        params,
        timestamp: t0 + 2 * adapterSettings.REQUESTER_SLEEP_BEFORE_REQUEUEING_MS,
      },
    ])
  }),
)

test.serial(
  'should retry failed request at the end of the queue',
  wrapTest(async (t) => {
    const params1 = { param: 'test1', statusCode: 500 }
    const params2 = { param: 'test2', statusCode: 500 }

    const t0 = Date.now()

    await Promise.allSettled([makeRequest(t, params1), makeRequest(t, params2)])

    // Params are alternating because each request goes to the end of the queue
    // before being retried.
    // Timestamps differ by rateLimitIntervalMs instead of
    // REQUESTER_SLEEP_BEFORE_REQUEUEING_MS because
    // REQUESTER_SLEEP_BEFORE_REQUEUEING_MS is less than twice
    // rateLimitIntervalMs so after sleeping for
    // REQUESTER_SLEEP_BEFORE_REQUEUEING_MS, there is still some rate limiting
    // left to do.
    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      {
        params: params2,
        timestamp: t0 + rateLimitIntervalMs,
      },
      {
        params: params1,
        timestamp: t0 + 2 * rateLimitIntervalMs,
      },
      {
        params: params2,
        timestamp: t0 + 3 * rateLimitIntervalMs,
      },
      {
        params: params1,
        timestamp: t0 + 4 * rateLimitIntervalMs,
      },
      {
        params: params2,
        timestamp: t0 + 5 * rateLimitIntervalMs,
      },
    ])
  }),
)

test.serial(
  'should reuse duplicate requests',
  wrapTest(async (t) => {
    const params1 = { param: 'test1' }
    const params2 = { param: 'test2' }
    const params3 = { param: 'test3' }
    // We use the second request as the duplicate request because the first
    // request finishes immediately and so won't be available to be reused by the
    // time a duplicate request may arrive.
    const params4 = params2

    const t0 = Date.now()

    let resultTime1 = 0
    let resultTime2 = 0
    let resultTime3 = 0
    let resultTime4 = 0

    const promise1 = makeRequest(t, params1)
    promise1.then(() => {
      resultTime1 = Date.now()
    })
    await sleep(10)
    const promise2 = makeRequest(t, params2)
    promise2.then(() => {
      resultTime2 = Date.now()
    })
    await sleep(10)
    const promise3 = makeRequest(t, params3)
    promise3.then(() => {
      resultTime3 = Date.now()
    })
    await sleep(10)
    const promise4 = makeRequest(t, params4)
    promise4.then(() => {
      resultTime4 = Date.now()
    })

    t.deepEqual(await Promise.all([promise1, promise2, promise3, promise4]), [
      params1,
      params2,
      params3,
      params4,
    ])

    t.deepEqual(
      [resultTime1 - t0, resultTime2 - t0, resultTime3 - t0, resultTime4 - t0],
      [
        0,
        rateLimitIntervalMs,
        2 * rateLimitIntervalMs,
        rateLimitIntervalMs, // Same as the second request because it was reused.
      ],
    )

    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      {
        params: params2,
        timestamp: t0 + rateLimitIntervalMs,
      },
      {
        params: params3,
        timestamp: t0 + 2 * rateLimitIntervalMs,
      },
      // No fourth request because it reused the second request's response.
    ])
  }),
)

test.serial(
  'should not reuse duplicate requests that already finished',
  wrapTest(async (t) => {
    const params1 = { param: 'test1' }
    const params2 = { param: 'test2' }
    const params3 = params1

    const t0 = Date.now()

    let resultTime1 = 0
    let resultTime2 = 0
    let resultTime3 = 0

    const promise1 = makeRequest(t, params1)
    promise1.then(() => {
      resultTime1 = Date.now()
    })
    await sleep(10)
    const promise2 = makeRequest(t, params2)
    promise2.then(() => {
      resultTime2 = Date.now()
    })
    await sleep(10)
    const promise3 = makeRequest(t, params3)
    promise3.then(() => {
      resultTime3 = Date.now()
    })

    t.deepEqual(await Promise.all([promise1, promise2, promise3]), [params1, params2, params3])

    t.deepEqual(
      [resultTime1 - t0, resultTime2 - t0, resultTime3 - t0],
      [
        0,
        rateLimitIntervalMs,
        // Not same as first request because it was no longer available to be
        // reused by the time the third request was made.
        2 * rateLimitIntervalMs,
      ],
    )

    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      {
        params: params2,
        timestamp: t0 + rateLimitIntervalMs,
      },
      {
        params: params3,
        timestamp: t0 + 2 * rateLimitIntervalMs,
      },
    ])
  }),
)

test.serial(
  'should reuse a dupcliate request that is already sent but does not have a response yet',
  wrapTest(async (t) => {
    const params1 = { param: 'test1' }
    const params2 = params1

    const t0 = Date.now()

    let resultTime1 = 0
    let resultTime2 = 0

    requestLatency = 100

    const promise1 = makeRequest(t, params1)
    promise1.then(() => {
      resultTime1 = Date.now()
    })
    await sleep(10)

    // Confirm that the request was already made.
    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
    ])

    // But the response was not yet received.
    t.is(resultTime1, 0)

    const promise2 = makeRequest(t, params2)
    promise2.then(() => {
      resultTime2 = Date.now()
    })

    t.deepEqual(await Promise.all([promise1, promise2]), [params1, params2])

    t.deepEqual([resultTime1 - t0, resultTime2 - t0], [requestLatency, requestLatency])

    // No additional request was made.
    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
    ])
  }),
)

test.serial(
  'should reuse a duplicate request even if it fails',
  wrapTest(async (t) => {
    const params1 = { param: 'test1', statusCode: 500 }
    const params2 = params1

    const t0 = Date.now()

    let resultTime1 = 0
    let resultTime2 = 0

    requestLatency = 100

    const promise1 = makeRequest(t, params1)
    promise1.catch(() => {
      resultTime1 = Date.now()
    })
    await sleep(10)
    const promise2 = makeRequest(t, params2)
    promise2.catch(() => {
      resultTime2 = Date.now()
    })

    const results = await Promise.allSettled([promise1, promise2])

    t.deepEqual(
      results.map((result) => result.status),
      ['rejected', 'rejected'],
    )

    // Total time including retries
    const totalTime = 3 * requestLatency + 2 * adapterSettings.REQUESTER_SLEEP_BEFORE_REQUEUEING_MS

    t.deepEqual([resultTime1 - t0, resultTime2 - t0], [totalTime, totalTime])

    // Additional requests were made for the retries, but not for the duplicate
    // request.
    t.deepEqual(recordedRequests, [
      {
        params: params1,
        timestamp: t0,
      },
      {
        params: params1,
        timestamp: t0 + requestLatency + adapterSettings.REQUESTER_SLEEP_BEFORE_REQUEUEING_MS,
      },
      {
        params: params1,
        timestamp: t0 + 2 * (requestLatency + adapterSettings.REQUESTER_SLEEP_BEFORE_REQUEUEING_MS),
      },
    ])
  }),
)

test.serial(
  'should return timestamps',
  wrapTest(async (t) => {
    requestLatency = 123
    const params = { param: 'test1' }

    const key = params.param
    const config: AxiosRequestConfig = {
      method: 'get',
      url: '/test',
      params,
    }

    const t0 = Date.now()
    const result = await t.context.requester.request<Params>(key, config)

    t.deepEqual(result.timestamps, {
      providerDataRequestedUnixMs: t0,
      providerDataReceivedUnixMs: t0 + requestLatency,
    })
  }),
)

test.serial(
  'should return timestamps for failed requests',
  wrapTest(async (t) => {
    requestLatency = 123
    const params = { param: 'test1', statusCode: 500 }

    const key = params.param
    const config: AxiosRequestConfig = {
      method: 'get',
      url: '/test',
      params,
    }

    try {
      await t.context.requester.request<Params>(key, config)
      t.fail('Expected request to fail')
    } catch (error) {
      if (error instanceof AdapterDataProviderError) {
        t.deepEqual(error.timestamps, {
          providerDataRequestedUnixMs: Date.now() - requestLatency,
          providerDataReceivedUnixMs: Date.now(),
          providerIndicatedTimeUnixMs: undefined,
        })
      } else {
        t.fail('Expected error to be an AdapterDataProviderError')
      }
    }
  }),
)

test.serial(
  'should record request duration metrics',
  wrapTest(async (t) => {
    requestLatency = 123
    const params = { param: 'test1' }

    await makeRequest(t, params)

    t.is(await getTotalRequestDuration(t), requestLatency)
  }),
)

test.serial(
  'should record duration metrics for failed requests',
  wrapTest(async (t) => {
    requestLatency = 123
    const params = { param: 'test1', statusCode: 500 }

    try {
      await makeRequest(t, params)
      t.fail('Expected request to fail')
    } catch (_) {
      // Ignore
    }

    t.is(await getTotalRequestDuration(t), (adapterSettings.RETRY + 1) * requestLatency)
  }),
)

test.serial(
  'should use explicit timeout',
  wrapTest(async (t) => {
    requestLatency = 123
    const params = { param: 'test1' }
    const timeout = 12345

    const key = params.param
    const config: AxiosRequestConfig = {
      method: 'get',
      url: '/test',
      timeout,
      params,
    }

    const t0 = Date.now()
    await t.context.requester.request<Params>(key, config)

    t.deepEqual(recordedRequests, [
      {
        params,
        timestamp: t0,
        timeout,
      },
    ])
  }),
)

test.serial(
  'should make the request from the same async local as it was requested from',
  wrapTest(async (t) => {
    // If this fails, the logger will give confusing incorrect context about
    // requests because the async local is used to associate requests with the
    // endpoint and transport they were made in.
    const param1 = 'test1'
    const param2 = 'test2'

    const t0 = Date.now()

    await Promise.all([
      asyncLocalStorage.run('async1', () => makeRequest(t, { param: param1 })),
      asyncLocalStorage.run('async2', () => makeRequest(t, { param: param2 })),
    ])

    t.deepEqual(recordedRequests, [
      {
        params: { param: param1 },
        timestamp: t0,
        asyncLocal: 'async1',
      },
      {
        params: { param: param2 },
        timestamp: t0 + rateLimitIntervalMs,
        asyncLocal: 'async2',
      },
    ])
  }),
)
