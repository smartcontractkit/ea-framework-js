import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosResponse } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { FastifyInstance } from 'fastify'
import { Adapter, AdapterEndpoint, EndpointContext } from '../../src/adapter'
import { calculateHttpRequestKey } from '../../src/cache'
import { BaseAdapterSettings, buildAdapterSettings, AdapterConfig } from '../../src/config'
import { HttpTransport } from '../../src/transports'
import { ProviderResult, SingleNumberResultResponse, sleep } from '../../src/util'
import { InputParameters } from '../../src/validation'
import { assertEqualResponses, MockCache, runAllUntil, runAllUntilTime, TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter
  api: FastifyInstance | undefined
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const axiosMock = new MockAdapter(axios)

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

interface ProviderVolumeResponseBody {
  volumes: Array<{
    pair: string
    volume: number
  }>
}

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach(async (t) => {
  t.context.clock.uninstall()
  await t.context.testAdapter?.api.close()
})

type HttpTransportTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  Settings: BaseAdapterSettings
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

type HttpVolumeTransportTypes = HttpTransportTypes & {
  Provider: {
    ResponseBody: ProviderVolumeResponseBody
  }
}
const BACKGROUND_EXECUTE_MS_HTTP = 1000

class MockHttpTransport extends HttpTransport<HttpTransportTypes> {
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
    const entries = await this.subscriptionSet.getAll()
    if (entries.length) {
      this.backgroundExecuteCalls++
    }
    if (this.callSuper) {
      return super.backgroundExecute(context)
    }
  }
}

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
process.env['RETRY'] = '0'
process.env['BACKGROUND_EXECUTE_MS_HTTP'] = BACKGROUND_EXECUTE_MS_HTTP.toString()
process.env['API_TIMEOUT'] = '0'

const from = 'ETH'
const to = 'USD'
const price = 1234
const volume = 4567

axiosMock
  .onPost(URL + endpoint, {
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
  .onPost(URL + endpoint, {
    pairs: [
      {
        base: 'ERR',
        quote: to,
      },
    ],
  })
  .reply(500, 'There was an unexpected issue')

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
        transport: new MockHttpTransport(true),
      }),
    ],
  })

  // Start the adapter
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: { from, to },
    expectedResponse: {
      data: {
        result: price,
      },
      result: price,
      statusCode: 200,
    },
  })
})

test.serial(
  'per minute rate limit of 4 with one batch transport results in a call every 15s',
  async (t) => {
    const rateLimit1m = 4
    const transport = new MockHttpTransport(true)

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          WARMUP_SUBSCRIPTION_TTL: 100_000, // Over 1 minute, below 2 minutes
        },
      },
    )

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
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
    const testAdapter = await TestAdapter.start(adapter, t.context)

    // Expect the first response to time out
    // The polling behavior is tested in the cache tests, so this is easier here.
    const error = await testAdapter.request({ from, to })
    t.is(error.statusCode, 504)

    // Advance the clock a few minutes and check that the amount of calls is as expected
    await runAllUntilTime(t.context.clock, 3 * 60 * 1000) // 4m
    const expected =
      rateLimit1m * Math.ceil(adapter.config.settings.WARMUP_SUBSCRIPTION_TTL / 60_000)
    t.is(transport.backgroundExecuteCalls, expected)
  },
)

test.serial(
  'per second limit of 1 with one batch transport results in a call every 1000ms',
  async (t) => {
    const rateLimit1s = 1
    const transport = new MockHttpTransport(true)

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          WARMUP_SUBSCRIPTION_TTL: 100000,
        },
      },
    )

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
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
    })

    // Start the adapter
    const testAdapter = await TestAdapter.start(adapter, t.context)

    // Expect the first response to time out
    // The polling behavior is tested in the cache tests, so this is easier here.
    const error = await testAdapter.request({ from, to })
    t.is(error.statusCode, 504)

    // Run for an entire minute and check that the values are as expected
    await runAllUntilTime(t.context.clock, 60 * 1000 + 100)
    t.is(transport.backgroundExecuteCalls, 60 * rateLimit1s)
  },
)

