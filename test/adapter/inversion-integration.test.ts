import test from 'ava'
import { EventSource } from 'eventsource'
import Redis from 'ioredis'
import {
  Adapter,
  AdapterEndpoint,
  EndpointContext,
  ForexPriceEndpoint,
  LwbaEndpoint,
  LwbaResponseDataFields,
  PriceAdapter,
  PriceEndpoint,
  lwbaEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { AdapterConfig, buildAdapterSettings, EmptyCustomSettings } from '../../src/config'
import { toInverseCacheKey } from '../../src/cache'
import { metrics } from '../../src/metrics'
import { RateLimiterFactory, RateLimitingStrategy } from '../../src/rate-limiting/factory'
import { HttpTransport, TransportGenerics, TransportRoutes } from '../../src/transports'
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import {
  AdapterRequest,
  AdapterRequestContext,
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { MockCache, RedisMock, TestAdapter } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
import { AdapterRateLimitError } from '../../src/validation/error'
import { TypeFromDefinition } from '../../src/validation/input-params'
import { countCacheKeyCalculations } from '../helper'

type TestContext = {
  testAdapter: TestAdapter
}

const inputParameters = new InputParameters(priceEndpointInputParametersDefinition)

type TestGenerics = {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: EmptyCustomSettings
}

type TestParams = TypeFromDefinition<TestGenerics['Parameters']>

type HttpTestGenerics = TestGenerics & {
  Provider: {
    RequestBody: unknown
    ResponseBody: { price: number }
  }
}

const timestamps = {
  providerDataRequestedUnixMs: 0,
  providerDataReceivedUnixMs: 0,
  providerIndicatedTimeUnixMs: undefined,
}

class ForegroundPriceTransport extends SubscriptionTransport<TestGenerics> {
  receivedData: Record<string, unknown>[] = []
  receivedCacheKeys: string[] = []
  receivedRawCacheKeys: (string | undefined)[] = []

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(): Promise<void> {
    return
  }

  async foregroundExecute(
    req: AdapterRequest<TestParams>,
  ): Promise<AdapterResponse<TestGenerics['Response']>> {
    this.receivedData.push(req.requestContext.data as Record<string, unknown>)
    this.receivedCacheKeys.push(req.requestContext.cacheKey)
    this.receivedRawCacheKeys.push(req.requestContext.rawCacheKey)
    return {
      data: { result: 4 },
      result: 4,
      statusCode: 200,
      timestamps,
    }
  }
}

const quoteInputParameters = new InputParameters(lwbaEndpointInputParametersDefinition)

type QuoteGenerics = {
  Parameters: typeof quoteInputParameters.definition
  Response: LwbaResponseDataFields
  Settings: EmptyCustomSettings
}

const defaultQuote: LwbaResponseDataFields['Data'] = { bid: 1, ask: 1.2, mid: 1.1 }

/** Records the request contexts it is given, and never writes anything to the cache. */
class CacheTestTransport extends SubscriptionTransport<TestGenerics> {
  providerEntries: Record<string, unknown>[] = []
  requestContexts: AdapterRequestContext<TestParams>[] = []

  override async registerRequest(
    req: AdapterRequest<TestParams>,
    settings: EmptyCustomSettings,
  ): Promise<void> {
    this.requestContexts.push({ ...req.requestContext })
    await super.registerRequest(req, settings)
  }

  getSubscriptionTtlFromConfig(): number {
    return 60_000
  }

  async backgroundHandler(
    _context: EndpointContext<TestGenerics>,
    entries: TestParams[],
  ): Promise<void> {
    this.providerEntries = entries as Record<string, unknown>[]
  }

  async produce(result: TimestampedProviderResult<TestGenerics>): Promise<void> {
    await this.responseCache.write(this.name, [result])
  }
}

/** Same as CacheTestTransport, but its background cycles compute no cache keys. */
class QuietTransport extends CacheTestTransport {
  override async backgroundExecute(): Promise<void> {
    return
  }
}

class CacheBackedTransport extends SubscriptionTransport<TestGenerics> {
  providerEntries: Record<string, unknown>[] = []
  providerResponse: TimestampedProviderResult<TestGenerics>['response'] = {
    data: { result: 4 },
    result: 4,
    timestamps,
  }

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(
    _context: EndpointContext<TestGenerics>,
    entries: TestParams[],
  ): Promise<void> {
    this.providerEntries = entries as Record<string, unknown>[]
    await Promise.all(
      entries.map((entry) =>
        this.responseCache.write(this.name, [{ params: entry, response: this.providerResponse }]),
      ),
    )
  }
}

class CacheBackedQuoteTransport extends SubscriptionTransport<QuoteGenerics> {
  providerData: LwbaResponseDataFields['Data'] & { bidSize?: number; askSize?: number } = {
    ...defaultQuote,
    bidSize: 10,
    askSize: 20,
  }

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(
    _context: EndpointContext<QuoteGenerics>,
    entries: TypeFromDefinition<QuoteGenerics['Parameters']>[],
  ): Promise<void> {
    await Promise.all(
      entries.map((entry) =>
        this.responseCache.write(this.name, [
          {
            params: entry,
            response: {
              result: null,
              data: { ...this.providerData } as unknown as LwbaResponseDataFields['Data'],
              timestamps,
            },
          },
        ]),
      ),
    )
  }
}

const buildDependencies = (): AdapterDependencies => {
  const adapterSettings = buildAdapterSettings({})
  const redisClient = new RedisMock() as unknown as Redis
  return {
    cache: new MockCache(adapterSettings.CACHE_MAX_ITEMS),
    rateLimiter: RateLimiterFactory.buildRateLimiter(
      RateLimitingStrategy.FIXED_INTERVAL,
    ).initialize([], undefined),
    subscriptionSetFactory: new SubscriptionSetFactory(adapterSettings, 'TEST', redisClient),
    redisClient,
    eventSource: EventSource as unknown as typeof EventSource,
    requester: {} as AdapterDependencies['requester'],
    loggerFactory: LoggerFactoryProvider.get(),
  }
}

const buildPriceAdapter = (
  transport: SubscriptionTransport<TestGenerics>,
  options: {
    includes?: ConstructorParameters<typeof PriceAdapter>[0]['includes']
    envDefaultOverrides?: Record<string, number>
  } = {},
): Adapter =>
  new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new ForexPriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport,
      }),
    ],
    ...(options.includes ? { includes: options.includes } : {}),
    config: new AdapterConfig({}, { envDefaultOverrides: options.envDefaultOverrides ?? {} }),
  })

