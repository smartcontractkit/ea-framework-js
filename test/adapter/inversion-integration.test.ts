import test from 'ava'
import { EventSource } from 'eventsource'
import Redis from 'ioredis'
import {
  Adapter,
  AdapterEndpoint,
  EndpointContext,
  InversionPolicy,
  LwbaEndpoint,
  LwbaResponseDataFields,
  PriceEndpoint,
  SingleValueInversionPolicy,
  lwbaEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { AdapterConfig, buildAdapterSettings, EmptyCustomSettings } from '../../src/config'
import { metrics } from '../../src/metrics'
import { RateLimiterFactory, RateLimitingStrategy } from '../../src/rate-limiting/factory'
import { HttpTransport, TransportRoutes } from '../../src/transports'
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import { CompositeTransport } from '../../src/transports/composite'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import {
  AdapterRequest,
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { makeStub, MockCache, RedisMock, TestAdapter } from '../../src/util/testing-utils'
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

const resolvedInversion = {
  enabled: true,
  policyId: 'single-value',
  policyVersion: 1,
}

const resolvedQuoteInversion = {
  enabled: true,
  policyId: 'lwba',
  policyVersion: 1,
}

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

class ThrowingValidatorPriceEndpoint extends PriceEndpoint<TestGenerics> {
  protected override resultValidator(): TimestampedProviderResult<TestGenerics> {
    throw new Error('validator boom')
  }
}

class CacheTestTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
  providerEntries: Record<string, unknown>[] = []

  get inversionSet() {
    return this.inversionSubscriptionSet
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
    await this.writeResults([result])
  }

  resolveVariants(
    results: TimestampedProviderResult<TestGenerics>[],
  ): TimestampedProviderResult<TestGenerics>[] {
    return this.variantResolver.resolve(results)
  }
}

class CacheBackedTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(
    _context: EndpointContext<TestGenerics>,
    entries: TestParams[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.writeResults([
        {
          params: entry,
          response: {
            data: { result: 4 },
            result: 4,
            timestamps,
          },
        },
      ])
    }
  }
}

class QuoteCacheTestTransport extends SubscriptionTransport<QuoteGenerics> {
  supportsInversion = true

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(): Promise<void> {
    return
  }

  async produce(result: TimestampedProviderResult<QuoteGenerics>): Promise<void> {
    await this.writeResults([result])
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
  metrics.initialize()
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
  t.is(transport.receivedData[0]['inversion'], undefined)
  t.is(
    transport.receivedCacheKeys[0],
    'TEST-test-default_single_transport-{"base":"btc","quote":"usd"}',
  )
})

test.serial('foreground inversion runs resultValidator', async (t) => {
  const endpoint = new ValidatingPriceEndpoint({
    name: 'test',
    inputParameters,
    transport: new ForegroundPriceTransport(),
  })
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [endpoint],
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
  t.deepEqual(endpoint.seen, [0.25])
})

test.serial('foreground validator throws are converted to 502', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new ThrowingValidatorPriceEndpoint({
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
    inversion: { enabled: true },
  })

  t.is(response.statusCode, 502)
  t.true(response.body.includes('result validator threw'))
  t.true(response.body.includes('validator boom'))
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

test.serial('foreground inversion isolates live request params from policy mutation', (t) => {
  const policy: InversionPolicy<TestGenerics> = {
    id: 'mutating',
    version: 1,
    transform: (result) => {
      const data = result.response.data as { result: number }
      data.result = 1 / data.result
      ;(result.response as { result: number }).result = data.result
      delete (result.params as unknown as Record<string, unknown>)['inversion']
      ;(result.params as unknown as Record<string, unknown>)['base'] = 'MUTATED'
      return result
    },
  }
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport: new ForegroundPriceTransport(),
    inversionPolicy: policy,
  })
  const data = {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true, policyId: 'mutating', policyVersion: 1 },
  } as unknown as TestParams
  const response: AdapterResponse<TestGenerics['Response']> = {
    data: { result: 4 },
    result: 4,
    statusCode: 200,
    timestamps,
  }

  const inverted = endpoint.applyInversionToResponse(response, data)

  t.is(inverted.statusCode, 200)
  t.is((inverted as { result: number }).result, 0.25)
  t.is((response as { result: number }).result, 4)
  t.is(data.base, 'BTC')
  t.truthy((data as unknown as Record<string, unknown>)['inversion'])
})

