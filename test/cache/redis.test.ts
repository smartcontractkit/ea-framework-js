import Redis from 'ioredis'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { CacheFactory, RedisCache } from '../../src/cache'
import { NopTransport, RedisMock, TestAdapter } from '../util'
import { BasicCacheSetterTransport, buildDiffResultAdapter, cacheTests, test } from './helper'

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {
          base: {
            type: 'string',
            required: true,
          },
          factor: {
            type: 'number',
            required: true,
          },
        },
        transport: new BasicCacheSetterTransport(),
      }),
      new AdapterEndpoint({
        name: 'nowork',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    envDefaultOverrides: {
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 3,
    },
  })

  const cache = new RedisCache(new RedisMock() as unknown as Redis) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  t.context.testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
})

cacheTests()

test.serial('running adapter throws on cache error', async (t) => {
  const data = {
    base: 'force-error', // Having this as a part of the cache key forces a cache error on RedisMock.set
    factor: 123,
  }

  const error = await t.context.testAdapter.request(data)
  t.is(error.statusCode, 500)
})

test.serial('Test cache factory success (redis)', async (t) => {
  try {
    CacheFactory.buildCache(
      { cacheType: 'redis', maxSizeForLocalCache: 10000 },
      new RedisMock() as unknown as Redis,
    )
    t.is(true, true)
  } catch (e: unknown) {
    t.is(true, false)
  }
})

test.serial('Test cache factory failure (redis)', async (t) => {
  try {
    CacheFactory.buildCache({ cacheType: 'redis', maxSizeForLocalCache: 10000 })
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test cache key collision across adapters', async (t) => {
  const adapterA = buildDiffResultAdapter('TESTA')
  const adapterB = buildDiffResultAdapter('TESTB')

  const cache = new RedisCache(new RedisMock() as unknown as Redis) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  const testAdapterA = await TestAdapter.start(adapterA, t.context, dependencies)
  const testAdapterB = await TestAdapter.start(adapterB, t.context, dependencies)

  const data = {
    base: 'eth',
  }

  // Populate cache
  await testAdapterA.request(data)
  await testAdapterB.request(data)

  // Get results from cache to ensure the cache key is not returning the same response for both adapters
  const cacheResponseA = await testAdapterA.request(data)
  const cacheResponseB = await testAdapterB.request(data)

  t.not(cacheResponseA.json().result, cacheResponseB.json().result)
})
