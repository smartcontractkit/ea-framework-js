import test from 'ava'
import { EventSource } from 'eventsource'
import Redis from 'ioredis'
import {
  Adapter,
  AdapterEndpoint,
  EndpointContext,
  LwbaEndpoint,
  LwbaResponseDataFields,
  PriceAdapter,
  PriceEndpoint,
  lwbaEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { AdapterConfig, buildAdapterSettings, EmptyCustomSettings } from '../../src/config'
import { metrics } from '../../src/metrics'
import { RateLimiterFactory, RateLimitingStrategy } from '../../src/rate-limiting/factory'
import { HttpTransport, TransportGenerics } from '../../src/transports'
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import {
  AdapterRequest,
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { MockCache, RedisMock, TestAdapter } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
import { AdapterRateLimitError } from '../../src/validation/error'
import { TypeFromDefinition } from '../../src/validation/input-params'

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

const inverseConfig = { enabled: true }

class ForegroundPriceTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
  receivedData: Record<string, unknown>[] = []
  receivedCacheKeys: string[] = []

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

class UnsupportedInversionTransport extends ForegroundPriceTransport {
  override supportsInversion = false
}

class CacheTestTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
  providerEntries: Record<string, unknown>[] = []

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(
    _context: EndpointContext<TestGenerics>,
    entries: TestParams[],
  ): Promise<void> {
    this.providerEntries = entries as Record<string, unknown>[]
  }

  async produce(result: TimestampedProviderResult<TestGenerics>): Promise<void> {
    await this.writeResults([result])
  }
}

class CacheBackedTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
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
        this.writeResults([{ params: entry, response: this.providerResponse }]),
      ),
    )
  }
}

class CacheBackedQuoteTransport extends SubscriptionTransport<QuoteGenerics> {
  supportsInversion = true

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(
    _context: EndpointContext<QuoteGenerics>,
    entries: TypeFromDefinition<QuoteGenerics['Parameters']>[],
  ): Promise<void> {
    await Promise.all(
      entries.map((entry) =>
        this.writeResults([
          {
            params: entry,
            response: {
              result: null,
              data: {
                bid: 1,
                ask: 1.2,
                mid: 1.1,
                bidSize: 10,
                askSize: 20,
              } as unknown as LwbaResponseDataFields['Data'],
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
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport,
      }),
    ],
    ...(options.includes ? { includes: options.includes } : {}),
    config: new AdapterConfig({}, { envDefaultOverrides: options.envDefaultOverrides ?? {} }),
  })

const withInversion = <T extends Record<string, unknown>>(params: T): T =>
  ({ ...params, inversion: inverseConfig }) as T
const btcUsd = { base: 'BTC', quote: 'USD' } as TestParams
const inversionRequest = withInversion(btcUsd)
const cachePollingConfig = {
  CACHE_POLLING_MAX_RETRIES: 20,
  CACHE_POLLING_SLEEP_MS: 10,
}

const buildPriceEndpoint = async <T extends TestGenerics>(
  transport: SubscriptionTransport<T>,
  dependencies = buildDependencies(),
  adapterSettings = buildAdapterSettings({}),
) => {
  const endpoint = new PriceEndpoint<T>({
    name: 'test',
    inputParameters: inputParameters as InputParameters<T['Parameters']>,
    transport,
  })
  await endpoint.initialize('TEST', dependencies, adapterSettings)
  return { dependencies, adapterSettings }
}

const addSubscriptions = async <T extends TestGenerics>(
  transport: SubscriptionTransport<T>,
  entries: TypeFromDefinition<T['Parameters']>[],
): Promise<void> => {
  await Promise.all(
    entries.map((entry) =>
      transport.subscriptionSet.add(
        entry,
        1000,
        transport.responseCache.getCacheKey(transport.name, entry),
      ),
    ),
  )
}

const getCached = async <T extends TransportGenerics>(
  cache: AdapterDependencies['cache'],
  transport: SubscriptionTransport<T>,
  params: TypeFromDefinition<T['Parameters']>,
): Promise<AdapterResponse<T['Response']> | undefined> =>
  (await cache.get(transport.responseCache.getCacheKey(transport.name, params))) as
    AdapterResponse<T['Response']> | undefined

const runHttpInversion = async (
  dependencies: AdapterDependencies,
  transport: HttpTransport<HttpTestGenerics>,
) => {
  const { adapterSettings } = await buildPriceEndpoint(transport, dependencies)
  const rawParams = btcUsd
  const inverseParams = withInversion(rawParams)
  await addSubscriptions(transport, [rawParams, inverseParams])
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  return {
    rawParams,
    rawCached: await getCached(dependencies.cache, transport, rawParams),
    inverseCached: await getCached(dependencies.cache, transport, inverseParams),
  }
}

const runGrouping = async (entries: TestParams[]) => {
  const transport = new CacheTestTransport()
  const { dependencies, adapterSettings } = await buildPriceEndpoint(transport)
  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => entries,
    get: () => undefined,
  }
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })
  return { transport, dependencies }
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
    inversion: inverseConfig,
  })

  return {
    rawResponse,
    inverseResponse,
    rawCached: await getCached(testAdapter.mockCache, transport, cacheParams),
    inverseCached: await getCached(testAdapter.mockCache, transport, withInversion(cacheParams)),
  }
}

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

