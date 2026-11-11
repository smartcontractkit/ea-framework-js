import test from 'ava'
import { EventSource } from 'eventsource'
import Redis from 'ioredis'
import { installTimers } from '../helper'
import {
  Adapter,
  AdapterEndpoint,
  EndpointContext,
  InversionPolicy,
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

const inversionRequestData = {
  base: 'BTC',
  quote: 'USD',
  inversion: resolvedInversion,
} as unknown as TestParams

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
}

class CacheBackedTransport extends SubscriptionTransport<TestGenerics> {
  supportsInversion = true
  providerEntries: Record<string, unknown>[] = []
  backgroundCalls = 0
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
    this.backgroundCalls += 1
    this.providerEntries = entries as Record<string, unknown>[]
    for (const entry of entries) {
      await this.writeResults([{ params: entry, response: this.providerResponse }])
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

class CacheBackedQuoteTransport extends SubscriptionTransport<QuoteGenerics> {
  supportsInversion = true

  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(
    _context: EndpointContext<QuoteGenerics>,
    entries: TypeFromDefinition<QuoteGenerics['Parameters']>[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.writeResults([
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
      ])
    }
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

const captureSubscriptionSetSuffixes = (factory: SubscriptionSetFactory) => {
  const suffixes: (string | undefined)[] = []
  const buildSet = factory.buildSet.bind(factory)
  factory.buildSet = ((endpointName: string, transportName: string, keySuffix?: string) => {
    suffixes.push(keySuffix)
    return buildSet(endpointName, transportName, keySuffix)
  }) as typeof factory.buildSet
  return suffixes
}

const requestFor = (data: TestParams, cacheKey: string) =>
  ({ requestContext: { data, cacheKey } }) as unknown as AdapterRequest<TestParams>

const foregroundResponse = (): AdapterResponse<TestGenerics['Response']> => ({
  data: { result: 4 },
  result: 4,
  statusCode: 200,
  timestamps,
})

const buildCacheBackedAdapter = (
  transport: CacheBackedTransport,
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

const inversionPolicy = (
  transform: InversionPolicy<TestGenerics>['transform'],
): InversionPolicy<TestGenerics> => ({
  id: 'single-value',
  version: 1,
  transform,
})

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

test.serial(
  'foreground inversion returns the inverse value and runs resultValidator',
  async (t) => {
    const transport = new ForegroundPriceTransport()
    const endpoint = new ValidatingPriceEndpoint({
      name: 'test',
      inputParameters,
      transport,
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
    t.is(response.json().data.result, 0.25)
    t.deepEqual(endpoint.seen, [0.25])
    t.is(transport.receivedData[0]['inversion'], undefined)
    t.is(
      transport.receivedCacheKeys[0],
      'TEST-test-default_single_transport-{"base":"btc","quote":"usd"}',
    )
  },
)

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

test.serial('foreground inversion failure modes return 502', (t) => {
  const scenarios: {
    name: string
    makeEndpoint: () => AdapterEndpoint<TestGenerics>
    makeResponse?: () => AdapterResponse<TestGenerics['Response']>
    expectedMessage: string
  }[] = [
    {
      name: 'no policy',
      makeEndpoint: () =>
        new AdapterEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
        }),
      expectedMessage: 'no inversion policy',
    },
    {
      name: 'malformed policy result',
      makeEndpoint: () =>
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
          inversionPolicy: inversionPolicy(
            () => undefined as unknown as TimestampedProviderResult<TestGenerics>,
          ),
        }),
      expectedMessage: 'invalid result',
    },
    {
      name: 'clone failure',
      makeEndpoint: () =>
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
        }),
      makeResponse: () => {
        const response = foregroundResponse() as AdapterResponse<TestGenerics['Response']> & {
          self?: unknown
        }
        response.self = response
        return response
      },
      expectedMessage: 'could not be cloned',
    },
    {
      name: 'policy throw',
      makeEndpoint: () =>
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
          inversionPolicy: inversionPolicy(() => {
            throw new Error('boom')
          }),
        }),
      expectedMessage: 'policy transform threw',
    },
    {
      name: 'validator throw',
      makeEndpoint: () =>
        new ThrowingValidatorPriceEndpoint({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
        }),
      expectedMessage: 'result validator threw',
    },
  ]

  for (const scenario of scenarios) {
    const endpoint = scenario.makeEndpoint()
    const inverted = endpoint.applyInversionToResponse(
      scenario.makeResponse?.() ?? foregroundResponse(),
      inversionRequestData,
    )

    t.is(inverted.statusCode, 502, scenario.name)
    t.true(inverted.errorMessage?.includes(scenario.expectedMessage) === true, scenario.name)
  }
})

