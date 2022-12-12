import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { Adapter, AdapterEndpoint, EndpointContext } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { HttpTransport } from '../../src/transports'
import { AdapterResponse, ProviderResult, SingleNumberResultResponse } from '../../src/util'
import { assertEqualResponses, MockCache, runAllUntilTime } from '../util'

const test = untypedTest as TestFn<{
  clock: InstalledClock
}>

const URL = 'http://test-url.com'
const endpoint = '/price'

interface AdapterRequestParams {
  from: string
  to: string
}

interface ProviderRequestBody {
  pairs: Array<{
    base: string
    quote: string
  }>
}

interface ProviderResponseBody {
  prices: Array<{
    pair: string
    price: number
  }>
}

test.before(() => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
})

test.after(() => {
  nock.restore()
})

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach((t) => {
  t.context.clock.uninstall()
})

type HttpTransportTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  CustomSettings: SettingsMap
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

const BACKGROUND_EXECUTE_MS_HTTP = 5000

class MockBatchWarmingTransport extends HttpTransport<HttpTransportTypes> {
  backgroundExecuteCalls = 0

  constructor(private callSuper = false) {
    super({
      prepareRequests: (params) => ({
        params,
        request: {
          baseURL: URL,
          url: '/price',
          method: 'POST',
          data: {
            pairs: params.map((p) => ({ base: p.from, quote: p.to })),
          },
        },
      }),
      parseResponse: (
        params: AdapterRequestParams[],
        res: AxiosResponse<ProviderResponseBody>,
      ): ProviderResult<HttpTransportTypes>[] =>
        res.data.prices?.map((p) => {
          const [from, to] = p.pair.split('/')
          return {
            params: { from, to },
            response: {
              data: {
                result: p.price,
              },
              result: p.price,
            },
          }
        }) || [],
    })
  }

  override async backgroundExecute(context: EndpointContext<HttpTransportTypes>): Promise<void> {
    this.backgroundExecuteCalls++
    if (this.callSuper) {
      super.backgroundExecute(context)
    }
  }
}

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
process.env['RETRY'] = '0'
process.env['BACKGROUND_EXECUTE_MS_HTTP'] = BACKGROUND_EXECUTE_MS_HTTP.toString()

const from = 'ETH'
const to = 'USD'
const price = 1234

nock(URL)
  .post(endpoint, {
    pairs: [
      {
        base: from,
        quote: to,
      },
    ],
  })
  .reply(200, {
    prices: [
      {
        pair: `${from}/${to}`,
        price,
      },
    ],
  })
  .persist()
  .post(endpoint, {
    pairs: [
      {
        base: 'ERR',
        quote: to,
      },
    ],
  })
  .reply(500, 'There was an unexpected issue')
  .persist()

const inputParameters = {
  from: {
    type: 'string',
    required: true,
  },
  to: {
    type: 'string',
    required: true,
  },
} as const

test.serial('sends request to DP and returns response', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new MockBatchWarmingTransport(true),
      }),
    ],
  })

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache()

  // Start the adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeRequest = () =>
    axios.post(address, {
      data: {
        from,
        to,
      },
    })

  // Expect the first response to time out
  // The polling behavior is tested in the cache tests, so this is easier here.
  // Start the request:
  const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
  // Advance enough time for the initial request async flow
  t.context.clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504
  const error = await errorPromise
  t.is(error?.response?.status, 504)

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  const cacheValueSetPromise = mockCache.waitForNextSet()
  await t.context.clock.tickAsync(BACKGROUND_EXECUTE_MS_HTTP + 10)
  await cacheValueSetPromise

  // Second request should find the response in the cache
  const response = await makeRequest()

  t.is(response.status, 200)
  assertEqualResponses(t, response.data, {
    data: {
      result: price,
    },
    result: price,
    statusCode: 200,
  })
})