test.serial('foreground inversion rejects malformed policy results', (t) => {
  const policy: InversionPolicy<TestGenerics> = {
    id: 'invalid',
    version: 1,
    transform: () => undefined as unknown as TimestampedProviderResult<TestGenerics>,
  }
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport: new ForegroundPriceTransport(),
    inversionPolicy: policy,
  })
  const response: AdapterResponse<TestGenerics['Response']> = {
    data: { result: 4 },
    result: 4,
    statusCode: 200,
    timestamps,
  }

  const inverted = endpoint.applyInversionToResponse(response, {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true, policyId: 'invalid', policyVersion: 1 },
  } as unknown as TestParams)

  t.is(inverted.statusCode, 502)
  t.true(inverted.errorMessage?.includes('invalid result') === true)
})

test.serial('foreground inversion fails closed without a policy', (t) => {
  const endpoint = new AdapterEndpoint<TestGenerics>({
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

  const inverted = endpoint.applyInversionToResponse(response, {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  } as unknown as TestParams)

  t.is(inverted.statusCode, 502)
  t.true(inverted.errorMessage?.includes('no inversion policy') === true)
})

test.serial('foreground inversion fails closed when the response cannot be cloned', (t) => {
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport: new ForegroundPriceTransport(),
  })
  const response = {
    data: { result: 4 },
    result: 4,
    statusCode: 200,
    timestamps,
  } as AdapterResponse<TestGenerics['Response']> & { self?: unknown }
  response.self = response

  const inverted = endpoint.applyInversionToResponse(response, {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  } as unknown as TestParams)

  t.is(inverted.statusCode, 502)
  t.true(inverted.errorMessage?.includes('could not be cloned') === true)
})

test.serial('inversion config is rejected on an endpoint without a policy', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint<TestGenerics>({
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
    inversion: { enabled: true },
  })

  t.is(response.statusCode, 400)
  t.true(response.body.includes('does not support inversion'))
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
  t.deepEqual(transport.providerEntries, [raw])

  entries.splice(1)
  await transport.backgroundExecute(context)
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

  const disabledResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: false },
  })
  t.is(disabledResponse.statusCode, 200)
  t.is(disabledResponse.json().result, 4)

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

test.serial(
  'mixed provider groups preserve raw-only feeds while fanning out variants',
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

    const rawA = { base: 'BTC', quote: 'USD' } as TestParams
    const inverseA = {
      ...rawA,
      inversion: resolvedInversion,
    } as unknown as TestParams
    const rawB = { base: 'ETH', quote: 'USD' } as TestParams
    const entries = [rawA, inverseA, rawB]

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

    t.deepEqual(transport.providerEntries, [rawA, rawB])

    await transport.produce({
      params: rawA,
      response: {
        data: { result: 4 },
        result: 4,
        timestamps,
      },
    })
    await transport.produce({
      params: rawB,
      response: {
        data: { result: 8 },
        result: 8,
        timestamps,
      },
    })

    const rawACached = await dependencies.cache.get(
      transport.responseCache.getCacheKey(transport.name, rawA),
    )
    const inverseACached = await dependencies.cache.get(
      transport.responseCache.getCacheKey(transport.name, inverseA),
    )
    const rawBCached = await dependencies.cache.get(
      transport.responseCache.getCacheKey(transport.name, rawB),
    )

    t.is((rawACached as AdapterResponse<TestGenerics['Response']>).result, 4)
    t.is((inverseACached as AdapterResponse<TestGenerics['Response']>).result, 0.25)
    t.is((rawBCached as AdapterResponse<TestGenerics['Response']>).result, 8)
  },
)

test.serial('unmatched provider results do not write an inverse cache entry', async (t) => {
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

  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => [raw, inverse],
    get: () => undefined,
  }

  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  const unmatched = { ...raw, extra: 'unexpected' } as unknown as TestParams
  await transport.produce({
    params: unmatched,
    response: {
      data: { result: 4 },
      result: 4,
      timestamps,
    },
  })

  const unmatchedCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, unmatched),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverse),
  )

  t.is((unmatchedCached as AdapterResponse<TestGenerics['Response']>).result, 4)
  t.is(inverseCached, undefined)
})

test.serial('HTTP rate-limit results fan out to raw and inverse cache keys', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})

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

  const rawCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, rawParams),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverseParams),
  )

  t.is((rawCached as AdapterResponse<TestGenerics['Response']>).statusCode, 429)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).statusCode, 429)
  t.true(
    (
      rawCached as AdapterResponse<TestGenerics['Response']> as { errorMessage: string }
    ).errorMessage.includes('rate limited'),
  )
})

