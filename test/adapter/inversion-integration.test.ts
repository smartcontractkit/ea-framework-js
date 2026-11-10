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
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import {
  AdapterRequest,
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { MockCache, NopTransport, RedisMock, TestAdapter } from '../../src/util/testing-utils'
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
  t.is(response.json().data.midSource, 'provider')
})

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
