import { installTimers } from '../helper'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosResponse } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { FastifyInstance } from 'fastify'
import { Adapter, AdapterEndpoint, EndpointContext } from '../../src/adapter'
import { AdapterError } from '../../src/validation/error'
import { AdapterConfig } from '../../src/config'
import {
  HttpTransport,
  Transport,
  TransportDependencies,
  TransportGenerics,
  TransportRoutes,
} from '../../src/transports'
import { ResponseCache } from '../../src/cache/response'
import { AdapterRequest } from '../../src/util/types'
import { TestAdapter } from '../../src/util/testing-utils'
import { TypeFromDefinition } from '../../src/validation/input-params'
import { cacheTestInputParameters, CacheTestTransportTypes } from '../cache/helper'

const test = untypedTest as TestFn<{
  clock: ReturnType<typeof installTimers>
  testAdapter: TestAdapter
  api: FastifyInstance | undefined
  ws: CountingCacheHttpTransport
  rest: CountingCacheHttpTransport
}>

process.env['CACHE_POLLING_MAX_RETRIES'] = '20'
process.env['CACHE_POLLING_SLEEP_MS'] = '10'
process.env['RETRY'] = '0'
process.env['BACKGROUND_EXECUTE_MS_HTTP'] = '1'
process.env['API_TIMEOUT'] = '0'

const WS_PROVIDER = 'http://ea-composite-ws.test'
const REST_PROVIDER = 'http://ea-composite-rest.test'

const axiosMock = new MockAdapter(axios)

type CacheTestHttpTypes = CacheTestTransportTypes & {
  Provider: {
    RequestBody: unknown
    ResponseBody: { result: number; ts?: number }
  }
}

class CountingCacheHttpTransport extends HttpTransport<CacheTestHttpTypes> {
  registerRequestCalls = 0

  constructor(logicalName: string, baseURL: string) {
    super({
      prepareRequests: (params) =>
        params.map((p) => ({
          params: [p],
          request: {
            baseURL,
            url: '/price',
            method: 'GET',
            params: { base: p.base, factor: p.factor },
          },
        })),
      parseResponse: (params, res: AxiosResponse<{ result: number; ts?: number }>) =>
        params.map((p) => ({
          params: p,
          response: {
            data: null,
            result: res.data.result,
            timestamps: {
              providerDataRequestedUnixMs: 0,
              providerDataReceivedUnixMs: 0,
              providerIndicatedTimeUnixMs: res.data.ts ?? 1,
            },
          },
        })),
    })
    this.name = logicalName
  }

  override async registerRequest(
    req: AdapterRequest<TypeFromDefinition<CacheTestHttpTypes['Parameters']>>,
    settings: CacheTestHttpTypes['Settings'],
  ): Promise<void> {
    this.registerRequestCalls++
    return super.registerRequest(req, settings)
  }
}

test.before(async (t) => {
  t.context.clock = installTimers()

  const ws = new CountingCacheHttpTransport('ws', WS_PROVIDER)
  const rest = new CountingCacheHttpTransport('rest', REST_PROVIDER)
  t.context.ws = ws
  t.context.rest = rest

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: cacheTestInputParameters,
        enableCompositeTransport: true,
        transportRoutes: new TransportRoutes<CacheTestHttpTypes>()
          .register('ws', ws)
          .register('rest', rest),
      }),
    ],
    config: new AdapterConfig({}, { envDefaultOverrides: { COMPOSITE_TRANSPORT: true } }),
  })

  await TestAdapter.start(adapter, t.context)
})

test.after(async (t) => {
  await t.context.testAdapter?.api.close()
})

test.afterEach((t) => {
  t.context.ws.registerRequestCalls = 0
  t.context.rest.registerRequestCalls = 0
})

test.serial(
  'composite transport returns value from working transport when one transport fails to produce a value',
  async (t) => {
    axiosMock.onGet(`${WS_PROVIDER}/price`, { params: { base: 'ETH', factor: 5 } }).reply(500)
    axiosMock
      .onGet(`${REST_PROVIDER}/price`, { params: { base: 'ETH', factor: 5 } })
      .reply(200, { result: 42, ts: 100 })

    const res = await t.context.testAdapter.request({ base: 'ETH', factor: 5 })

    t.is(res.statusCode, 200)
    t.is(res.json().result, 42)
    t.is(t.context.ws.registerRequestCalls, 1)
    t.is(t.context.rest.registerRequestCalls, 1)
  },
)

test.serial(
  'composite transport merges child writes by providerIndicatedTimeUnixMs when run under an adapter, takes newest timestamped value',
  async (t) => {
    axiosMock
      .onGet(`${WS_PROVIDER}/price`, { params: { base: 'BTC', factor: 3 } })
      .reply(200, { result: 10, ts: 1000 })
    axiosMock
      .onGet(`${REST_PROVIDER}/price`, { params: { base: 'BTC', factor: 3 } })
      .reply(200, { result: 100, ts: 2000 })

    t.is(t.context.ws.name, 'ws')
    t.is(t.context.rest.name, 'rest')

    const res = await t.context.testAdapter.request({ base: 'BTC', factor: 3, transport: 'rest' })

    t.is(res.statusCode, 200)
    t.is(res.json().result, 100)
    t.is(t.context.ws.registerRequestCalls, 1)
    t.is(t.context.rest.registerRequestCalls, 1)
  },
)

