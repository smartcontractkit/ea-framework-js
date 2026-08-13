import test from 'ava'
import {
  AdapterEndpoint,
  NumericResultEndpoint,
  PriceEndpointGenerics,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { ResponseCache } from '../../src/cache/response'
import { AdapterDependencies } from '../../src/adapter/types'
import { buildAdapterSettings, EmptyCustomSettings } from '../../src/config'
import {
  RateLimiterFactory,
  RateLimitingStrategy,
} from '../../src/rate-limiting/factory'
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import {
  AdapterResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { MockCache, RedisMock } from '../../src/util/testing-utils'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import { InputParameters } from '../../src/validation'
import Redis from 'ioredis'
import { EventSource } from 'eventsource'

const inputParameters = new InputParameters(priceEndpointInputParametersDefinition)

type TestEndpointGenerics = PriceEndpointGenerics & {
  Settings: EmptyCustomSettings
}

type ResultValidator<T extends TestEndpointGenerics> = (
  result: TimestampedProviderResult<T>,
) => TimestampedProviderResult<T>

test.before(() => {
  LoggerFactoryProvider.set()
})

class FakeResponseCache extends ResponseCache<TestEndpointGenerics> {
  writes: TimestampedProviderResult<TestEndpointGenerics>[] = []

  async write(
    transportName: string,
    results: TimestampedProviderResult<TestEndpointGenerics>[],
  ): Promise<void> {
    this.writes.push(...results)
  }

  async writeEntries(
    entries: {
      key: string
      value: AdapterResponse<TestEndpointGenerics['Response']>
    }[],
  ): Promise<void> {
    return
  }
}

class FakeTransport extends SubscriptionTransport<TestEndpointGenerics> {
  getSubscriptionTtlFromConfig(): number {
    return 1000
  }

  async backgroundHandler(): Promise<void> {
    return
  }

  async produceResult(result: TimestampedProviderResult<TestEndpointGenerics>): Promise<void> {
    const validated = this.resultValidator ? this.resultValidator(result) : result
    await this.responseCache.write(this.name, [validated])
  }
}

const buildDependencies = (): AdapterDependencies => {
  const adapterSettings = buildAdapterSettings({})
  return {
    cache: new MockCache(adapterSettings.CACHE_MAX_ITEMS),
    rateLimiter: RateLimiterFactory.buildRateLimiter(
      RateLimitingStrategy.FIXED_INTERVAL,
    ).initialize([], undefined),
    subscriptionSetFactory: new SubscriptionSetFactory(
      adapterSettings,
      'TEST',
      new RedisMock() as unknown as Redis,
    ),
    redisClient: new RedisMock() as unknown as Redis,
    eventSource: EventSource as unknown as typeof EventSource,
    requester: {} as AdapterDependencies['requester'],
    loggerFactory: LoggerFactoryProvider.get(),
  }
}

const makeResult = (value: number): TimestampedProviderResult<TestEndpointGenerics> => ({
  params: { base: 'BTC', quote: 'USD' },
  response: {
    data: { result: value },
    result: value,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  },
})

const getResultValidator = <T extends TestEndpointGenerics>(
  endpoint: AdapterEndpoint<T>,
): ResultValidator<T> | undefined =>
  (endpoint as unknown as { resultValidator?: ResultValidator<T> }).resultValidator

test('NumericResultEndpoint accepts a valid number', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  await transport.produceResult(makeResult(123.45))

  t.is(fakeCache.writes.length, 1)
  t.is((fakeCache.writes[0].response as { result: number }).result, 123.45)
})

test('NumericResultEndpoint rejects null result', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  const result = makeResult(null as unknown as number)
  await transport.produceResult(result)

  t.is(fakeCache.writes.length, 1)
  const written = fakeCache.writes[0].response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
  t.true(written.errorMessage.includes('Invalid numeric result'))
})

test('NumericResultEndpoint rejects NaN result', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  await transport.produceResult(makeResult(NaN))

  t.is(fakeCache.writes.length, 1)
  const written = fakeCache.writes[0].response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
})

test('NumericResultEndpoint rejects non-finite result', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  await transport.produceResult(makeResult(Infinity))

  t.is(fakeCache.writes.length, 1)
  const written = fakeCache.writes[0].response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
})

test('NumericResultEndpoint accepts 0 by default', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  await transport.produceResult(makeResult(0))

  t.is(fakeCache.writes.length, 1)
  t.is((fakeCache.writes[0].response as { result: number }).result, 0)
})

test('NumericResultEndpoint rejects 0 when acceptZeroValue is false', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
    acceptZeroValue: false,
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  await transport.produceResult(makeResult(0))

  t.is(fakeCache.writes.length, 1)
  const written = fakeCache.writes[0].response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
})

test('NumericResultEndpoint passes through existing error responses', async (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  const fakeCache = new FakeResponseCache({
    inputParameters: endpoint.inputParameters,
    adapterName: 'TEST',
    endpointName: 'test',
    adapterSettings,
    dependencies,
  })
  transport.responseCache = fakeCache

  const errorResult: TimestampedProviderResult<TestEndpointGenerics> = {
    params: { base: 'BTC', quote: 'USD' },
    response: {
      statusCode: 502,
      errorMessage: 'Existing error',
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    },
  }

  await transport.produceResult(errorResult)

  t.is(fakeCache.writes.length, 1)
  const written = fakeCache.writes[0].response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
  t.is(written.errorMessage, 'Existing error')
})

test('plain AdapterEndpoint is unaffected by NumericResultEndpoint logic', (t) => {
  const endpoint = new AdapterEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  t.is(getResultValidator(endpoint), undefined)
})

test('NumericResultEndpoint resultValidator rejects invalid values directly', (t) => {
  const endpoint = new NumericResultEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const validator = getResultValidator(endpoint)
  t.truthy(validator)

  const result = validator!(makeResult(NaN))
  t.is((result.response as TimestampedProviderErrorResponse).statusCode, 502)
})
