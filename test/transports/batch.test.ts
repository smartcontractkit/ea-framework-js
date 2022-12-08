import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { Adapter, EndpointContext, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { DEFAULT_SHARED_MS_BETWEEN_REQUESTS } from '../../src/rate-limiting'
import { BatchWarmingTransport } from '../../src/transports'
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

type BatchTransportTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  CustomSettings: SettingsMap
  Provider: {
    RequestBody: unknown
    ResponseBody: ProviderResponseBody
  }
}

class MockBatchWarmingTransport extends BatchWarmingTransport<BatchTransportTypes> {
  backgroundExecuteCalls = 0

  constructor(private callSuper = false) {
    super({
      prepareRequest: (params: AdapterRequestParams[]): AxiosRequestConfig<ProviderRequestBody> => {
        return {
          baseURL: URL,
          url: '/price',
          method: 'POST',
          data: {
            pairs: params.map((p) => ({ base: p.from, quote: p.to })),
          },
        }
      },
      parseResponse: (
        params: AdapterRequestParams[],
        res: AxiosResponse<ProviderResponseBody>,
      ): ProviderResult<BatchTransportTypes>[] => {
        return (
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
          }) || []
        )
      },
    })
  }

  override async backgroundExecute(context: EndpointContext<BatchTransportTypes>): Promise<void> {
    this.backgroundExecuteCalls++
    if (this.callSuper) {
      super.backgroundExecute(context)
    }
  }
}

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'

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
  const mockCache = new MockCache(adapter.config.CACHE_MAX_ITEMS)

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
  await t.context.clock.tickAsync(DEFAULT_SHARED_MS_BETWEEN_REQUESTS + 10)
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

test.serial('batch request validation', async (t) => {
  nock(URL)
    .post(endpoint, {
      pairs: [
        {
          base: 'BTC',
          quote: 'USD',
        },
      ],
    })
    .reply()
    .persist()
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
    envDefaultOverrides: {
      BATCH_TRANSPORT_SETUP_VALIDATION: true,
    },
  })

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache(adapter.config.CACHE_MAX_ITEMS)

  // Start the adapter
  const api = await expose(adapter, { cache: mockCache })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeBadRequest = () =>
    axios.post(
      address,
      {
        data: {
          from: 'BTC',
          to: 'USD',
        },
      },
      {
        headers: {
          'x-correlation-id': 'Bad-Test-Request',
        },
      },
    )
  const makeGoodRequest = () =>
    axios.post(
      address,
      {
        data: {
          from,
          to,
        },
      },
      {
        headers: {
          'x-correlation-id': 'Good-Test-Request',
        },
      },
    )

  // Start good request:
  const errorPromise = t.throwsAsync(makeGoodRequest)
  await errorPromise

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  const cacheValueSetPromise = mockCache.waitForNextSet()
  await runAllUntilTime(t.context.clock, DEFAULT_SHARED_MS_BETWEEN_REQUESTS + 10)
  await cacheValueSetPromise

  // Cache should be populated with the good request
  const response = await makeGoodRequest()

  t.is(response.status, 200)
  assertEqualResponses(t, response.data, {
    data: {
      result: price,
    },
    result: price,
    statusCode: 200,
  })

  // Cache should not have a value for the bad request even after background execute cycle
  // Request would not have been added to the subscription set due to validation failure
  const badRequestResponse = await makeBadRequest()
  t.is(badRequestResponse.status, 200)
  t.is(
    badRequestResponse.data.error.message,
    'There was an error while validating the incoming request before adding to the batch subscription set',
  )
})

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
  const mockCache = new MockCache(adapter.config.CACHE_MAX_ITEMS)

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
  await runAllUntilTime(t.context.clock, DEFAULT_SHARED_MS_BETWEEN_REQUESTS + 100)
  await cacheValueSetPromise

  // Second request should find the response in the cache
  const error2 = (await t.throwsAsync(makeRequest)) as AxiosError

  t.is(error2?.response?.status, 502)
  assertEqualResponses(t, error2?.response?.data as AdapterResponse, {
    errorMessage: 'Provider request failed with status undefined: "There was an unexpected issue"',
    statusCode: 502,
  })
})