test.serial('inversion config is rejected with 400 when unsupported', async (t) => {
  const scenarios: {
    name: string
    makeEndpoint: () => AdapterEndpoint<TestGenerics>
    data: Record<string, unknown>
    expectedMessage: string
  }[] = [
    {
      name: 'no policy',
      makeEndpoint: () =>
        new AdapterEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
        }),
      data: { base: 'BTC', quote: 'USD', inversion: { enabled: true } },
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'unsupported transport',
      makeEndpoint: () =>
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new UnsupportedInversionTransport(),
        }),
      data: { base: 'BTC', quote: 'USD', inversion: { enabled: true } },
      expectedMessage: 'does not support inversion',
    },
    {
      name: 'custom cacheKeyGenerator',
      makeEndpoint: () =>
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
          cacheKeyGenerator: () => 'custom-key',
        }),
      data: { base: 'BTC', quote: 'USD', inversion: { enabled: true } },
      expectedMessage: 'custom cacheKeyGenerator',
    },
    {
      name: 'invalid config',
      makeEndpoint: () =>
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport: new ForegroundPriceTransport(),
        }),
      data: { base: 'BTC', quote: 'USD', inversion: { enabled: true, unexpected: true } },
      expectedMessage: 'unsupported keys',
    },
  ]

  for (const scenario of scenarios) {
    const adapter = new Adapter({
      name: 'TEST',
      endpoints: [scenario.makeEndpoint()],
    })
    const testAdapter = await TestAdapter.start(adapter, t.context as TestContext)

    try {
      const response = await testAdapter.request({ endpoint: 'test', ...scenario.data })
      t.is(response.statusCode, 400, scenario.name)
      t.true(response.body.includes(scenario.expectedMessage), scenario.name)
    } finally {
      await testAdapter.api.close()
    }
  }
})

test.serial('absent or disabled inversion keeps the raw response and cache key', async (t) => {
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

test.serial('inversion subscriptions use a policy-versioned set', async (t) => {
  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  })

  const suffixes = captureSubscriptionSetSuffixes(dependencies.subscriptionSetFactory)

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  t.true(suffixes.includes('inversion-single-value-v1'))
  t.truthy(transport.inversionSet)
  t.not(transport.subscriptionSet, transport.inversionSet)

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams

  await transport.registerRequest(requestFor(raw, 'raw'), adapterSettings)
  await transport.registerRequest(requestFor(inverse, 'inverse'), adapterSettings)

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
    await transport.registerRequest(requestFor(inverse, 'inverse'), adapterSettings)

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

  const suffixes = captureSubscriptionSetSuffixes(dependencies.subscriptionSetFactory)

  await endpoint.initialize('TEST', dependencies, adapterSettings)

  t.true(suffixes.includes('inversion-custom-v2'))

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: { enabled: true, policyId: 'custom', policyVersion: 2 },
  } as unknown as TestParams

  await transport.registerRequest(requestFor(raw, 'raw'), adapterSettings)
  await transport.registerRequest(requestFor(inverse, 'inverse'), adapterSettings)

  t.deepEqual(await transport.subscriptionSet.getAll(), [raw])
  t.deepEqual(await transport.inversionSet?.getAll(), [inverse])

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

test.serial('provider errors fan out unchanged to raw and inverse cache keys', async (t) => {
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

test.serial('LWBA cache writes reject invalid inverted quotes', async (t) => {
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
      data: { bid: 1.2, ask: 1, mid: 1.1 },
      timestamps,
    },
  })

  const cached = (await dependencies.cache.get(
    transport.responseCache.getCacheKey(transport.name, params),
  )) as AdapterResponse<QuoteGenerics['Response']> | undefined
  t.is(cached?.statusCode, 502)
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

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams

  await composite.registerRequest(requestFor(raw, 'raw'), adapterSettings)
  await composite.registerRequest(requestFor(inverse, 'inverse'), adapterSettings)
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

test.serial(
  'provider variants resolve inverse-first, duplicates and normalized params',
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
  },
)

test.serial('expired inverse subscriptions stop inverse writes until re-registered', async (t) => {
  const clock = installTimers()
  t.teardown(() => clock.uninstall())

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  const transport = new CacheTestTransport()
  await new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport,
  }).initialize('TEST', dependencies, adapterSettings)

  const raw = { base: 'BTC', quote: 'USD' } as TestParams
  const inverse = {
    ...raw,
    inversion: resolvedInversion,
  } as unknown as TestParams
  const rawKey = () => transport.responseCache.getCacheKey(transport.name, raw)
  const inverseKey = () => transport.responseCache.getCacheKey(transport.name, inverse)
  const runBackground = () =>
    transport.backgroundExecute({ endpointName: 'test', inputParameters, adapterSettings })
  const produce = (value: number) =>
    transport.produce({
      params: raw,
      response: { data: { result: value }, result: value, timestamps },
    })
  const cachedResult = async (key: string) =>
    ((await dependencies.cache.get(key)) as AdapterResponse<TestGenerics['Response']>).result

  await transport.registerRequest(requestFor(inverse, 'inverse'), adapterSettings)
  await runBackground()
  await produce(4)
  t.is(await cachedResult(inverseKey()), 0.25)

  // The inverse subscription expires; keep the raw subscription alive so the
  // provider keeps producing values for the raw feed only.
  await clock.tickAsync(1001)
  await dependencies.cache.delete(inverseKey())
  await transport.registerRequest(requestFor(raw, 'raw'), adapterSettings)
  await runBackground()
  t.deepEqual(transport.providerEntries, [raw])

  await produce(8)
  t.is(await cachedResult(rawKey()), 8)
  t.is(await dependencies.cache.get(inverseKey()), undefined)

  // A new inverse request re-registers the variant and inversion resumes.
  await transport.registerRequest(requestFor(inverse, 'inverse'), adapterSettings)
  await runBackground()
  await produce(8)
  t.is(await cachedResult(inverseKey()), 0.125)
})

