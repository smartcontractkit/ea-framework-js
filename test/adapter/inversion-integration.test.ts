import test from 'ava'
import { EventSource } from 'eventsource'
import Redis from 'ioredis'
import {
  Adapter,
  AdapterEndpoint,
  EndpointContext,
  LwbaEndpoint,
  LwbaResponseDataFields,
  PriceEndpoint,
  lwbaEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { buildAdapterSettings, EmptyCustomSettings } from '../../src/config'
import { RateLimiterFactory, RateLimitingStrategy } from '../../src/rate-limiting/factory'
import { HttpTransport } from '../../src/transports'
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import {
  AdapterRequest,
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import {
  makeStub,
  MockCache,
  NopTransport,
  RedisMock,
  TestAdapter,
} from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
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

const resolvedInversion = {
  enabled: true,
  policyId: 'single-value',
  policyVersion: 1,
}

class ForegroundPriceTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
  receivedData: Record<string, unknown>[] = []

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

class ForegroundQuoteTransport extends SubscriptionTransport<QuoteGenerics> {
  supportsInversion = true

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(): Promise<void> {
    return
  }

  async foregroundExecute(): Promise<AdapterResponse<QuoteGenerics['Response']>> {
    return {
      result: null,
      data: { bid: 1, ask: 1.2, mid: 1.1 },
      statusCode: 200,
      timestamps,
    }
  }
}

class UnsupportedInversionTransport extends ForegroundPriceTransport {
  override supportsInversion = false
}

class ValidatingPriceEndpoint extends PriceEndpoint<TestGenerics> {
  seen: number[] = []

  protected override resultValidator(
    result: TimestampedProviderResult<TestGenerics>,
  ): TimestampedProviderResult<TestGenerics> {
    if (!('errorMessage' in result.response)) {
      this.seen.push(result.response.result as number)
    }
    return result
  }
}

class CacheTestTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
  providerEntries: Record<string, unknown>[] = []

  get variantsCount(): number {
    return this.providerVariants.size
  }

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
    await this.responseCache.write(this.name, this.resolveResultVariants([result]))
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

test.before(() => {
  LoggerFactoryProvider.set()
})

test.serial('foreground price response is inverted through the endpoint policy', async (t) => {
  const transport = new ForegroundPriceTransport()
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport,
      }),
    ],
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const response = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 0.25)
  t.is(response.json().data.result, 0.25)
  t.deepEqual(transport.receivedData[0]['inversion'], resolvedInversion)
})

test.serial('foreground LWBA response is inverted through the quote policy', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new LwbaEndpoint<QuoteGenerics>({
        name: 'test',
        inputParameters: quoteInputParameters,
        transport: new ForegroundQuoteTransport(),
      }),
    ],
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const response = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })

  t.is(response.statusCode, 200)
  t.is(response.json().data.bid, 1 / 1.2)
  t.is(response.json().data.ask, 1)
  t.is(response.json().data.mid, 1 / 1.1)
  t.false('midSource' in response.json().data)
})

test.serial(
  'foreground responses are returned unchanged when inversion is absent or disabled',
  (t) => {
    const endpoint = new PriceEndpoint<TestGenerics>({
      name: 'test',
      inputParameters,
      transport: new ForegroundPriceTransport(),
    })
    const response: AdapterResponse<TestGenerics['Response']> = {
      data: { result: 4 },
      result: 4,
      statusCode: 200,
      timestamps,
    }

    t.is(
      endpoint.applyInversionToResponse(response, { base: 'BTC', quote: 'USD' } as TestParams),
      response,
    )
    t.is(
      endpoint.applyInversionToResponse(response, {
        base: 'BTC',
        quote: 'USD',
        inversion: { enabled: false },
      } as unknown as TestParams),
      response,
    )
  },
)

test.serial('inversion config is rejected on an endpoint without a policy', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport: new NopTransport<TestGenerics>(),
      }),
    ],
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const response = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })

  t.is(response.statusCode, 400)
  t.true(response.body.includes('does not support inversion'))
})