const btcUsd = { base: 'BTC', quote: 'USD' } as TestParams
const cachePollingConfig = {
  CACHE_POLLING_MAX_RETRIES: 20,
  CACHE_POLLING_SLEEP_MS: 10,
}

const buildPriceEndpoint = async <T extends TestGenerics>(
  transport: SubscriptionTransport<T>,
  dependencies = buildDependencies(),
  adapterSettings = buildAdapterSettings({}),
) => {
  const endpoint = new ForexPriceEndpoint<T>({
    name: 'test',
    inputParameters: inputParameters as InputParameters<T['Parameters']>,
    transport,
  })
  await endpoint.initialize('TEST', dependencies, adapterSettings)
  return { dependencies, adapterSettings }
}

const addSubscriptions = async <T extends TransportGenerics>(
  transport: SubscriptionTransport<T>,
  entries: TypeFromDefinition<T['Parameters']>[],
  inverse = false,
): Promise<void> => {
  await Promise.all(
    entries.map(async (entry) => {
      const rawKey = transport.responseCache.getCacheKey(transport.name, entry)
      await transport.subscriptionSet.add(entry, 1000, rawKey)
      if (inverse) {
        await transport.inverseSubscriptionSet.add(entry, 1000, rawKey)
      }
    }),
  )
}

