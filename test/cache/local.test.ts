import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { Cache, CacheFactory, LocalCache } from '../../src/cache'
import { AdapterConfig } from '../../src/config'
import { PartialAdapterResponse } from '../../src/util'
import { NopTransport, TestAdapter, runAllUntilTime } from '../../src/util/testing-utils'
import { BasicCacheSetterTransport, cacheTestInputParameters } from './helper'

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter
  cache: Cache
}>

test.beforeEach(async (t) => {
  t.context.clock = FakeTimers.install()
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        CACHE_POLLING_SLEEP_MS: 10,
        CACHE_POLLING_MAX_RETRIES: 3,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: cacheTestInputParameters,
        transport: new BasicCacheSetterTransport(),
      }),
      new AdapterEndpoint({
        name: 'nowork',
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new LocalCache(adapter.config.settings.CACHE_MAX_ITEMS)
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  t.context.testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
})

test.afterEach((t) => {
  t.context.clock.uninstall()
})

test.serial('Test cache factory success (redis)', async (t) => {
  try {
    CacheFactory.buildCache({ cacheType: 'local', maxSizeForLocalCache: 10000 })
    t.pass()
  } catch (e: unknown) {
    t.fail()
  }
})

test.serial('Test local cache max size', async (t) => {
  const cache = CacheFactory.buildCache({
    cacheType: 'local',
    maxSizeForLocalCache: 3,
  }) as LocalCache<number>
  await cache.set('1', 1, 10000)
  await cache.set('2', 2, 10000)
  await cache.set('3', 3, 10000)
  await cache.set('4', 4, 10000)

  const value1 = await cache.get('1')
  t.is(value1, undefined)
  const value2 = await cache.get('2')
  t.is(value2, 2)
  const value3 = await cache.get('3')
  t.is(value3, 3)
  const value4 = await cache.get('4')
  t.is(value4, 4)
})

test.serial('error responses are not overwriting successful cache entries', async (t) => {
  const cache = CacheFactory.buildCache({
    cacheType: 'local',
    maxSizeForLocalCache: 10000,
  }) as LocalCache<PartialAdapterResponse>
  const cacheKey = 'KEY'
  const successResponse = { result: 1, data: { result: 1 } }
  const errorResponse = { errorMessage: 'Error', statusCode: 500 }

  await cache.set(cacheKey, successResponse, 10000)
  const value1 = await cache.get(cacheKey)
  t.is(value1, successResponse)

  await cache.set(cacheKey, errorResponse, 10000)
  const value2 = await cache.get(cacheKey)
  t.is(value2, successResponse)

  await runAllUntilTime(t.context.clock, 11000)

  await cache.set(cacheKey, errorResponse, 10000)
  const value3 = await cache.get(cacheKey)
  t.is(value3, errorResponse)

  await runAllUntilTime(t.context.clock, 11000)

  const errorResponse2 = { errorMessage: 'Error2', statusCode: 500 }
  await cache.set(cacheKey, errorResponse, 10000)
  await cache.set(cacheKey, errorResponse2, 10000)
  const value4 = await cache.get(cacheKey)
  t.is(value4, errorResponse2)
})