test.serial('LWBA cache writes validate the inverted quote', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new QuoteCacheTestTransport()
  const endpoint = new LwbaEndpoint<QuoteGenerics>({
    name: 'test',
    inputParameters: quoteInputParameters,
    transport,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const params = {
    base: 'BTC',
    quote: 'USD',
    inversion: resolvedQuoteInversion,
  } as unknown as TypeFromDefinition<QuoteGenerics['Parameters']>

  await transport.produce({
    params,
    response: {
      result: null,
      data: { bid: 1, ask: 1.2, mid: 1.1 },
      timestamps,
    },
  })

  const cached = (await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, params),
  )) as AdapterResponse<QuoteGenerics['Response']> | undefined
  t.truthy(cached)
  if (!cached || 'errorMessage' in cached) {
    t.fail('expected a successful cached quote')
    return
  }
  t.is(cached.statusCode, 200)
  t.true(Math.abs(cached.data.bid - 1 / 1.2) < 1e-12)
  t.true(Math.abs(cached.data.ask - 1) < 1e-12)
  t.true(Math.abs(cached.data.mid - 1 / 1.1) < 1e-12)

  const invalidParams = {
    ...params,
    base: 'ETH',
  } as unknown as TypeFromDefinition<QuoteGenerics['Parameters']>

  await transport.produce({
    params: invalidParams,
    response: {
      result: null,
      data: { bid: 1.2, ask: 1, mid: 1.1 },
      timestamps,
    },
  })

  const invalidCached = (await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, invalidParams),
  )) as AdapterResponse<QuoteGenerics['Response']> | undefined
  t.is(invalidCached?.statusCode, 502)
})

test.serial('inversion subscriptions use a policy-versioned set', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  const factory = dependencies.subscriptionSetFactory
  const buildSet = factory.buildSet.bind(factory)
  const suffixes: (string | undefined)[] = []
  factory.buildSet = ((endpointName: string, transportName: string, keySuffix?: string) => {
    suffixes.push(keySuffix)
    return buildSet(endpointName, transportName, keySuffix)
  }) as typeof factory.buildSet

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  t.true(suffixes.includes('inversion-single-value-v1'))
  t.truthy(transport.inversionSet)
  t.not(transport.subscriptionSet, transport.inversionSet)

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams

  const request = (data: TestParams, cacheKey: string) =>
    ({ requestContext: { data, cacheKey } }) as unknown as AdapterRequest<TestParams>

  await transport.registerRequest(request(raw, 'raw'), adapterSettings)
  await transport.registerRequest(request(inverse, 'inverse'), adapterSettings)

  t.deepEqual(await transport.subscriptionSet.getAll(), [raw])
  t.deepEqual(await transport.inversionSet?.getAll(), [inverse])
})

test.serial(
  'inversion subscription set is not read until an inverse request registers',
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

    const inversionSet = transport.inversionSet
    t.truthy(inversionSet)
    if (!inversionSet) {
      return
    }

    let reads = 0
    const getAll = inversionSet.getAll.bind(inversionSet)
    inversionSet.getAll = async () => {
      reads += 1
      return getAll()
    }

    await transport.backgroundExecute({
      endpointName: 'test',
      inputParameters,
      adapterSettings,
    })
    t.is(reads, 0)

    const inverse = {
      base: 'BTC',
      quote: 'USD',
      inversion: resolvedInversion,
    } as unknown as TestParams
    await transport.registerRequest(
      {
        requestContext: { data: inverse, cacheKey: 'inverse' },
      } as unknown as AdapterRequest<TestParams>,
      adapterSettings,
    )

    await transport.backgroundExecute({
      endpointName: 'test',
      inputParameters,
      adapterSettings,
    })
    t.is(reads, 1)
  },
)

test.serial('custom policy identity drives cache keys and subscription set', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const policy: InversionPolicy<TestGenerics> = {
    id: 'custom',
    version: 2,
    transform: (result) => ({
      params: result.params,
      response: {
        data: { result: 0.5 },
        result: 0.5,
        timestamps: result.response.timestamps,
      } as TimestampedProviderResult<TestGenerics>['response'],
    }),
  }
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
    inversionPolicy: policy,
  })

  const factory = dependencies.subscriptionSetFactory
  const buildSet = factory.buildSet.bind(factory)
  const suffixes: (string | undefined)[] = []
  factory.buildSet = ((endpointName: string, transportName: string, keySuffix?: string) => {
    suffixes.push(keySuffix)
    return buildSet(endpointName, transportName, keySuffix)
  }) as typeof factory.buildSet

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  t.true(suffixes.includes('inversion-custom-v2'))

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: { enabled: true, policyId: 'custom', policyVersion: 2 },
  } as unknown as TestParams

  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => [raw, inverse],
    get: () => undefined,
  }
  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  t.deepEqual(transport.providerEntries, [raw])

  await transport.produce({
    params: raw,
    response: {
      data: { result: 4 },
      result: 4,
      timestamps,
    },
  })

  const rawCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, raw),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverse),
  )
  t.is((rawCached as AdapterResponse<TestGenerics['Response']>).result, 4)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).result, 0.5)
})