test.serial(
  'per minute rate limit of 4 with one batch transport results in a call every 15s',
  async (t) => {
    const rateLimit1m = 4
    const transport = new MockBatchWarmingTransport()

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      endpoints: [
        new AdapterEndpoint({
          name: 'test',
          inputParameters,
          transport: transport,
        }),
      ],
      rateLimiting: {
        tiers: {
          default: {
            rateLimit1m,
          },
        },
      },
    })

    // Start the adapter
    const api = await expose(adapter)
    const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

    const makeRequest = () =>
      axios.post(address, {
        data: {
          from,
          to,
        },
      })

    // Expect the first response to time out
    // The polling behavior is tested in the cache tests, so this is easier here.
    // Start the request:
    const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
    // Advance enough time for the initial request async flow
    t.context.clock.tickAsync(10)
    // Wait for the failed cache get -> instant 504
    const error = await errorPromise
    t.is(error?.response?.status, 504)

    // Wait for the first background execute and check that it's been called
    await t.context.clock.tickAsync(10)
    t.is(transport.backgroundExecuteCalls, 1)

    // Advance the clock a few minutes and check that the amount of calls is as expected
    // +1 because of the previous first
    await t.context.clock.tickAsync(5 * 60 * 1000) // 5m
    t.is(transport.backgroundExecuteCalls, 5 * rateLimit1m + 1)
  },
)

test.serial(
  'per second limit of 1 with one batch transport results in a call every 1000ms',
  async (t) => {
    const rateLimit1s = 1
    const transport = new MockBatchWarmingTransport()

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      endpoints: [
        new AdapterEndpoint({
          name: 'test',
          inputParameters,
          transport: transport,
        }),
      ],
      rateLimiting: {
        tiers: {
          default: {
            rateLimit1s,
          },
        },
      },
      envDefaultOverrides: {
        WARMUP_SUBSCRIPTION_TTL: 100000,
      },
    })

    // Start the adapter
    const api = await expose(adapter)
    const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

    const makeRequest = () =>
      axios.post(address, {
        data: {
          from,
          to,
        },
      })

    // Expect the first response to time out
    // The polling behavior is tested in the cache tests, so this is easier here.
    // Start the request:
    const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
    // Advance enough time for the initial request async flow
    t.context.clock.tickAsync(10)
    // Wait for the failed cache get -> instant 504
    const error = await errorPromise
    t.is(error?.response?.status, 504)

    // Wait for the first background execute and check that it's been called
    await t.context.clock.tickAsync(10)
    t.is(transport.backgroundExecuteCalls, 1)

    // Run for an entire minute and check that the values are as expected
    await runAllUntilTime(t.context.clock, 59 * 1000)

    t.is(transport.backgroundExecuteCalls, 60 * rateLimit1s + 1)
  },
)

test.serial(
  'per second limit of 1 with two batch transports results in a call every 2000ms for each',
  async (t) => {
    const rateLimit1s = 1
    const transportA = new MockBatchWarmingTransport()
    const transportB = new MockBatchWarmingTransport()

    const adapter = new Adapter({
      name: 'TEST',
      endpoints: [
        new AdapterEndpoint({
          name: 'A',
          inputParameters,
          transport: transportA,
        }),
        new AdapterEndpoint({
          name: 'B',
          inputParameters,
          transport: transportB,
        }),
      ],
      rateLimiting: {
        tiers: {
          default: {
            rateLimit1s,
          },
        },
      },
      envDefaultOverrides: {
        WARMUP_SUBSCRIPTION_TTL: 100000,
      },
    })

    // Start the adapter
    const api = await expose(adapter)
    const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

    const makeRequest = (endpointParam: string) =>
      axios.post(address, {
        data: {
          from,
          to,
        },
        endpoint: endpointParam,
      })

    // Expect the first response to time out
    // The polling behavior is tested in the cache tests, so this is easier here.
    // Start the request:
    const errorPromiseA: Promise<AxiosError | undefined> = t.throwsAsync(() => makeRequest('A'))
    // Advance enough time for the initial request async flow
    t.context.clock.tickAsync(10)
    // Wait for the failed cache get -> instant 504
    const errorA = await errorPromiseA
    t.is(errorA?.response?.status, 504)

    // Do the same thing for transport B
    const errorPromiseB: Promise<AxiosError | undefined> = t.throwsAsync(() => makeRequest('B'))
    t.context.clock.tickAsync(10)
    const errorB = await errorPromiseB
    t.is(errorB?.response?.status, 504)

    // Wait for the first background executes and check that they've been called
    await t.context.clock.tickAsync(10)
    t.is(transportA.backgroundExecuteCalls, 1)
    t.is(transportB.backgroundExecuteCalls, 1)

    // Run for a minute (59s actually, it'll start at 0 and go on regular intervals)
    await runAllUntilTime(t.context.clock, 59 * 1000 + 10)

    t.is(transportA.backgroundExecuteCalls, 30 * rateLimit1s + 1) // +1 for the first call
    t.is(transportB.backgroundExecuteCalls, 30 * rateLimit1s)
  },
)