const getCached = async <T extends TransportGenerics>(
  cache: AdapterDependencies['cache'],
  transport: SubscriptionTransport<T>,
  params: TypeFromDefinition<T['Parameters']>,
): Promise<AdapterResponse<T['Response']> | undefined> =>
  (await cache.get(transport.responseCache.getCacheKey(transport.name, params))) as
    AdapterResponse<T['Response']> | undefined

const getCachedInverse = async <T extends TransportGenerics>(
  cache: AdapterDependencies['cache'],
  transport: SubscriptionTransport<T>,
  params: TypeFromDefinition<T['Parameters']>,
): Promise<AdapterResponse<T['Response']> | undefined> =>
  (await cache.get(
    toInverseCacheKey(transport.responseCache.getCacheKey(transport.name, params)),
  )) as AdapterResponse<T['Response']> | undefined

const runHttpInversion = async (
  dependencies: AdapterDependencies,
  transport: HttpTransport<HttpTestGenerics>,
) => {
  const { adapterSettings } = await buildPriceEndpoint(transport, dependencies)
  const rawParams = btcUsd
  await addSubscriptions(transport, [rawParams], true)
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  return {
    rawParams,
    rawCached: await getCached(dependencies.cache, transport, rawParams),
    inverseCached: await getCachedInverse(dependencies.cache, transport, rawParams),
  }
}

const produceResult = (transport: CacheTestTransport, params: TestParams, value: number) =>
  transport.produce({
    params,
    response: {
      data: { result: value },
      result: value,
      timestamps,
    },
  })

const runRequestLevelInversion = async <T extends TransportGenerics>(
  testAdapter: TestAdapter & { mockCache: MockCache },
  transport: SubscriptionTransport<T>,
  requestParams: TypeFromDefinition<T['Parameters']>,
  cacheParams = requestParams,
) => {
  const rawResponse = await testAdapter.request({ endpoint: 'test', ...requestParams })
  await testAdapter.mockCache.delete(
    transport.responseCache.getCacheKey(transport.name, cacheParams),
  )
  const inverseResponse = await testAdapter.request({
    endpoint: 'test',
    ...requestParams,
    inversion: true,
  })

  return {
    rawResponse,
    inverseResponse,
    rawCached: await getCached(testAdapter.mockCache, transport, cacheParams),
    inverseCached: await getCachedInverse(testAdapter.mockCache, transport, cacheParams),
  }
}

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

test.serial('inversion is rejected with 400 when unsupported', async (t) => {
  const compositeRoutes = () =>
    new TransportRoutes<TestGenerics>()
      .register('first', new CacheTestTransport())
      .register('second', new CacheTestTransport())

  const scenarios: {
    name: string
    endpoint: AdapterEndpoint<TestGenerics>
    data: Record<string, unknown>
    expectedMessage: string
  }[] = [
    {
      name: 'no-inverter',
      endpoint: new AdapterEndpoint<TestGenerics>({
        name: 'no-inverter',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: true },
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'plain-price-endpoint',
      endpoint: new PriceEndpoint<TestGenerics>({
        name: 'plain-price-endpoint',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: true },
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'foreground',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'foreground',
        inputParameters,
        transport: new ForegroundPriceTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: true },
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'composite',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'composite',
        inputParameters,
        transportRoutes: compositeRoutes(),
        enableCompositeTransport: true,
      }),
      data: { base: 'BTC', quote: 'USD', inversion: true },
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'custom-cache-key',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'custom-cache-key',
        inputParameters,
        transport: new CacheTestTransport(),
        cacheKeyGenerator: () => 'custom-key',
      }),
      data: { base: 'BTC', quote: 'USD', inversion: true },
      expectedMessage: 'custom cacheKeyGenerator',
    },
    {
      name: 'string-true',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'string-true',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: 'true' },
      expectedMessage: 'must be a boolean',
    },
    {
      name: 'number-one',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'number-one',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: 1 },
      expectedMessage: 'must be a boolean',
    },
    {
      name: 'null',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'null',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: null },
      expectedMessage: 'must be a boolean',
    },
    {
      name: 'object',
      endpoint: new ForexPriceEndpoint<TestGenerics>({
        name: 'object',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: { enabled: true } },
      expectedMessage: 'must be a boolean',
    },
  ]

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: scenarios.map((scenario) => scenario.endpoint),
    config: new AdapterConfig({}, { envDefaultOverrides: { COMPOSITE_TRANSPORT: true } }),
  })
  const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

  try {
    for (const scenario of scenarios) {
      const response = await testAdapter.request({
        endpoint: scenario.name,
        ...scenario.data,
      })
      t.is(response.statusCode, 400, scenario.name)
      t.true(response.body.includes(scenario.expectedMessage), scenario.name)
    }
  } finally {
    await testAdapter.api.close()
  }
})