test.serial(
  'per second limit of 1 with two batch transports that make the same request results in a call every 2000ms for each',
  async (t) => {
    const rateLimit1s = 1
    const transportA = new MockHttpTransport(true)
    const transportB = new MockHttpTransport(true)

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          WARMUP_SUBSCRIPTION_TTL: 100000,
        },
      },
    )

    const adapter = new Adapter({
      name: 'TEST',
      config,
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
    })

    // Start the adapter
    const testAdapter = await TestAdapter.start(adapter, t.context)

    const makeRequest = (endpointParam: string) =>
      testAdapter.request({
        endpoint: endpointParam,
        from,
        to,
      })

    // Expect the first response to time out
    const errorA = await makeRequest('A')
    t.is(errorA?.statusCode, 504)

    // Do the same thing for transport B
    const errorB = await makeRequest('B')
    t.is(errorB?.statusCode, 504)

    await runAllUntilTime(t.context.clock, 20 * 1000)
    t.is(transportA.backgroundExecuteCalls, 10 * rateLimit1s)
    t.is(transportB.backgroundExecuteCalls, 10 * rateLimit1s)
  },
)

test.serial(
  'per second limit of 1 with two batch transports results in a call every 2000ms for each',
  async (t) => {
    const rateLimit1s = 1
    const transportA = new MockHttpTransport(true)
    const transportB = new MockHttpTransport(true)

    axiosMock
      .onPost(URL + endpoint, {
        pairs: [
          {
            base: `${from}A`,
            quote: to,
          },
        ],
      })
      .reply(200, {
        prices: [
          {
            pair: `${from}A/${to}`,
            price,
          },
        ],
      })
      .onPost(URL + endpoint, {
        pairs: [
          {
            base: `${from}B`,
            quote: to,
          },
        ],
      })
      .reply(200, {
        prices: [
          {
            pair: `${from}B/${to}`,
            price,
          },
        ],
      })

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          WARMUP_SUBSCRIPTION_TTL: 100000,
        },
      },
    )

    const adapter = new Adapter({
      name: 'TEST',
      config,
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
    })

    // Start the adapter
    const testAdapter = await TestAdapter.start(adapter, t.context)

    const makeRequest = (endpointParam: string) =>
      testAdapter.request({
        endpoint: endpointParam,
        from: from + endpointParam,
        to,
      })

    // Expect the first response to time out
    const errorA = await makeRequest('A')
    t.is(errorA?.statusCode, 504)

    // Do the same thing for transport B
    const errorB = await makeRequest('B')
    t.is(errorB?.statusCode, 504)

    // Run for a minute (59s actually, it'll start at 0 and go on regular intervals)
    await runAllUntilTime(t.context.clock, 10 * 1000)
    t.is(transportA.backgroundExecuteCalls, 5 * rateLimit1s)
    t.is(transportB.backgroundExecuteCalls, 5 * rateLimit1s)
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
        transport: new MockHttpTransport(true),
      }),
    ],
  })
  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache(adapter.config.settings.CACHE_MAX_ITEMS)

  // Start the adapter
  const testAdapter = await TestAdapter.start(adapter, t.context, {
    cache: mockCache,
  })

  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: {
      from: 'ERR',
      to,
    },
    expectedResponse: {
      errorMessage:
        'Provider request failed with status undefined: "There was an unexpected issue"',
      statusCode: 502,
    },
  })
})

test.serial('requests from different transports are NOT coalesced', async (t) => {
  const transportA = new MockHttpTransport(true)
  const transportB = new (class extends HttpTransport<HttpVolumeTransportTypes> {
    backgroundExecuteCalls = 0

    constructor() {
      super({
        prepareRequests: (params) => ({
          params,
          request: {
            baseURL: URL,
            url: '/volume',
            method: 'POST',
            data: {
              pairs: params.map((p) => ({ base: p.from, quote: p.to })),
            },
          },
        }),
        parseResponse: (
          params: AdapterRequestParams[],
          res: AxiosResponse<ProviderVolumeResponseBody>,
        ): ProviderResult<HttpVolumeTransportTypes>[] =>
          res.data.volumes?.map((p) => {
            const [base, quote] = p.pair.split('/')
            return {
              params: { from: base, to: quote },
              response: {
                data: {
                  result: p.volume,
                },
                result: p.volume,
              },
            }
          }) || [],
      })
    }
    override async backgroundExecute(
      context: EndpointContext<HttpVolumeTransportTypes>,
    ): Promise<void> {
      const entries = await this.subscriptionSet.getAll()
      if (entries.length) {
        this.backgroundExecuteCalls++
      }
      return super.backgroundExecute(context)
    }
  })()

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'testA',
    endpoints: [
      new AdapterEndpoint({
        name: 'testA',
        inputParameters,
        transport: transportA,
      }),
      new AdapterEndpoint({
        name: 'testB',
        inputParameters,
        transport: transportB,
      }),
    ],
  })

  // Start the adapter
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  axiosMock
    .onPost(`${URL}/volume`, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(200, {
      volumes: [
        {
          pair: `${from}/${to}`,
          volume,
        },
      ],
    })

  const makeRequest = (endpointParam: string) =>
    testAdapter.request({
      from,
      to,
      endpoint: endpointParam,
    })

  // Expect the first response to time out
  // The polling behavior is tested in the cache tests, so this is easier here.
  const errorA = await makeRequest('testA')
  const errorB = await makeRequest('testB')
  t.is(errorA?.statusCode, 504)
  t.is(errorB?.statusCode, 504)

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  await runAllUntil(t.context.clock, () => testAdapter.mockCache.cache.size > 1)

  // Second request should find the response in the cache
  const responseA = await makeRequest('testA')
  const responseB = await makeRequest('testB')

  t.is(responseA.statusCode, 200)
  assertEqualResponses(t, responseA.json(), {
    data: {
      result: price,
    },
    result: price,
    statusCode: 200,
  })
  t.is(responseB.statusCode, 200)
  assertEqualResponses(t, responseB.json(), {
    data: {
      result: volume,
    },
    result: volume,
    statusCode: 200,
  })
})

