import test from 'ava'
import { AdapterEndpoint, EndpointGenerics } from '../../src/adapter'
import { ResponseCache } from '../../src/cache/response'
import { AdapterDependencies } from '../../src/adapter/types'
import { buildAdapterSettings, EmptyCustomSettings } from '../../src/config'
import { RateLimiterFactory, RateLimitingStrategy } from '../../src/rate-limiting/factory'
import { SubscriptionTransport } from '../../src/transports/abstract/subscription'
import { SubscriptionSetFactory } from '../../src/util/subscription-set/subscription-set'
import {
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { MockCache, RedisMock } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
import Redis from 'ioredis'
import { EventSource } from 'eventsource'

const inputParameters = new InputParameters({
  base: {
    type: 'string',
    description: 'base',
    required: true,
  },
  quote: {
    type: 'string',
    description: 'quote',
    required: true,
  },
})

type TestEndpointGenerics = EndpointGenerics & {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: EmptyCustomSettings
}

test.before(() => {
  LoggerFactoryProvider.set()
})

class FakeResponseCache extends ResponseCache<TestEndpointGenerics> {
  writes: TimestampedProviderResult<TestEndpointGenerics>[] = []

  protected async _write(
    _transportName: string,
    results: TimestampedProviderResult<TestEndpointGenerics>[],
  ): Promise<void> {
    this.writes.push(...results)
  }

  async writeEntries(
    _entries: {
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
    await this.responseCache.write(this.name, [result])
  }
}

const validateResult = (
  result: TimestampedProviderResult<TestEndpointGenerics>,
): TimestampedProviderResult<TestEndpointGenerics> => {
  if ('errorMessage' in result.response) {
    return result
  }

  const value = result.response.result
  if (!Number.isFinite(value)) {
    return {
      params: result.params,
      response: {
        statusCode: 502,
        errorMessage: `Invalid result: ${value}`,
        timestamps: result.response.timestamps,
      },
    }
  }

  return result
}

class ValidatingEndpoint extends AdapterEndpoint<TestEndpointGenerics> {
  protected override resultValidator = validateResult
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

test('resultValidator is wired from endpoint to response cache', async (t) => {
  const endpoint = new ValidatingEndpoint({
    name: 'test',
    inputParameters,
    transport: new FakeTransport(),
  })

  const dependencies = buildDependencies()
  const adapterSettings = buildAdapterSettings({})
  await endpoint.initialize('TEST', dependencies, adapterSettings)

  const transport = endpoint.transportRoutes.get('default_single_transport') as FakeTransport
  t.truthy(transport.responseCache.resultValidator)
})

test('resultValidator transforms invalid results before cache write', async (t) => {
  const endpoint = new ValidatingEndpoint({
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
  fakeCache.resultValidator = validateResult
  transport.responseCache = fakeCache

  const badResult: TimestampedProviderResult<TestEndpointGenerics> = {
    params: { base: 'BTC', quote: 'USD' },
    response: {
      data: { result: NaN },
      result: NaN,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    },
  }

  await transport.produceResult(badResult)

  t.is(fakeCache.writes.length, 1)
  const written = fakeCache.writes[0].response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
  t.is(written.errorMessage, 'Invalid result: NaN')

  const goodResult: TimestampedProviderResult<TestEndpointGenerics> = {
    params: { base: 'BTC', quote: 'USD' },
    response: {
      data: { result: 123 },
      result: 123,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    },
  }

  await transport.produceResult(goodResult)

  t.is(fakeCache.writes.length, 2)
  const goodWritten = fakeCache.writes[1].response as { result: number }
  t.is(goodWritten.result, 123)
})