test.serial('absent or disabled inversion keeps the raw response and cache key', async (t) => {
  const transport = new ForegroundPriceTransport()
  const adapter = buildPriceAdapter(transport)

  const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

  try {
    for (const inversion of [undefined, false]) {
      const response = await testAdapter.request({
        endpoint: 'test',
        base: 'BTC',
        quote: 'USD',
        ...(inversion === undefined ? {} : { inversion }),
      })
      t.is(response.statusCode, 200)
      t.is(response.json().result, 4)
    }

    const rawData = { base: 'BTC', quote: 'USD' }
    const rawKey = 'TEST-test-default_single_transport-{"base":"btc","quote":"usd"}'
    t.deepEqual(transport.receivedData, [rawData, rawData])
    t.deepEqual(transport.receivedCacheKeys, [rawKey, rawKey])
    t.deepEqual(transport.receivedRawCacheKeys, [undefined, undefined])
  } finally {
    await testAdapter.api.close()
  }
})

test.serial(
  'an inverse request keeps requestContext.data and the provider subscription raw',
  async (t) => {
    const transport = new CacheTestTransport()
    const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
    const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

    try {
      const rawResponse = await testAdapter.request({ endpoint: 'test', ...btcUsd })
      const inverseResponse = await testAdapter.request({
        endpoint: 'test',
        ...btcUsd,
        inversion: true,
      })

      t.is(rawResponse.statusCode, 504)
      t.is(inverseResponse.statusCode, 504)

      t.is(transport.requestContexts.length, 2)
      const [rawContext, inverseContext] = transport.requestContexts

      t.deepEqual(rawContext.data, { base: 'BTC', quote: 'USD' })
      t.deepEqual(inverseContext.data, { base: 'BTC', quote: 'USD' })
      t.false('inversion' in (inverseContext.data as Record<string, unknown>))

      // Raw and inverse share one provider subscription.
      const rawKey = transport.responseCache.getCacheKey(transport.name, btcUsd)
      t.is(rawContext.rawCacheKey, undefined)
      t.is(rawContext.cacheKey, rawKey)
      t.is(inverseContext.rawCacheKey, rawKey)
      t.is(inverseContext.cacheKey, toInverseCacheKey(rawKey))

      t.deepEqual(await transport.subscriptionSet.getAll(), [btcUsd])
      t.deepEqual(await transport.inverseSubscriptionSet.getAll(), [btcUsd])
    } finally {
      await testAdapter.api.close()
    }
  },
)

test.serial(
  'local subscription set holds one entry for a raw and an inverse request of the same pair',
  async (t) => {
    const transport = new CacheTestTransport()
    const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
    const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

    try {
      await testAdapter.request({ endpoint: 'test', ...btcUsd })
      await testAdapter.request({ endpoint: 'test', ...btcUsd, inversion: true })

      const entries = await transport.subscriptionSet.getAll()
      t.is(entries.length, 1)
      t.deepEqual(entries, [btcUsd])
    } finally {
      await testAdapter.api.close()
    }
  },
)