test.serial(
  'raw and inverse variants share provider params and write distinct cache keys',
  async (t) => {
    const dependencies = buildDependencies()
    const adapterSettings = buildAdapterSettings({})
    const transport = new CacheTestTransport()
    const endpoint = new PriceEndpoint<TestGenerics>({
      name: 'test',
      inputParameters,
      transport,
    })

    await endpoint.initialize('TEST', dependencies, adapterSettings)

    const rawParams = { base: 'BTC', quote: 'USD' } as TestParams
    const inverseParams = {
      base: 'BTC',
      quote: 'USD',
      inversion: resolvedInversion,
    } as unknown as TestParams

    await transport.subscriptionSet.add(rawParams, 1000, 'raw-test')
    await transport.subscriptionSet.add(inverseParams, 1000, 'inverse-test')

    await transport.backgroundExecute({
      endpointName: 'test',
      inputParameters,
      adapterSettings,
    })

    t.deepEqual(transport.providerEntries, [rawParams])

    const providerResult: TimestampedProviderResult<TestGenerics> = {
      params: rawParams,
      response: {
        data: { result: 4 },
        result: 4,
        timestamps,
      },
    }
    await transport.produce(providerResult)

    const rawKey = transport.responseCache.getCacheKey(transport.name, rawParams)
    const inverseKey = transport.responseCache.getCacheKey(transport.name, inverseParams)

    const rawCached = await dependencies.cache.get(rawKey)
    const inverseCached = await dependencies.cache.get(inverseKey)

    t.is((rawCached as AdapterResponse<TestGenerics['Response']>).result, 4)
    t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).result, 0.25)
    t.not(rawKey, inverseKey)
  },
)

test.serial('result validator runs after inversion', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new ValidatingPriceEndpoint({
    name: 'test',
    inputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const inverseParams = {
    base: 'BTC',
    quote: 'USD',
    inversion: resolvedInversion,
  } as unknown as TestParams

  await transport.responseCache.write(transport.name, [
    {
      params: inverseParams,
      response: {
        data: { result: 4 },
        result: 4,
        timestamps,
      },
    },
  ])

  t.deepEqual(endpoint.seen, [0.25])
})

test.serial('inversion config is rejected on a transport without support', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport: new UnsupportedInversionTransport(),
      }),
    ],
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const response = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })

  t.is(response.statusCode, 400)
  t.true(response.body.includes('does not support inversion'))
})

test.serial('invalid inversion config is rejected', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport: new ForegroundPriceTransport(),
      }),
    ],
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const response = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true, unexpected: true },
  })

  t.is(response.statusCode, 400)
  t.true(response.body.includes('unsupported keys'))
})

test.serial('no inversion preserves subscription order and array identity', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const entries = [
    { base: 'BTC', quote: 'USD' },
    { base: 'ETH', quote: 'USD' },
    { base: 'BTC', quote: 'USD' },
  ] as TestParams[]

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

  t.is(transport.providerEntries, entries)
  t.deepEqual(transport.providerEntries, entries)
  t.is(transport.variantsCount, 0)
})

test.serial('proxy-based subscriptions do not throw when inversion is absent', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const entries = [makeStub('params', { base: 'BTC', quote: 'USD' })] as TestParams[]
  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => entries,
    get: () => undefined,
  }

  await t.notThrowsAsync(() =>
    transport.backgroundExecute({
      endpointName: 'test',
      inputParameters,
      adapterSettings,
    }),
  )
  t.is(transport.providerEntries, entries)
  t.is(transport.variantsCount, 0)
})

test.serial('disabled inversion is treated as no inversion', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const entries = [
    {
      base: 'BTC',
      quote: 'USD',
      inversion: { enabled: false },
    },
  ] as unknown as TestParams[]
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

  t.is(transport.providerEntries, entries)
  t.is(transport.variantsCount, 0)
})

test.serial('provider variants are cleared when inversion subscriptions expire', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams
  const entries: TestParams[] = [raw, inverse]

  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => entries,
    get: () => undefined,
  }

  const context = {
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  }

  await transport.backgroundExecute(context)
  t.is(transport.variantsCount, 1)
  t.deepEqual(transport.providerEntries, [raw])

  entries.splice(1)
  await transport.backgroundExecute(context)
  t.is(transport.variantsCount, 0)
  t.is(transport.providerEntries, entries)
})

test.serial('inversion is rejected with a custom cacheKeyGenerator', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport: new ForegroundPriceTransport(),
        cacheKeyGenerator: () => 'custom-key',
      }),
    ],
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const rawResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
  })
  t.is(rawResponse.statusCode, 200)

  const inverseResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })
  t.is(inverseResponse.statusCode, 400)
  t.true(inverseResponse.body.includes('custom cacheKeyGenerator'))
})

test.serial('HTTP raw and inverse variants share one provider request', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
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

  const endpoint = new PriceEndpoint<HttpTestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const rawParams = { base: 'BTC', quote: 'USD' } as TestParams
  const inverseParams = {
    ...rawParams,
    inversion: resolvedInversion,
  } as unknown as TestParams

  await transport.subscriptionSet.add(rawParams, 1000, 'raw-test')
  await transport.subscriptionSet.add(inverseParams, 1000, 'inverse-test')

  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  t.is(requestCount, 1)
  t.deepEqual(seenParams, [rawParams])

  const rawCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, rawParams),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverseParams),
  )

  t.is((rawCached as AdapterResponse<TestGenerics['Response']>).result, 4)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).result, 0.25)
})