test.serial('inversion config is rejected with 400 when unsupported', async (t) => {
  const scenarios: {
    name: string
    endpoint: AdapterEndpoint<TestGenerics>
    data: Record<string, unknown>
    expectedMessage: string
  }[] = [
    {
      name: 'no-transform',
      endpoint: new AdapterEndpoint<TestGenerics>({
        name: 'no-transform',
        inputParameters,
        transport: new CacheTestTransport(),
      }),
      data: inversionRequest,
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'unsupported-transport',
      endpoint: new PriceEndpoint<TestGenerics>({
        name: 'unsupported-transport',
        inputParameters,
        transport: new UnsupportedInversionTransport(),
      }),
      data: inversionRequest,
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'foreground',
      endpoint: new PriceEndpoint<TestGenerics>({
        name: 'foreground',
        inputParameters,
        transport: new ForegroundPriceTransport(),
      }),
      data: inversionRequest,
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'custom-cache-key',
      endpoint: new PriceEndpoint<TestGenerics>({
        name: 'custom-cache-key',
        inputParameters,
        transport: new CacheTestTransport(),
        cacheKeyGenerator: () => 'custom-key',
      }),
      data: inversionRequest,
      expectedMessage: 'custom cacheKeyGenerator',
    },
    {
      name: 'invalid-config',
      endpoint: new PriceEndpoint<TestGenerics>({
        name: 'invalid-config',
        inputParameters,
        transport: new ForegroundPriceTransport(),
      }),
      data: { base: 'BTC', quote: 'USD', inversion: { enabled: true, unexpected: true } },
      expectedMessage: 'unsupported keys',
    },
  ]

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: scenarios.map((scenario) => scenario.endpoint),
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

test.serial('existing inversion input parameters keep their prior behavior', async (t) => {
  const domainInputParameters = new InputParameters({
    base: { type: 'string', description: 'base', required: true },
    quote: { type: 'string', description: 'quote', required: true },
    inversion: { type: 'string', description: 'domain inversion mode' },
  } as unknown as typeof inputParameters.definition)
  const transport = new ForegroundPriceTransport()
  const endpoint = new AdapterEndpoint<TestGenerics>({
    name: 'test',
    inputParameters: domainInputParameters as unknown as typeof inputParameters,
    transport,
  })
  const adapter = new Adapter({ name: 'TEST', endpoints: [endpoint] })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const response = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: 'provider-specific-mode',
  })

  t.is(response.statusCode, 200)
  t.is(transport.receivedData[0]['inversion'], 'provider-specific-mode')
})