test.serial(
  'a transport on an endpoint without an inverter never reads the inverse subscription set',
  async (t) => {
    const transport = new CacheTestTransport()
    const adapter = new Adapter({
      name: 'TEST',
      endpoints: [
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport,
        }),
      ],
      config: new AdapterConfig({}, { envDefaultOverrides: cachePollingConfig }),
    })
    const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

    try {
      let getAllCalls = 0
      transport.inverseSubscriptionSet.getAll = () => {
        getAllCalls += 1
        return []
      }

      const response = await testAdapter.request({ endpoint: 'test', ...btcUsd })
      t.is(response.statusCode, 504)

      await transport.backgroundExecute({
        endpointName: 'test',
        inputParameters,
        adapterSettings: testAdapter.adapter.config.settings,
      })

      t.is(getAllCalls, 0)
      // The regular set is still read and still drives the provider.
      t.deepEqual(transport.providerEntries, [btcUsd])
    } finally {
      await testAdapter.api.close()
    }
  },
)

test.serial('an endpoint that inverts by default but has no inverter returns 400', async (t) => {
  const transport = new CacheTestTransport()
  const endpoint = new AdapterEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })
  endpoint.invertsByDefault = () => true

  const adapter = new Adapter({ name: 'TEST', endpoints: [endpoint] })
  const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

  try {
    const response = await testAdapter.request({ endpoint: 'test', ...btcUsd })
    t.is(response.statusCode, 400)
    t.true(response.body.includes('does not support inversion'))
  } finally {
    await testAdapter.api.close()
  }
})

test.serial('an inverse request calculates exactly one cache key', async (t) => {
  const transport = new QuietTransport()
  const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
  const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

  try {
    const inverseCount = await countCacheKeyCalculations(() =>
      testAdapter.request({ endpoint: 'test', ...btcUsd, inversion: true }),
    )
    const rawCount = await countCacheKeyCalculations(() =>
      testAdapter.request({ endpoint: 'test', ...btcUsd }),
    )

    t.is(inverseCount, 1)
    t.is(rawCount, 1)
  } finally {
    await testAdapter.api.close()
  }
})

test.serial('HTTP raw and inverse variants share one provider request', async (t) => {
  const dependencies = buildDependencies()
  let requestCount = 0
  let seenParams: Record<string, unknown>[] = []

  dependencies.requester = {
    request: async () => {
      requestCount += 1
      return {
        response: { data: { price: 4 } },
        timestamps: {
          providerDataRequestedUnixMs: 1,
          providerDataReceivedUnixMs: 2,
          providerIndicatedTimeUnixMs: 3,
        },
      }
    },
  } as unknown as AdapterDependencies['requester']

  const transport = new HttpTransport<HttpTestGenerics>({
    prepareRequests: (params) => {
      seenParams = params as unknown as Record<string, unknown>[]
      return {
        params,
        request: {
          url: '/price',
          method: 'GET',
        },
      }
    },
    parseResponse: (params, res) =>
      params.map((providerParams) => ({
        params: providerParams,
        response: {
          data: { result: res.data.price },
          result: res.data.price,
        },
      })),
  })

  const { rawParams, rawCached, inverseCached } = await runHttpInversion(dependencies, transport)

  t.is(requestCount, 1)
  t.deepEqual(seenParams, [rawParams])
  t.is(rawCached?.result, 4)
  t.is(inverseCached?.result, 0.25)
})

