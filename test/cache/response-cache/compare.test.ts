import test from 'ava'
import { LocalCache } from '../../../src/cache/local'
import { CompareResponseCache } from '../../../src/cache/response-cache/compare'
import { SimpleResponseCache } from '../../../src/cache/response-cache/simple'
import { AdapterConfig } from '../../../src/config'
import { LoggerFactoryProvider } from '../../../src/util/logger'
import { InputParameters } from '../../../src/validation'
import { cacheTestInputParameters, CacheTestTransportTypes } from '../helper'
import { AdapterDependencies } from '../../../src/adapter'

test.before(() => {
  LoggerFactoryProvider.set()
})

const buildSimpleCache = () => {
  const config = new AdapterConfig({})
  config.initialize()
  config.validate()

  return new SimpleResponseCache<CacheTestTransportTypes>({
    dependencies: { cache: new LocalCache(100) } as unknown as AdapterDependencies,
    adapterSettings: config.settings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters: new InputParameters(cacheTestInputParameters.definition),
  })
}

const providerResult = (params: { base: string; factor: number }, result: number) => ({
  params,
  response: {
    data: null,
    result,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  },
})

test('writes under CompareResponseCache transportName', async (t) => {
  const compareCache = new CompareResponseCache('merged', buildSimpleCache(), () => true)

  const params = { base: 'ETH', factor: 1 }

  await compareCache.write('ws', [providerResult(params, 42)])

  t.is(await compareCache.get(compareCache.getCacheKey('ws', params)), undefined)
  t.is((await compareCache.get(compareCache.getCacheKey('merged', params)))?.result, 42)
})

test('second write override first write', async (t) => {
  const compareCache = new CompareResponseCache('merged', buildSimpleCache(), () => true)

  const params = { base: 'ETH', factor: 1 }

  await compareCache.write('ws', [providerResult(params, 1), providerResult(params, 2)])

  t.is((await compareCache.get(compareCache.getCacheKey('merged', params)))?.result, 2)
})

test('shouldUpdate can block write when new value is not fresher than cache', async (t) => {
  const compareCache = new CompareResponseCache(
    'merged',
    buildSimpleCache(),
    (next, current) => (next?.result || 0) > (current?.result || 0),
  )

  const params = { base: 'ETH', factor: 1 }

  await compareCache.write('merged', [providerResult(params, 50)])
  t.is((await compareCache.get(compareCache.getCacheKey('merged', params)))?.result, 50)

  await compareCache.write('merged', [providerResult(params, 25)])
  t.is((await compareCache.get(compareCache.getCacheKey('merged', params)))?.result, 50)
  t.is(compareCache.localCache.size, 1)
})

test('shouldUpdate can block write without old value in localCache', async (t) => {
  const simpleCache = buildSimpleCache()

  const compareCache = new CompareResponseCache(
    'merged',
    simpleCache,
    (next, current) => (next?.result || 0) > (current?.result || 0),
  )

  const params = { base: 'ETH', factor: 1 }

  await simpleCache.write('merged', [providerResult(params, 100)])
  t.is((await compareCache.get(compareCache.getCacheKey('merged', params)))?.result, 100)

  await compareCache.write('merged', [providerResult(params, 25)])
  t.is((await compareCache.get(compareCache.getCacheKey('merged', params)))?.result, 100)
  t.is(compareCache.localCache.size, 0)
})
