import test from 'ava'
import {
  priceEndpointInputParametersDefinition,
  SingleValueInversionPolicy,
} from '../../../src/adapter'
import { InversionPolicy } from '../../../src/adapter/inverse'
import { AdapterDependencies } from '../../../src/adapter/types'
import { Cache, calculateFeedId } from '../../../src/cache'
import { SimpleResponseCache } from '../../../src/cache/response-cache/simple'
import { buildAdapterSettings } from '../../../src/config'
import { metrics } from '../../../src/metrics'
import {
  SingleNumberResultResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../../src/util'
import { LoggerFactoryProvider } from '../../../src/util/logger'
import { makeStub, MockCache } from '../../../src/util/testing-utils'
import { InputParameters } from '../../../src/validation'
import { TypeFromDefinition } from '../../../src/validation/input-params'

const inputParameters = new InputParameters(priceEndpointInputParametersDefinition)
const adapterSettings = buildAdapterSettings({})

type CacheGenerics = {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
}

type CacheParams = TypeFromDefinition<CacheGenerics['Parameters']>

const timestamps = {
  providerDataRequestedUnixMs: 0,
  providerDataReceivedUnixMs: 0,
  providerIndicatedTimeUnixMs: undefined,
}

const resolvedConfig = {
  enabled: true,
  policyId: 'single-value',
  policyVersion: 1,
}

const rawParams = { base: 'BTC', quote: 'USD' } as CacheParams
const inverseParams = {
  ...rawParams,
  inversion: resolvedConfig,
} as unknown as CacheParams

const providerResult = (
  params: CacheParams,
  value: number,
): TimestampedProviderResult<CacheGenerics> => ({
  params,
  response: {
    data: { result: value },
    result: value,
    timestamps,
  },
})

class CapturingSimpleResponseCache extends SimpleResponseCache<CacheGenerics> {
  captured?: TimestampedProviderResult<CacheGenerics>[]

  protected override async _write(
    transportName: string,
    results: TimestampedProviderResult<CacheGenerics>[],
  ): Promise<void> {
    this.captured = results
    return super._write(transportName, results)
  }
}

const buildCache = ({
  policy,
  resultValidator,
}: {
  policy?: InversionPolicy<CacheGenerics>
  resultValidator?: (
    result: TimestampedProviderResult<CacheGenerics>,
  ) => TimestampedProviderResult<CacheGenerics>
} = {}) => {
  const cache = new MockCache(adapterSettings.CACHE_MAX_ITEMS)
  const responseCache = new CapturingSimpleResponseCache({
    dependencies: { cache } as unknown as AdapterDependencies,
    adapterSettings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters,
  })
  responseCache.inversionPolicy = policy ?? new SingleValueInversionPolicy<CacheGenerics>()
  if (resultValidator) {
    responseCache.resultValidator = resultValidator
  }
  return { cache, responseCache }
}

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

test.serial('no inversion keeps the raw cache key and feed ID unchanged', (t) => {
  const { responseCache } = buildCache()

  t.is(responseCache.getCacheKey('test', rawParams), 'TEST-test-test-{"base":"btc","quote":"usd"}')
  t.is(calculateFeedId({ adapterSettings }, rawParams), '{"base":"btc","quote":"usd"}')
  t.not(
    responseCache.getCacheKey('test', inverseParams),
    responseCache.getCacheKey('test', rawParams),
  )
  t.not(
    calculateFeedId({ adapterSettings }, inverseParams),
    calculateFeedId({ adapterSettings }, rawParams),
  )
})

test.serial('no inversion writes the exact same array and result objects', async (t) => {
  const { responseCache } = buildCache()
  const results = [providerResult(rawParams, 4)]

  await responseCache.write('test', results)

  t.is(responseCache.captured, results)
  t.is(responseCache.captured?.[0], results[0])
})

test.serial('no inversion does not call the inversion policy', async (t) => {
  let calls = 0
  const basePolicy = new SingleValueInversionPolicy<CacheGenerics>()
  const policy: InversionPolicy<CacheGenerics> = {
    id: basePolicy.id,
    version: basePolicy.version,
    validateRequestConfig: (config) => basePolicy.validateRequestConfig(config),
    resolveConfig: (config) => basePolicy.resolveConfig(config),
    transform: (result) => {
      calls += 1
      return basePolicy.transform(result)
    },
  }
  const { responseCache } = buildCache({ policy })

  await responseCache.write('test', [providerResult(rawParams, 4)])

  t.is(calls, 0)
})

test.serial('mixed batches only invert configured results', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.write('test', [
    providerResult(rawParams, 4),
    providerResult(inverseParams, 4),
  ])

  t.is(responseCache.captured?.length, 2)
  t.is((responseCache.captured?.[0].response as { result: number }).result, 4)
  t.is((responseCache.captured?.[1].response as { result: number }).result, 0.25)

  const rawCached = await cache.get(responseCache.getCacheKey('test', rawParams))
  const inverseCached = await cache.get(responseCache.getCacheKey('test', inverseParams))
  t.is((rawCached as { result: number }).result, 4)
  t.is((inverseCached as { result: number }).result, 0.25)
})