test.serial('provider errors fan out unchanged to raw and inverse cache keys', async (t) => {
  const dependencies = buildDependencies()

  dependencies.requester = {
    request: async () => {
      throw new AdapterRateLimitError({
        message: 'rate limited',
        statusCode: 429,
        msUntilNextExecution: 0,
      })
    },
  } as unknown as AdapterDependencies['requester']

  const transport = new HttpTransport<HttpTestGenerics>({
    prepareRequests: (params) => ({
      params,
      request: {
        url: '/price',
        method: 'GET',
      },
    }),
    parseResponse: () => {
      throw new Error('parseResponse should not be called for rate-limit errors')
    },
  })

  const { rawCached, inverseCached } = await runHttpInversion(dependencies, transport)

  t.is(rawCached?.statusCode, 429)
  t.is(inverseCached?.statusCode, 429)
  t.true(rawCached?.errorMessage?.includes('rate limited'))
})

test.serial(
  'a custom SubscriptionTransport that writes with responseCache.write serves inverse requests',
  async (t) => {
    const transport = new CacheBackedTransport()
    const adapter = buildPriceAdapter(transport, {
      envDefaultOverrides: cachePollingConfig,
    })
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

    const { rawResponse, inverseResponse, rawCached, inverseCached } =
      await runRequestLevelInversion(testAdapter, transport, btcUsd)

    t.is(rawResponse.statusCode, 200)
    t.is(rawResponse.json().result, 4)
    t.is(inverseResponse.statusCode, 200)
    t.is(inverseResponse.json().result, 0.25)
    t.is(rawCached?.result, 4)
    t.is(inverseCached?.result, 0.25)
  },
)

test.serial(
  'request-level LWBA inversion writes inverted and raw cache entries with swapped sizes',
  async (t) => {
    const transport = new CacheBackedQuoteTransport()
    const adapter = new Adapter({
      name: 'TEST',
      endpoints: [
        new LwbaEndpoint<QuoteGenerics>({
          name: 'test',
          inputParameters: quoteInputParameters,
          transport,
        }),
      ],
      config: new AdapterConfig({}, { envDefaultOverrides: cachePollingConfig }),
    })
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

    const params = {
      base: 'BTC',
      quote: 'USD',
    } as TypeFromDefinition<QuoteGenerics['Parameters']>

    const { rawResponse, inverseResponse, rawCached, inverseCached } =
      await runRequestLevelInversion(testAdapter, transport, params)

    t.is(rawResponse.statusCode, 200)
    t.is(inverseResponse.statusCode, 200)
    const inverse = inverseResponse.json().data
    t.true(Math.abs(inverse.bid - 1 / 1.2) < 1e-12)
    t.true(Math.abs(inverse.ask - 1) < 1e-12)
    t.true(Math.abs(inverse.mid - 1 / 1.1) < 1e-12)
    t.is(inverse.bidSize, 20)
    t.is(inverse.askSize, 10)

    const rawData = rawCached?.data
    const inverseData = inverseCached?.data
    t.truthy(rawData)
    t.truthy(inverseData)
    if (!rawData || !inverseData) {
      return
    }

    t.is(rawData.bid, 1)
    t.is(rawData.ask, 1.2)
    t.is((rawData as { bidSize?: number }).bidSize, 10)
    t.is((rawData as { askSize?: number }).askSize, 20)
    t.true(Math.abs(inverseData.bid - 1 / 1.2) < 1e-12)
    t.true(Math.abs(inverseData.ask - 1) < 1e-12)
    t.true(Math.abs(inverseData.mid - 1 / 1.1) < 1e-12)
    t.is((inverseData as { bidSize?: number }).bidSize, 20)
    t.is((inverseData as { askSize?: number }).askSize, 10)
  },
)