test.serial(
  'composite transport refreshes TTL when both transports return same value at same timestamp',
  async (t) => {
    axiosMock
      .onGet(`${WS_PROVIDER}/price`, { params: { base: 'XRP', factor: 1 } })
      .reply(200, { result: 42, ts: 100 })
    axiosMock
      .onGet(`${REST_PROVIDER}/price`, { params: { base: 'XRP', factor: 1 } })
      .reply(200, { result: 42, ts: 100 })

    const res = await t.context.testAdapter.request({ base: 'XRP', factor: 1 })

    // How to test whether the params were refreshed in the cache?
    // we can check that the response is correct and then check that the ws transport was called again
    // on a subsequent request, indicating that the cache entry was refreshed and the ws transport was used again instead of the rest transport

    t.is(res.statusCode, 200)
    t.is(res.json().result, 42)
  },
)

test.serial(
  'composite transport does not rubberband when transports return conflicting values at same timestamp',
  async (t) => {
    // Send first request
    axiosMock
      .onGet(`${WS_PROVIDER}/price`, { params: { base: 'ABC', factor: 1 } })
      .reply(200, { result: 10, ts: 200 })

    const res = await t.context.testAdapter.request({ base: 'ABC', factor: 1 })
    t.is(res.statusCode, 200)
    t.is(res.json().result, 10)

    // Send second request with same timestamp but different value
    axiosMock
      .onGet(`${REST_PROVIDER}/price`, { params: { base: 'ABC', factor: 1 } })
      .reply(200, { result: 99, ts: 200 })

    const res2 = await t.context.testAdapter.request({ base: 'ABC', factor: 1 })
    t.is(res2.statusCode, 200)
    t.is(res2.json().result, 10)
  },
)

class ThrowingTransport<T extends TransportGenerics> implements Transport<T> {
  name!: string
  responseCache!: ResponseCache<T>

  async initialize(
    dependencies: TransportDependencies<T>,
    _adapterSettings: T['Settings'],
    _endpointName: string,
    transportName: string,
  ): Promise<void> {
    this.name = transportName
    this.responseCache = dependencies.responseCache
  }

  async registerRequest(
    _req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    _adapterSettings: T['Settings'],
  ): Promise<void> {
    throw new Error('ThrowingTransport.registerRequest intentional error')
  }

  async backgroundExecute(_context: EndpointContext<T>): Promise<void> {
    throw new Error('ThrowingTransport.backgroundExecute intentional error')
  }
}

test.serial(
  'composite transport returns value from working transport when the other transport throws in registerRequest and backgroundExecute',
  async (t) => {
    const workingTransport = new CountingCacheHttpTransport('working', WS_PROVIDER)
    const throwingTransport = new ThrowingTransport<CacheTestHttpTypes>()

    const adapter = new Adapter({
      name: 'TEST_THROWING',
      defaultEndpoint: 'test',
      endpoints: [
        new AdapterEndpoint({
          name: 'test',
          inputParameters: cacheTestInputParameters,
          enableCompositeTransport: true,
          transportRoutes: new TransportRoutes<CacheTestHttpTypes>()
            .register('working', workingTransport)
            .register('throwing', throwingTransport),
        }),
      ],
      config: new AdapterConfig({}, { envDefaultOverrides: { COMPOSITE_TRANSPORT: true } }),
    })

    const localContext = { clock: t.context.clock } as typeof t.context
    const localAdapter = await TestAdapter.start(adapter, localContext)

    axiosMock
      .onGet(`${WS_PROVIDER}/price`, { params: { base: 'LINK', factor: 2 } })
      .reply(200, { result: 77, ts: 100 })

    const res = await localAdapter.request({ base: 'LINK', factor: 2 })

    t.is(res.statusCode, 200)
    t.is(res.json().result, 77)
    t.is(workingTransport.registerRequestCalls, 1)

    await localAdapter.api.close()
  },
)

test.serial(
  'enableCompositeTransport does not use composite routing when COMPOSITE_TRANSPORT is false',
  async (t) => {
    const ws = new CountingCacheHttpTransport('ws', WS_PROVIDER)
    const rest = new CountingCacheHttpTransport('rest', REST_PROVIDER)

    const adapter = new Adapter({
      name: 'TEST_COMPOSITE_OFF',
      defaultEndpoint: 'test',
      endpoints: [
        new AdapterEndpoint({
          name: 'test',
          inputParameters: cacheTestInputParameters,
          enableCompositeTransport: true,
          transportRoutes: new TransportRoutes<CacheTestHttpTypes>()
            .register('ws', ws)
            .register('rest', rest),
        }),
      ],
      config: new AdapterConfig({}, { envDefaultOverrides: { COMPOSITE_TRANSPORT: false } }),
    })

    const localContext = { clock: t.context.clock } as typeof t.context
    const localAdapter = await TestAdapter.start(adapter, localContext)

    axiosMock
      .onGet(`${REST_PROVIDER}/price`, { params: { base: 'SOL', factor: 7 } })
      .reply(200, { result: 99, ts: 50 })

    const res = await localAdapter.request({ base: 'SOL', factor: 7, transport: 'rest' })

    t.is(res.statusCode, 200)
    t.is(res.json().result, 99)
    t.is(ws.registerRequestCalls, 0)
    t.is(rest.registerRequestCalls, 1)

    await localAdapter.api.close()
  },
)

test.serial(
  'AdapterEndpoint throws when enableCompositeTransport is true with only one transport',
  (t) => {
    const onlyTransport = new CountingCacheHttpTransport('only', WS_PROVIDER)

    const error = t.throws<AdapterError>(
      () =>
        new AdapterEndpoint({
          name: 'test',
          inputParameters: cacheTestInputParameters,
          enableCompositeTransport: true,
          transportRoutes: new TransportRoutes<CacheTestHttpTypes>().register(
            'only',
            onlyTransport,
          ),
        }),
      { instanceOf: AdapterError },
    )

    t.is(error?.message, 'Composite transport requires at least 2 transports')
    t.is(error?.statusCode, 400)
  },
)