test.serial('malformed policy metadata is written as a 502', async (t) => {
  const { responseCache } = buildCache()
  const malformedParams = {
    ...rawParams,
    inversion: { enabled: true },
  } as unknown as CacheParams

  await responseCache.write('test', [providerResult(malformedParams, 4)])

  const response = responseCache.captured?.[0].response
  t.true(response !== undefined && 'errorMessage' in response)
  if (response && 'errorMessage' in response) {
    const errorResponse = response as TimestampedProviderErrorResponse
    t.is(errorResponse.statusCode, 502)
    t.true(errorResponse.errorMessage.includes('missing or invalid'))
  }
})

test.serial('wrong policy version is written as a 502', async (t) => {
  const { responseCache } = buildCache()
  const wrongVersionParams = {
    ...rawParams,
    inversion: { ...resolvedConfig, policyVersion: 2 },
  } as unknown as CacheParams

  await responseCache.write('test', [providerResult(wrongVersionParams, 4)])

  const response = responseCache.captured?.[0].response
  t.true(response !== undefined && 'errorMessage' in response)
  if (response && 'errorMessage' in response) {
    const errorResponse = response as TimestampedProviderErrorResponse
    t.is(errorResponse.statusCode, 502)
    t.true(errorResponse.errorMessage.includes('does not match'))
  }
})

test.serial('a throwing policy is converted to a 502 and does not reject the write', async (t) => {
  const basePolicy = new SingleValueInversionPolicy<CacheGenerics>()
  const throwingPolicy: InversionPolicy<CacheGenerics> = {
    id: basePolicy.id,
    version: basePolicy.version,
    validateRequestConfig: (config) => basePolicy.validateRequestConfig(config),
    resolveConfig: (config) => basePolicy.resolveConfig(config),
    transform: () => {
      throw new Error('boom')
    },
  }
  const { responseCache } = buildCache({ policy: throwingPolicy })

  await t.notThrowsAsync(() => responseCache.write('test', [providerResult(inverseParams, 4)]))

  const response = responseCache.captured?.[0].response
  t.true(response !== undefined && 'errorMessage' in response)
  if (response && 'errorMessage' in response) {
    const errorResponse = response as TimestampedProviderErrorResponse
    t.is(errorResponse.statusCode, 502)
    t.true(errorResponse.errorMessage.includes('policy transform threw'))
  }
})

test.serial('resultValidator runs after inversion', async (t) => {
  const seen: number[] = []
  const { responseCache } = buildCache({
    resultValidator: (result) => {
      if (!('errorMessage' in result.response)) {
        seen.push(result.response.result as number)
      }
      return result
    },
  })

  await responseCache.write('test', [providerResult(inverseParams, 4)])

  t.deepEqual(seen, [0.25])
})

test.serial('writeTTL extends distinct raw and inverse cache keys', async (t) => {
  const ttlCalls: { key: string; ttl: number }[] = []
  const cache = {
    setTTL: async (key: string, ttl: number) => {
      ttlCalls.push({ key, ttl })
    },
  } as unknown as Cache
  const responseCache = new CapturingSimpleResponseCache({
    dependencies: { cache } as unknown as AdapterDependencies,
    adapterSettings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters,
  })

  await responseCache.writeTTL('test', [rawParams, inverseParams, rawParams], 123)

  t.deepEqual(ttlCalls, [
    { key: responseCache.getCacheKey('test', rawParams), ttl: 123 },
    { key: responseCache.getCacheKey('test', inverseParams), ttl: 123 },
    { key: responseCache.getCacheKey('test', rawParams), ttl: 123 },
  ])
  t.not(ttlCalls[0].key, ttlCalls[1].key)
})

test.serial('proxy-based result params do not throw when inversion is absent', async (t) => {
  const { responseCache } = buildCache()
  const stubParams = makeStub('params', { base: 'BTC', quote: 'USD' }) as CacheParams

  await t.notThrowsAsync(() => responseCache.write('test', [providerResult(stubParams, 4)]))
})