test.serial(
  'per second limit of 1 with two batch transports with different allocations results in correct time distribution',
  async (t) => {
    const rateLimit1s = 1
    const transportA = new MockBatchWarmingTransport()
    const transportB = new MockBatchWarmingTransport()

    const adapter = new Adapter({
      name: 'TEST',
      endpoints: [
        new AdapterEndpoint({
          name: 'A',
          inputParameters,
          transport: transportA,
          rateLimiting: {
            allocationPercentage: 75,
          },
        }),
        new AdapterEndpoint({
          // This one should be dynamically allocated
          name: 'B',
          inputParameters,
          transport: transportB,
        }),
      ],
      rateLimiting: {
        tiers: {
          default: {
            rateLimit1s,
          },
        },
      },
      envDefaultOverrides: {
        WARMUP_SUBSCRIPTION_TTL: 100000,
      },
    })

    // Start the adapter
    const api = await expose(adapter)
    const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

    const makeRequest = (endpointParam: string) =>
      axios.post(address, {
        data: {
          from,
          to,
        },
        endpoint: endpointParam,
      })

    // Expect the first response to time out
    // The polling behavior is tested in the cache tests, so this is easier here.
    // Start the request:
    const errorPromiseA: Promise<AxiosError | undefined> = t.throwsAsync(() => makeRequest('A'))
    // Advance enough time for the initial request async flow
    t.context.clock.tickAsync(10)
    // Wait for the failed cache get -> instant 504
    const errorA = await errorPromiseA
    t.is(errorA?.response?.status, 504)

    // Do the same thing for transport B
    const errorPromiseB: Promise<AxiosError | undefined> = t.throwsAsync(() => makeRequest('B'))
    t.context.clock.tickAsync(10)
    const errorB = await errorPromiseB
    t.is(errorB?.response?.status, 504)

    // Wait for the first background executes and check that they've been called
    await t.context.clock.tickAsync(10)
    t.is(transportA.backgroundExecuteCalls, 1)
    t.is(transportB.backgroundExecuteCalls, 1)

    // Run for a minute (59s actually, it'll start at 0 and go on regular intervals)
    await runAllUntilTime(t.context.clock, 59 * 1000 + 10)

    t.is(transportA.backgroundExecuteCalls, 45 * rateLimit1s + 1) // +1 for the first call
    t.is(transportB.backgroundExecuteCalls, 15 * rateLimit1s)
  },
)

test.serial('DP request fails, EA returns 502 cached error', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new MockBatchWarmingTransport(true),
      }),
    ],
  })

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache()

  // Start the adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeRequest = () =>
    axios.post(address, {
      data: {
        from: 'ERR',
        to,
      },
    })

  // Expect the first response to time out
  // The polling behavior is tested in the cache tests, so this is easier here.
  // Start the request:
  const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
  // Advance enough time for the initial request async flow
  t.context.clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504
  const error = await errorPromise
  t.is(error?.response?.status, 504)

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  const cacheValueSetPromise = mockCache.waitForNextSet()
  await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_HTTP + 200)
  await cacheValueSetPromise

  // Second request should find the response in the cache
  const error2 = (await t.throwsAsync(makeRequest)) as AxiosError

  t.is(error2?.response?.status, 502)
  assertEqualResponses(t, error2?.response?.data as AdapterResponse, {
    errorMessage: 'Provider request failed with status undefined: "There was an unexpected issue"',
    statusCode: 502,
  })
})

test.serial('requests from different transports are coalesced', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'a',
        inputParameters,
        transport: new MockBatchWarmingTransport(true),
      }),
      new AdapterEndpoint({
        name: 'b',
        inputParameters,
        transport: new MockBatchWarmingTransport(true),
      }),
    ],
  })

  nock(URL)
    .post(endpoint, {
      pairs: [
        {
          base: 'COALESCE',
          quote: to,
        },
      ],
    })
    .once() // Ensure that this request happens only once, but should satisfy both transports
    .reply(200, {
      prices: [
        {
          pair: `coalesce/${to}`,
          price,
        },
      ],
    })

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache()

  // Start the adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
  const makeRequest = (inputEndpoint: string) => () =>
    axios.post(address, {
      data: {
        from: 'COALESCE',
        to,
        endpoint: inputEndpoint,
      },
    })

  const errorPromiseA: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest('a'))
  const errorPromiseB: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest('b'))
  // Advance enough time for the initial request async flow
  t.context.clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504s
  const [errorA, errorB] = await Promise.all([errorPromiseA, errorPromiseB])
  t.is(errorA?.response?.status, 504)
  t.is(errorB?.response?.status, 504)

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  const cacheValueSetPromise = mockCache.waitForNextSet()
  await t.context.clock.tickAsync(BACKGROUND_EXECUTE_MS_HTTP * 2 + 200)
  await cacheValueSetPromise

  // Second requests should find the response in the cache
  const responseA = await makeRequest('a')()
  const responseB = await makeRequest('b')()

  t.is(responseA.status, 200)
  t.is(responseB.status, 200)
})