test.serial('request-level inversion writes both the raw and inverse cache entries', async (t) => {
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
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, context)

  const rawResponse = await testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
  })
  t.is(rawResponse.statusCode, 200)
  t.is(rawResponse.json().result, 4)

  const inverseResponse = await testAdapter.request({
    endpoint: 'test',
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  })
  t.is(inverseResponse.statusCode, 200)
  t.is(inverseResponse.json().result, 0.25)

  const rawParams = { base: 'BTC', quote: 'USD' } as TestParams
  const inverseParams = {
    ...rawParams,
    inversion: resolvedInversion,
  } as unknown as TestParams

  const rawCached = (await testAdapter.mockCache?.get(
    transport.responseCache.getCacheKey(transport.name, rawParams),
  )) as AdapterResponse<TestGenerics['Response']> | undefined
  const inverseCached = (await testAdapter.mockCache?.get(
    transport.responseCache.getCacheKey(transport.name, inverseParams),
  )) as AdapterResponse<TestGenerics['Response']> | undefined

  t.is(rawCached?.result, 4)
  t.is(inverseCached?.result, 0.25)
})

test.serial(
  'repeated inverse cache hits reuse the inverse value without more provider work',
  async (t) => {
    const clock = installTimers()
    t.teardown(() => clock.uninstall())

    const transport = new CacheBackedTransport()
    const adapter = buildCacheBackedAdapter(transport, {
      envDefaultOverrides: { CACHE_POLLING_MAX_RETRIES: 0 },
    })

    const testAdapter = await TestAdapter.startWithMockedCache(adapter, {
      clock,
      testAdapter: undefined as unknown as TestAdapter,
    })

    const requestData = {
      endpoint: 'test',
      base: 'BTC',
      quote: 'USD',
      inversion: { enabled: true },
    }
    await testAdapter.startBackgroundExecuteThenGetResponse(t, {
      requestData,
      expectedResponse: {
        data: { result: 0.25 },
        result: 0.25,
        statusCode: 200,
      },
    })

    const providerCalls = transport.backgroundCalls

    const inverseParams = {
      base: 'BTC',
      quote: 'USD',
      inversion: resolvedInversion,
    } as unknown as TestParams
    const cachedRequest = {
      body: {},
      requestContext: {
        endpointName: 'test',
        requestEndpointName: 'test',
        transportName: transport.name,
        cacheKey: transport.responseCache.getCacheKey(transport.name, inverseParams),
        data: inverseParams,
      },
    } as unknown as AdapterRequest<TestParams>

    // Cache hits do not advance the clock, so the background loop (the only
    // writer of provider values) makes no extra provider calls or writes.
    for (let i = 0; i < 2; i++) {
      const response = await adapter.handleRequest(cachedRequest, Promise.resolve())
      t.is((response as AdapterResponse<TestGenerics['Response']>).result, 0.25)
      t.is((response.data as { result: number }).result, 0.25)
    }

    t.is(transport.backgroundCalls, providerCalls)
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
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, context)

    const rawResponse = await testAdapter.request({
      endpoint: 'test',
      base: 'BTC',
      quote: 'USD',
    })
    t.is(rawResponse.statusCode, 200)

    const inverseResponse = await testAdapter.request({
      endpoint: 'test',
      base: 'BTC',
      quote: 'USD',
      inversion: { enabled: true },
    })
    t.is(inverseResponse.statusCode, 200)
    const inverse = inverseResponse.json().data
    t.true(Math.abs(inverse.bid - 1 / 1.2) < 1e-12)
    t.true(Math.abs(inverse.ask - 1) < 1e-12)
    t.true(Math.abs(inverse.mid - 1 / 1.1) < 1e-12)
    t.is(inverse.bidSize, 20)
    t.is(inverse.askSize, 10)

    const rawParams = {
      base: 'BTC',
      quote: 'USD',
    } as unknown as TypeFromDefinition<QuoteGenerics['Parameters']>
    const inverseParams = {
      ...rawParams,
      inversion: resolvedQuoteInversion,
    } as unknown as TypeFromDefinition<QuoteGenerics['Parameters']>

    const rawCached = (await testAdapter.mockCache?.get(
      transport.responseCache.getCacheKey(transport.name, rawParams),
    )) as AdapterResponse<QuoteGenerics['Response']> | undefined
    const inverseCached = (await testAdapter.mockCache?.get(
      transport.responseCache.getCacheKey(transport.name, inverseParams),
    )) as AdapterResponse<QuoteGenerics['Response']> | undefined

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
    const adapter = new PriceAdapter({
      name: 'TEST',
      endpoints: [
        new PriceEndpoint<TestGenerics>({
          name: 'test',
          inputParameters,
          transport,
        }),
      ],
      includes: [
        {
          from: 'ETH',
          to: 'BTC',
          includes: [{ from: 'BTC', to: 'ETH', inverse: true }],
        },
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
    const testAdapter = await TestAdapter.startWithMockedCache(adapter, context)

    const rawResponse = await testAdapter.request({
      endpoint: 'test',
      base: 'ETH',
      quote: 'BTC',
    })
    t.is(rawResponse.statusCode, 200)
    t.is(rawResponse.json().result, 0.25)

    const response = await testAdapter.request({
      endpoint: 'test',
      base: 'ETH',
      quote: 'BTC',
      inversion: { enabled: true },
    })

    t.is(response.statusCode, 200)
    t.is(response.json().result, 4)
    t.is(response.json().data.result, 4)

    t.deepEqual(transport.providerEntries, [{ base: 'BTC', quote: 'ETH' }])

    const providerParams = { base: 'BTC', quote: 'ETH' } as TestParams
    const inverseParams = {
      ...providerParams,
      inversion: resolvedInversion,
    } as unknown as TestParams

    const providerCached = (await testAdapter.mockCache?.get(
      transport.responseCache.getCacheKey(transport.name, providerParams),
    )) as AdapterResponse<TestGenerics['Response']> | undefined
    const inverseCached = (await testAdapter.mockCache?.get(
      transport.responseCache.getCacheKey(transport.name, inverseParams),
    )) as AdapterResponse<TestGenerics['Response']> | undefined

    t.is(providerCached?.result, 4)
    t.is(inverseCached?.result, 0.25)
  },
)

test.serial(
  'includes inversion returns provider errors unchanged through the cache path',
  async (t) => {
    const transport = new CacheBackedTransport()
    transport.providerResponse = {
      statusCode: 429,
      errorMessage: 'provider error',
      timestamps,
    }
    const adapter = buildCacheBackedAdapter(transport, {
      includes: [
        {
          from: 'ETH',
          to: 'BTC',
          includes: [{ from: 'BTC', to: 'ETH', inverse: true }],
        },
      ],
    })

    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context as TestContext)

    await testAdapter.request({
      endpoint: 'test',
      base: 'ETH',
      quote: 'BTC',
    })

    const inverseResponse = await testAdapter.request({
      endpoint: 'test',
      base: 'ETH',
      quote: 'BTC',
      inversion: { enabled: true },
    })
    t.is(inverseResponse.statusCode, 429)
    t.is(inverseResponse.json().errorMessage, 'provider error')
    t.is(inverseResponse.json().result, undefined)

    const inverseParams = {
      base: 'BTC',
      quote: 'ETH',
      inversion: resolvedInversion,
    } as unknown as TestParams
    const inverseCached = (await testAdapter.mockCache.get(
      transport.responseCache.getCacheKey(transport.name, inverseParams),
    )) as AdapterResponse<TestGenerics['Response']> | undefined

    t.is(inverseCached?.statusCode, 429)
    t.is(inverseCached?.result, undefined)
  },
)

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

test.serial('endpoint rejects invalid inversion policy metadata', async (t) => {
  const endpoint = new PriceEndpoint<TestGenerics>({
    name: 'test',
    inputParameters,
    transport: new ForegroundPriceTransport(),
    inversionPolicy: inversionPolicy((result) => result),
  })
  ;(endpoint.inversionPolicy as { version: number }).version = Number.NaN

  await t.throwsAsync(
    () => endpoint.initialize('TEST', buildDependencies(), buildAdapterSettings({})),
    { message: 'Endpoint "test" has an invalid inversion policy id/version' },
  )
})