test.serial('composite transports fan out inversion through the compare cache', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({
    overrides: { COMPOSITE_TRANSPORT: true },
  })
  const transportA = new CacheTestTransport()
  const transportB = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    enableCompositeTransport: true,
    transportRoutes: new TransportRoutes<TestGenerics>()
      .register('a', transportA)
      .register('b', transportB),
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const composite = endpoint.transportRoutes.get(
    'default_single_transport',
  ) as CompositeTransport<TestGenerics>
  t.truthy(composite)
  t.true(composite.supportsInversion)
  t.is(transportA.responseCache.inversionPolicy?.id, 'single-value')

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams
  const request = (data: TestParams, cacheKey: string) =>
    ({ requestContext: { data, cacheKey } }) as unknown as AdapterRequest<TestParams>

  await composite.registerRequest(request(raw, 'raw'), adapterSettings)
  await composite.registerRequest(request(inverse, 'inverse'), adapterSettings)
  await composite.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  await transportA.produce({
    params: raw,
    response: {
      data: { result: 4 },
      result: 4,
      timestamps: { ...timestamps, providerIndicatedTimeUnixMs: 1 },
    },
  })

  const rawCached = await dependencies.cache.get(
    composite.responseCache.getCacheKey(composite.name, raw),
  )
  const inverseCached = await dependencies.cache.get(
    composite.responseCache.getCacheKey(composite.name, inverse),
  )
  t.is((rawCached as AdapterResponse<TestGenerics['Response']>)?.result, 4)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>)?.result, 0.25)
})

test.serial('case-normalized provider results match inversion variants', async (t) => {
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

  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => [raw, inverse],
    get: () => undefined,
  }

  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  await transport.produce({
    params: { base: 'btc', quote: 'usd' } as TestParams,
    response: {
      data: { result: 4 },
      result: 4,
      timestamps,
    },
  })

  const rawCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, raw),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverse),
  )

  t.is((rawCached as AdapterResponse<TestGenerics['Response']>).result, 4)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).result, 0.25)
})

test.serial('inverse-first and duplicate variants resolve once per output', async (t) => {
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

  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => [inverse, raw, inverse],
    get: () => undefined,
  }

  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  t.deepEqual(transport.providerEntries, [raw])

  const resolved = transport.resolveVariants([
    {
      params: raw,
      response: {
        data: { result: 4 },
        result: 4,
        timestamps,
      },
    },
  ])
  t.is(resolved.length, 2)
  t.true(resolved.some((result) => result.params === raw))
  t.true(resolved.some((result) => result.params === inverse))

  await transport.produce({
    params: inverse,
    response: {
      data: { result: 4 },
      result: 4,
      timestamps,
    },
  })

  const rawCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, raw),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverse),
  )
  t.is((rawCached as AdapterResponse<TestGenerics['Response']>).result, 4)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).result, 0.25)
})

test.serial('custom mutating policy cannot corrupt the raw variant', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const basePolicy = new SingleValueInversionPolicy<TestGenerics>()
  const mutatingPolicy: InversionPolicy<TestGenerics> = {
    id: basePolicy.id,
    version: basePolicy.version,
    transform: (result) => {
      if (!result.response.errorMessage) {
        const data = result.response.data as { result: number }
        data.result = 1 / data.result
        ;(result.response as { result: number }).result = data.result
      }
      return result
    },
  }
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
    inversionPolicy: mutatingPolicy,
  })

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams

  transport.subscriptionSet = {
    add: async () => {},
    getAll: () => [raw, inverse],
    get: () => undefined,
  }

  await transport.backgroundExecute({
    endpointName: 'test',
    inputParameters,
    adapterSettings,
  })

  await transport.produce({
    params: raw,
    response: {
      data: { result: 4 },
      result: 4,
      timestamps,
    },
  })

  const rawCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, raw),
  )
  const inverseCached = await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, inverse),
  )
  t.is((rawCached as AdapterResponse<TestGenerics['Response']>).result, 4)
  t.is((inverseCached as AdapterResponse<TestGenerics['Response']>).result, 0.25)
})