test.serial('requests for the same transport are coalesced', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new MockBatchWarmingTransport(true),
      }),
    ],
  })

  nock(URL)
    .post(endpoint, {
      pairs: [
        {
          base: 'COALESCE2',
          quote: to,
        },
      ],
    })
    .once() // Ensure that this request happens only once
    .delay(BACKGROUND_EXECUTE_MS_HTTP)
    .reply(200, {
      prices: [
        {
          pair: `coalesce2/${to}`,
          price,
        },
      ],
    })

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache()

  // Start the adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
  const makeRequest = () =>
    axios.post(address, {
      data: {
        from: 'COALESCE2',
        to,
      },
    })

  const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
  // Advance enough time for the initial request async flow
  t.context.clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504s
  const error = await errorPromise
  t.is(error?.response?.status, 504)

  // Advance clock so that the batch warmer executes twice again and wait for the cache to be set
  const cacheValueSetPromise = mockCache.waitForNextSet()
  await t.context.clock.tickAsync(BACKGROUND_EXECUTE_MS_HTTP * 2 + 200)
  await cacheValueSetPromise

  // Second requests should find the response in the cache
  const response = await makeRequest()

  t.is(response.status, 200)
})

test.serial(
  'requester queue rejects oldest in the queue and adds new if capacity is reached',
  async (t) => {
    // This test will cover requests in all states:
    //   - In flight
    //   - Next in line to be executed, sleeping to avoid rate limiting
    //   - Rejected because of queue overflow
    //   - Queued
    const numbers = [1, 2, 3, 4]

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      endpoints: numbers.map(
        (n) =>
          new AdapterEndpoint({
            name: `${n}`,
            inputParameters,
            transport: new MockBatchWarmingTransport(true),
          }),
      ),

      envDefaultOverrides: {
        // These mean the first request will be queued and immediately fired,
        // the second will be queued, and the third will replace the second in the queue.
        MAX_HTTP_REQUEST_QUEUE_LENGTH: 1,
        RATE_LIMIT_CAPACITY_MINUTE: 1,
      },
    })

    // Mock valid responses for the requests we'll send
    for (const number of numbers) {
      nock(URL)
        .post(endpoint, {
          pairs: [
            {
              base: `symbol${number}`,
              quote: to,
            },
          ],
        })
        .delay(BACKGROUND_EXECUTE_MS_HTTP)
        .reply(200, {
          prices: [
            {
              pair: `symbol${number}/${to}`,
              price,
            },
          ],
        })
    }

    // Create mocked cache so we can listen when values are set
    // This is a more reliable method than expecting precise clock timings
    const mockCache = new MockCache()

    // Advance the clock for a second so we can do all this logic and the interval break doesn't occur right in the middle
    t.context.clock.tick(1000)

    // Start the adapter
    const api = await expose(adapter, {
      cache: mockCache,
    })
    const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
    const makeRequest = (number: number) => () =>
      axios.post(address, {
        data: {
          from: `symbol${number}`,
          to,
          endpoint: `${number}`,
        },
      })

    // Send an initial request for all our numbers to ensure they're part of the subscription set
    for (const number of numbers) {
      const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest(number))
      // Advance enough time for the initial request async flow
      t.context.clock.tickAsync(10)
      // Wait for the failed cache get -> instant 504s
      const error = await errorPromise
      t.is(error?.response?.status, 504)
    }

    // Advance clock so that the batch warmer executes once
    // const cacheValueSetPromise = mockCache.waitForNextSet()
    await t.context.clock.tickAsync(60_000 * 4 + 200)
    // Await cacheValueSetPromise

    // Request for the last 2 requests should be fulfilled, since the first one will have been kicked off the queue
    const error3 = (await t.throwsAsync(makeRequest(3))) as AxiosError

    t.is(error3?.response?.status, 429)
    assertEqualResponses(t, error3?.response?.data as AdapterResponse, {
      errorMessage:
        'The EA was unable to execute the request to fetch the requested data from the DP because the request queue overflowed. This likely indicates that a higher API tier is needed.',
      statusCode: 429,
    })
  },
)
