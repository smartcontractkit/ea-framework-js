import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { AxiosResponse } from 'axios'
import Redis, { ScanStream } from 'ioredis'
import nock from 'nock'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { HttpTransport } from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'
import { assertEqualResponses, runAllUntilTime, TestAdapter } from '../util'

export const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

class RedisMock {
  store = new Map<string, string>()

  async zadd(_: string, ttl: number, value: string): Promise<void> {
    this.store.set(value, String(ttl))
  }

  async zscanStream(_: string, { match }: { match: string }): Promise<ScanStream> {
    const entries = Array.from(this.store.entries())
    const results = entries.filter((entry) => entry[0].startsWith(match))
    const stream = new ScanStream({ command: 'zscan', redis: {} })
    stream.push(results)
    return stream
  }

  async zrem(_: string, key: string): Promise<void> {
    this.store.delete(key)
  }
  async zremrangebyscore(): Promise<void> {
    const expiredEntries = Array.from(this.store.entries()).filter(
      ([key, ttl]) => Number(ttl) < Date.now(),
    )
    expiredEntries.forEach(([key, ttl]) => {
      this.store.delete(key)
    })
  }

  async zrange(): Promise<string[]> {
    return Array.from(this.store.keys())
  }
}

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

const URL = 'https://test.chainlink.com'

type BatchEndpointTypes = {
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

const buildAdapter = () => {
  const batchTransport = new HttpTransport<BatchEndpointTypes>({
    prepareRequests: (params) => {
      return {
        params,
        request: {
          baseURL: URL,
          url: '/price',
          method: 'POST',
          data: {
            pairs: params.map((p) => ({ base: p.from, quote: p.to })),
          },
        },
      }
    },
    parseResponse: (_: AdapterRequestParams[], res: AxiosResponse<ProviderResponseBody>) => {
      return res.data.prices.map((p) => {
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
      })
    },
  })

  return new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: batchTransport,
      }),
    ],
    envDefaultOverrides: {
      CACHE_MAX_AGE: 1000,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })
}

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

const from = 'ETH'
const to = 'USD'
const price = 1234

nock(URL)
  .post('/price', {
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

test.before(async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  // So that we don't have to wait that long in the test for the subscription to expire
  process.env['WARMUP_SUBSCRIPTION_TTL'] = '5000'
  // So that we don't see errors from the mocked clock running until axios' http timeout timer
  process.env['API_TIMEOUT'] = '0'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['CACHE_MAX_AGE'] = '2000'
  process.env['BACKGROUND_EXECUTE_MS_HTTP'] = '1000'
})

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach((t) => {
  t.context.clock.uninstall()
})

test.serial('Test redis subscription set (add and getAll)', async (t) => {
  const adapter = buildAdapter()
  const dependencies: Partial<AdapterDependencies> = {
    redisClient: new RedisMock() as unknown as Redis,
  }

  t.context.testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context, dependencies)

  const response = await t.context.testAdapter.startBackgroundExecuteThenGetResponse(t, {
    from,
    to,
  })
  assertEqualResponses(t, response.json(), {
    data: {
      result: price,
    },
    result: price,
    statusCode: 200,
  })

  // Wait until the cache expires, and the subscription is out
  await runAllUntilTime(t.context.clock, 20000)

  // Now that the cache is out and the subscription no longer there, this should time out
  const error = await t.context.testAdapter.request({ from, to })
  t.is(error?.statusCode, 504)
})
