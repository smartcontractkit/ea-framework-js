import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosResponse } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import Redis, { ScanStream } from 'ioredis'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig, BaseAdapterSettings } from '../../src/config'
import { HttpTransport, TransportRoutes } from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'
import { InputParameters } from '../../src/validation'
import { TestAdapter, assertEqualResponses, runAllUntilTime } from '../util'

export const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

class RedisMock {
  store = new Map<string, Map<string, string>>()

  async zadd(subscritpionSetKey: string, ttl: number, value: string): Promise<void> {
    if (this.store.get(subscritpionSetKey)) {
      this.store.get(subscritpionSetKey)?.set(value, String(ttl))
    } else {
      this.store.set(subscritpionSetKey, new Map<string, string>())
      this.store.get(subscritpionSetKey)?.set(value, String(ttl))
    }
  }

  async zscanStream(subscritpionSetKey: string, { match }: { match: string }): Promise<ScanStream> {
    const entries = Array.from((this.store.get(subscritpionSetKey) || new Map()).entries())
    const results = entries.filter((entry) => entry[0].startsWith(match))
    const stream = new ScanStream({ command: 'zscan', redis: {} })
    stream.push(results)
    return stream
  }

  async zrem(subscritpionSetKey: string, key: string): Promise<void> {
    this.store.get(subscritpionSetKey)?.delete(key)
  }
  async zremrangebyscore(subscritpionSetKey: string): Promise<void> {
    const expiredEntries = Array.from(
      (this.store.get(subscritpionSetKey) || new Map()).entries(),
    ).filter(([_, ttl]) => Number(ttl) < Date.now())
    expiredEntries.forEach(([key, _]) => {
      this.store.get(subscritpionSetKey)?.delete(key)
    })
  }

  async zrange(subscritpionSetKey: string): Promise<string[]> {
    return Array.from((this.store.get(subscritpionSetKey) || new Map()).keys())
  }
}

export const inputParameters = new InputParameters({
  from: {
    type: 'string',
    description: 'from',
    required: true,
  },
  to: {
    type: 'string',
    description: 'to',
    required: true,
  },
})

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
const axiosMock = new MockAdapter(axios)

type BaseEndpointTypes = {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: BaseAdapterSettings
}

type BatchEndpointTypes = BaseEndpointTypes & {
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

const batchTransport = () =>
  new HttpTransport<BatchEndpointTypes>({
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
    parseResponse: (_, res: AxiosResponse<ProviderResponseBody>) => {
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

const buildAdapter = () => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        CACHE_MAX_AGE: 1000,
        CACHE_POLLING_MAX_RETRIES: 0,
      },
    },
  )

  return new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: batchTransport(),
      }),
    ],
  })
}

const buildDualTransportAdapter = () => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        CACHE_MAX_AGE: 1000,
        CACHE_POLLING_MAX_RETRIES: 0,
      },
    },
  )

  const transports = new TransportRoutes<BaseEndpointTypes>()
    .register('rest', batchTransport())
    .register('restsecondary', batchTransport())

  return new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transportRoutes: transports,
        defaultTransport: 'rest',
      }),
    ],
  })
}

const from = 'ETH'
const to = 'USD'
const from2 = 'BTC'
const price = 1234

axiosMock
  .onPost(`${URL}/price`, {
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
  .onPost(`${URL}/price`, {
    pairs: [
      {
        base: from2,
        quote: to,
      },
    ],
  })
  .reply(200, {
    prices: [
      {
        pair: `${from2}/${to}`,
        price,
      },
    ],
  })

test.before(async (_) => {
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
    requestData: {
      from,
      to,
    },
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
  t.is(error.statusCode, 504)
})

test.serial('redis subscription set unshared between transports', async (t) => {
  const adapter = buildDualTransportAdapter()
  const dependencies: Partial<AdapterDependencies> = {
    redisClient: new RedisMock() as unknown as Redis,
  }
  t.context.testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context, dependencies)

  await t.context.testAdapter.request({
    from,
    to,
    transport: 'rest',
  })
  await t.context.testAdapter.request({
    from: from2,
    to,
    transport: 'restsecondary',
  })
  const internalHttpTransport = t.context.testAdapter.adapter.endpoints[0].transportRoutes.get(
    'rest',
  ) as unknown as HttpTransport<BatchEndpointTypes>
  const internalWsTransport = t.context.testAdapter.adapter.endpoints[0].transportRoutes.get(
    'restsecondary',
  ) as unknown as HttpTransport<BatchEndpointTypes>
  t.is((await internalHttpTransport.subscriptionSet.getAll()).length, 1)
  t.is((await internalWsTransport.subscriptionSet.getAll()).length, 1)
})