test.serial(
  'a first inverse request is seeded from the cached raw value after the next background cycle',
  async (t) => {
    const transport = new CacheTestTransport()
    const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)
    const adapterSettings = testAdapter.adapter.config.settings

    const rawKey = transport.responseCache.getCacheKey(transport.name, btcUsd)
    const inverseKey = toInverseCacheKey(rawKey)

    // A raw value is already cached, and the provider will not send anything new.
    await testAdapter.mockCache.set(
      rawKey,
      {
        data: { result: 4 },
        result: 4,
        statusCode: 200,
        timestamps,
      } as AdapterResponse<TestGenerics['Response']>,
      60_000,
    )
    t.is(await testAdapter.mockCache.get(inverseKey), undefined)

    await testAdapter.request({
      endpoint: 'test',
      ...btcUsd,
      inversion: true,
    })

    await transport.backgroundExecute({
      endpointName: 'test',
      inputParameters,
      adapterSettings,
    })

    // The CacheTestTransport never writes provider results, so the inverse entry can only come
    // from the seed of the cached raw value.
    const seeded = await testAdapter.mockCache.get(inverseKey)
    t.is((seeded as { result: number }).result, 0.25)
    t.is(((await testAdapter.mockCache.get(rawKey)) as { result: number }).result, 4)

    const servedFromCache = await testAdapter.request({
      endpoint: 'test',
      ...btcUsd,
      inversion: true,
    })
    t.is(servedFromCache.statusCode, 200)
    t.is(servedFromCache.json().result, 0.25)

    await testAdapter.api.close()
  },
)

test.serial(
  'inversion: true on an includes-inverse pair serves the inverse through the cached response path',
  async (t) => {
    const transport = new CacheBackedTransport()
    const adapter = buildPriceAdapter(transport, {
      includes: [
        {
          from: 'ETH',
          to: 'BTC',
          includes: [{ from: 'BTC', to: 'ETH', inverse: true }],
        },
      ],
      envDefaultOverrides: cachePollingConfig,
    })
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)
    const mockCache = testAdapter.mockCache

    const requestParams = { base: 'ETH', quote: 'BTC' } as TestParams
    const providerParams = { base: 'BTC', quote: 'ETH' } as TestParams

    const rawResponse = await testAdapter.request({ endpoint: 'test', ...requestParams })
    t.is(rawResponse.statusCode, 200)
    t.is(rawResponse.json().result, 0.25)

    // Drop the inverse entry: the second response has to come from a fresh cache write.
    await mockCache.delete(
      toInverseCacheKey(transport.responseCache.getCacheKey(transport.name, providerParams)),
    )

    const inverseResponse = await testAdapter.request({
      endpoint: 'test',
      ...requestParams,
      inversion: true,
    })

    // Sending the flag is the same as not sending it: includes already asks for the inverse.
    t.is(inverseResponse.statusCode, 200)
    t.is(inverseResponse.json().result, 0.25)
    t.is(inverseResponse.json().data.result, 0.25)

    t.deepEqual(transport.providerEntries, [providerParams])
    t.is((await getCached(mockCache, transport, providerParams))?.result, 4)
    t.is((await getCachedInverse(mockCache, transport, providerParams))?.result, 0.25)

    await testAdapter.api.close()
  },
)

type GroupingContext = {
  transport: CacheTestTransport
  dependencies: AdapterDependencies
}

const runGrouping = async (
  entries: TestParams[],
  inverseEntries: TestParams[] = [],
): Promise<GroupingContext> => {
  const transport = new CacheTestTransport()
  const { dependencies, adapterSettings } = await buildPriceEndpoint(transport)
  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => entries,
    get: () => undefined,
  }
  transport.inverseSubscriptionSet = {
    add: async () => {},
    getAll: () => inverseEntries,
    get: () => undefined,
  }
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })
  return { transport, dependencies }
}

test.serial('an inverse request only affects its own pair', async (t) => {
  const rawA = btcUsd
  const rawB = { base: 'ETH', quote: 'USD' } as TestParams
  const { transport, dependencies } = await runGrouping([rawA, rawB], [rawA])

  t.deepEqual(transport.providerEntries, [rawA, rawB])

  await produceResult(transport, rawA, 4)
  await produceResult(transport, rawB, 8)

  t.is((await getCached(dependencies.cache, transport, rawA))?.result, 4)
  t.is((await getCachedInverse(dependencies.cache, transport, rawA))?.result, 0.25)
  t.is((await getCached(dependencies.cache, transport, rawB))?.result, 8)
  t.is(await getCachedInverse(dependencies.cache, transport, rawB), undefined)
})