test.serial('requests for the same transport are coalesced', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new MockHttpTransport(true),
      }),
    ],
  })

  axiosMock
    .onPost(endpoint, {
      pairs: [
        {
          base: 'COALESCE2',
          quote: to,
        },
      ],
    })
    .replyOnce(async () => {
      await sleep(BACKGROUND_EXECUTE_MS_HTTP)
      return [
        200,
        {
          prices: [
            {
              pair: `coalesce2/${to}`,
              price,
            },
          ],
        },
      ]
    })

  // Start the adapter
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: {
      from: 'COALESCE2',
      to,
    },
  })
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

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          // These mean the first request will be queued and immediately fired,
          // the second will be queued, and the third will replace the second in the queue.
          MAX_HTTP_REQUEST_QUEUE_LENGTH: 1,
          RATE_LIMIT_CAPACITY_MINUTE: 1,
        },
      },
    )

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: numbers.map(
        (n) =>
          new AdapterEndpoint({
            name: `${n}`,
            inputParameters,
            transport: new MockHttpTransport(true),
          }),
      ),
    })

    // Mock valid responses for the requests we'll send
    for (const number of numbers) {
      axiosMock
        .onPost(URL + endpoint, {
          pairs: [
            {
              base: `symbol${number}`,
              quote: to,
            },
          ],
        })
        .reply(async () => {
          await sleep(2 * 60000)
          return [
            200,
            {
              prices: [
                {
                  pair: `symbol${number}/${to}`,
                  price,
                },
              ],
            },
          ]
        })
    }

    // Advance the clock for a second so we can do all this logic and the interval break doesn't occur right in the middle
    t.context.clock.tick(1000)

    // Start the adapter
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

    const makeRequest = (number: number) =>
      testAdapter.request({
        from: `symbol${number}`,
        to,
        endpoint: `${number}`,
      })

    // Send an initial request for all our numbers to ensure they're part of the subscription set
    for (const number of numbers) {
      // Expect the first response to time out
      // The polling behavior is tested in the cache tests, so this is easier here.
      const error = await makeRequest(number)
      t.is(error.statusCode, 504)
    }

    // Advance clock so that the batch warmer executes
    await t.context.clock.tickAsync(60_000)

    // Request for the last 2 requests should be fulfilled, since the first one will have been kicked off the queue
    const error3 = await makeRequest(3)
    t.is(error3?.statusCode, 429)
    assertEqualResponses(t, error3.json(), {
      errorMessage:
        'The EA was unable to execute the request to fetch the requested data from the DP because the request queue overflowed. This likely indicates that a higher API tier is needed.',
      statusCode: 429,
    })
  },
)

test.serial('builds HTTP request queue key correctly from input params', async (t) => {
  const endpointName = 'test'
  const adapterSettings = buildAdapterSettings({})
  const params: InputParameters = {
    base: {
      type: 'string',
      required: true,
    },
    quote: {
      type: 'string',
      required: true,
    },
  }
  const data = { base: 'ETH', quote: 'BTC' }
  t.is(
    calculateHttpRequestKey({
      data,
      transportName: 'transport',
      context: {
        endpointName,
        adapterSettings,
        inputParameters: params,
      },
    }),
    'test-transport-{"base":"eth","quote":"btc"}',
  )
})