test.serial('absent or disabled inversion keeps the raw response and cache key', async (t) => {
  const transport = new ForegroundPriceTransport()
  const adapter = buildPriceAdapter(transport)

  const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

  try {
    for (const inversion of [undefined, { enabled: false }]) {
      const response = await testAdapter.request({
        endpoint: 'test',
        base: 'BTC',
        quote: 'USD',
        ...(inversion ? { inversion } : {}),
      })
      t.is(response.statusCode, 200)
      t.is(response.json().result, 4)
    }

    const rawData = { base: 'BTC', quote: 'USD' }
    const rawKey = 'TEST-test-default_single_transport-{"base":"btc","quote":"usd"}'
    t.deepEqual(transport.receivedData, [rawData, rawData])
    t.deepEqual(transport.receivedCacheKeys, [rawKey, rawKey])
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

test.serial(
  'mixed provider groups preserve raw-only feeds while fanning out variants',
  async (t) => {
    const rawA = btcUsd
    const inverseA = withInversion(rawA)
    const rawB = { base: 'ETH', quote: 'USD' } as TestParams
    const { transport, dependencies } = await runGrouping([rawA, inverseA, rawB])

    t.deepEqual(transport.providerEntries, [rawA, rawB])

    await produceResult(transport, rawA, 4)
    await produceResult(transport, rawB, 8)

    const rawACached = await getCached(dependencies.cache, transport, rawA)
    const inverseACached = await getCached(dependencies.cache, transport, inverseA)
    const rawBCached = await getCached(dependencies.cache, transport, rawB)

    t.is(rawACached?.result, 4)
    t.is(inverseACached?.result, 0.25)
    t.is(rawBCached?.result, 8)
  },
)

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
  'provider variants resolve inverse-first, duplicates and normalized params',
  async (t) => {
    const raw = btcUsd
    const inverse = withInversion(raw)
    const { transport, dependencies } = await runGrouping([inverse, raw, inverse])

    t.deepEqual(transport.providerEntries, [raw])

    await produceResult(transport, { base: 'btc', quote: 'usd' } as TestParams, 4)

    const rawCached = await getCached(dependencies.cache, transport, raw)
    const inverseCached = await getCached(dependencies.cache, transport, inverse)
    t.is(rawCached?.result, 4)
    t.is(inverseCached?.result, 0.25)
  },
)

test.serial('request-level inversion writes both the raw and inverse cache entries', async (t) => {
  const transport = new CacheBackedTransport()
  const adapter = buildPriceAdapter(transport, {
    envDefaultOverrides: cachePollingConfig,
  })
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

  const { rawResponse, inverseResponse, rawCached, inverseCached } = await runRequestLevelInversion(
    testAdapter,
    transport,
    btcUsd,
  )

  t.is(rawResponse.statusCode, 200)
  t.is(rawResponse.json().result, 4)
  t.is(inverseResponse.statusCode, 200)
  t.is(inverseResponse.json().result, 0.25)
  t.is(rawCached?.result, 4)
  t.is(inverseCached?.result, 0.25)
})

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
  'includes inversion cancels explicit inversion through the cached response path',
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

    const requestParams = { base: 'ETH', quote: 'BTC' } as TestParams
    const providerParams = { base: 'BTC', quote: 'ETH' } as TestParams
    const { rawResponse, inverseResponse, rawCached, inverseCached } =
      await runRequestLevelInversion(testAdapter, transport, requestParams, providerParams)

    t.is(rawResponse.statusCode, 200)
    t.is(rawResponse.json().result, 0.25)
    t.is(inverseResponse.statusCode, 200)
    t.is(inverseResponse.json().result, 4)
    t.is(inverseResponse.json().data.result, 4)

    t.deepEqual(transport.providerEntries, [providerParams])
    t.is(rawCached?.result, 4)
    t.is(inverseCached?.result, 0.25)
  },
)
