import Redis from 'ioredis'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { CacheFactory, RedisCache } from '../../src/cache'
import { AdapterConfig } from '../../src/config'
import { NopTransport, RedisMock, TestAdapter } from '../../src/util/testing-utils'
import {
  BasicCacheSetterTransport,
  buildDiffResultAdapter,
  cacheTestInputParameters,
  cacheTests,
  test,
} from './helper'

test.beforeEach(async (t) => {
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

  const cache = new RedisCache(new RedisMock() as unknown as Redis, 10000) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  t.context.testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
})

cacheTests()

test.serial('redis client is initialized with options', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        CACHE_TYPE: 'redis',
        CACHE_REDIS_PORT: 6542,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'nowork',
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new RedisCache(new RedisMock() as unknown as Redis, 10000) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache

  const testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
  const client = testAdapter.adapter.dependencies.redisClient
  t.is(client instanceof Redis, true)
  t.is(client.options.port, 6542)
})

test.serial('redis client is initialized with url', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        CACHE_TYPE: 'redis',
        CACHE_REDIS_URL: 'redis://127.0.0.1:6543',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'nowork',
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new RedisCache(new RedisMock() as unknown as Redis, 10000) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache

  const testAdapter = await TestAdapter.start(adapter, t.context, dependencies)

  const client = testAdapter.adapter.dependencies.redisClient
  t.is(client instanceof Redis, true)
  t.is(client.options.port, 6543)
})

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

test.serial('Test getting value from redis when it does not exist in local cache', async (t) => {
  const cache = new RedisCache(new RedisMock() as unknown as Redis, 10000)
  await cache.set('k1', 'v1', 1000)
  await cache['localCache'].delete('k1')
  const value = await cache.get('k1')
  t.is(value, 'v1')
})

test.serial('Test cache key collision across adapters', async (t) => {
  const adapterA = buildDiffResultAdapter('TESTA')
  const adapterB = buildDiffResultAdapter('TESTB')

  const cache = new RedisCache(new RedisMock() as unknown as Redis, 10000) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  const testAdapterA = await TestAdapter.start(adapterA, t.context, dependencies)
  const testAdapterB = await TestAdapter.start(adapterB, t.context, dependencies)

  const data = {
    base: 'eth',
    factor: 123,
  }

  // Populate cache
  await testAdapterA.request(data)
  await testAdapterB.request(data)

  // Get results from cache to ensure the cache key is not returning the same response for both adapters
  const cacheResponseA = await testAdapterA.request(data)
  const cacheResponseB = await testAdapterB.request(data)

  t.is(cacheResponseA.statusCode, 200)
  t.is(cacheResponseB.statusCode, 200)
  t.not(cacheResponseA.json().result, cacheResponseB.json().result)
})