test.serial('ForexPriceEndpoint caches zero, NaN and Infinity results as 502', async (t) => {
  for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const transport = new CacheBackedTransport()
    transport.providerResponse = {
      data: { result: value },
      result: value,
      timestamps,
    }
    const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

    const response = await testAdapter.request({ endpoint: 'test', ...btcUsd })
    const cached = await getCached(testAdapter.mockCache, transport, btcUsd)

    t.is(response.statusCode, 502, String(value))
    t.is((cached as { statusCode: number }).statusCode, 502, String(value))
    t.true(
      (cached as { errorMessage: string }).errorMessage.includes(
        'Price result must be a finite, non-zero number',
      ),
      String(value),
    )

    await testAdapter.api.close()
  }
})

test.serial('ForexPriceEndpoint caches negative results as they are', async (t) => {
  const transport = new CacheBackedTransport()
  transport.providerResponse = {
    data: { result: -4 },
    result: -4,
    timestamps,
  }
  const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

  const response = await testAdapter.request({ endpoint: 'test', ...btcUsd })
  t.is(response.statusCode, 200)
  t.is(response.json().result, -4)
  t.is((await getCached(testAdapter.mockCache, transport, btcUsd))?.result, -4)

  await testAdapter.api.close()
})

test.serial('an LWBA result without mid caches the same 502 for raw and inverse', async (t) => {
  const transport = new CacheBackedQuoteTransport()
  transport.providerData = { bid: 1, ask: 1.2 } as LwbaResponseDataFields['Data']
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new LwbaEndpoint<QuoteGenerics>({
        name: 'test',
        inputParameters: quoteInputParameters,
        transport,
      }),
    ],
    config: new AdapterConfig({}, { envDefaultOverrides: cachePollingConfig }),
  })
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

  const params = { base: 'BTC', quote: 'USD' } as TypeFromDefinition<QuoteGenerics['Parameters']>
  await addSubscriptions(transport, [params], true)
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters: quoteInputParameters,
    adapterSettings: testAdapter.adapter.config.settings,
  })

  const raw = await getCached<QuoteGenerics>(testAdapter.mockCache, transport, params)
  const inverse = await getCachedInverse<QuoteGenerics>(testAdapter.mockCache, transport, params)

  t.is((raw as { statusCode: number }).statusCode, 502)
  t.is((inverse as { statusCode: number }).statusCode, 502)
  t.is(
    (inverse as { errorMessage: string }).errorMessage,
    (raw as { errorMessage: string }).errorMessage,
  )

  await testAdapter.api.close()
})

test.serial('a raw result whose inverse fails validation keeps the raw entry', async (t) => {
  const transport = new CacheBackedTransport()
  transport.providerResponse = {
    data: { result: Number.MIN_VALUE },
    result: Number.MIN_VALUE,
    timestamps,
  }
  const adapter = buildPriceAdapter(transport, { envDefaultOverrides: cachePollingConfig })
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

  await addSubscriptions(transport, [btcUsd], true)
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings: testAdapter.adapter.config.settings,
  })

  const raw = await getCached(testAdapter.mockCache, transport, btcUsd)
  const inverse = await getCachedInverse(testAdapter.mockCache, transport, btcUsd)

  t.is(raw?.result, Number.MIN_VALUE)
  t.is((inverse as { statusCode: number }).statusCode, 502)
  t.true(
    (inverse as { errorMessage: string }).errorMessage.includes(
      'Price result must be a finite, non-zero number',
    ),
  )

  await testAdapter.api.close()
})