test.serial('request-level inversion works through the full cache path', async (t) => {
  const transport = new CacheBackedTransport()
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport,
      }),
    ],
    config: new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_POLLING_MAX_RETRIES: 20,
          CACHE_POLLING_SLEEP_MS: 10,
        },
      },
    ),
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const inverseResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })
  t.is(inverseResponse.statusCode, 200)
  t.is(inverseResponse.json().result, 0.25)
  t.is(inverseResponse.json().data.result, 0.25)

  const rawResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
  })
  t.is(rawResponse.statusCode, 200)
  t.is(rawResponse.json().result, 4)
})

test.serial('inversion request metrics use the inverse feed ID', async (t) => {
  const previousMetricsEnabled = process.env['METRICS_ENABLED']
  const previousExperimentalMetricsEnabled = process.env['EXPERIMENTAL_METRICS_ENABLED']
  process.env['METRICS_ENABLED'] = 'true'
  process.env['EXPERIMENTAL_METRICS_ENABLED'] = 'true'
  t.teardown(() => {
    if (previousMetricsEnabled === undefined) {
      delete process.env['METRICS_ENABLED']
    } else {
      process.env['METRICS_ENABLED'] = previousMetricsEnabled
    }
    if (previousExperimentalMetricsEnabled === undefined) {
      delete process.env['EXPERIMENTAL_METRICS_ENABLED']
    } else {
      process.env['EXPERIMENTAL_METRICS_ENABLED'] = previousExperimentalMetricsEnabled
    }
  })

  const transport = new CacheBackedTransport()
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport,
      }),
    ],
    config: new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          METRICS_ENABLED: true,
          EXPERIMENTAL_METRICS_ENABLED: true,
          CACHE_POLLING_MAX_RETRIES: 20,
          CACHE_POLLING_SLEEP_MS: 10,
        },
      },
    ),
  })

  const context = t.context as TestContext
  context.testAdapter = await TestAdapter.start(adapter, context)

  const inverseResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })
  t.is(inverseResponse.statusCode, 200)
  const inverseFeedId = inverseResponse.json().meta?.metrics?.feedId as string
  t.true(inverseFeedId.includes('"inversion"'))
  t.true(inverseFeedId.includes('"policyId":"single-value"'))

  const rawResponse = await context.testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
  })
  t.is(rawResponse.statusCode, 200)
  const rawFeedId = rawResponse.json().meta?.metrics?.feedId as string
  t.false(rawFeedId.includes('inversion'))
})

test.serial('resolved inversion is attached after request transforms', async (t) => {
  const transport = new ForegroundPriceTransport()
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport,
        requestTransforms: [
          (req) => {
            const data = req.requestContext.data as Record<string, unknown>
            data['inversion'] = { enabled: false }
          },
        ],
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
  t.is(transport.receivedData[0]['inversion'], undefined)
})

test.serial('foreground policy throws are converted to 502', async (t) => {
  const basePolicy = new SingleValueInversionPolicy<TestGenerics>()
  const throwingPolicy: InversionPolicy<TestGenerics> = {
    id: basePolicy.id,
    version: basePolicy.version,
    transform: () => {
      throw new Error('boom')
    },
  }
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint<TestGenerics>({
        name: 'test',
        inputParameters,
        transport: new ForegroundPriceTransport(),
        inversionPolicy: throwingPolicy,
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

  t.is(response.statusCode, 502)
  t.true(response.body.includes('policy transform threw'))
  t.true(response.body.includes('boom'))
})

test.serial('endpoint rejects invalid inversion policy metadata', async (t) => {
  const basePolicy = new SingleValueInversionPolicy<TestGenerics>()
  const invalidPolicy: InversionPolicy<TestGenerics> = {
    id: 'invalid',
    version: Number.NaN,
    transform: (result) => basePolicy.transform(result),
  }
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport: new ForegroundPriceTransport(),
    inversionPolicy: invalidPolicy,
  })

  await t.throwsAsync(
    () => endpoint.initialize('TEST', buildDependencies(), buildAdapterSettings({})),
    { message: 'Endpoint "test" has an invalid inversion policy id/version' },
  )
})

test.serial('disabled inversion is a no-op on a policy-less endpoint', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint<TestGenerics>({
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
    inversion: { enabled: false },
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 4)
})
