import Redis from 'ioredis'
import { AddressInfo } from 'ws'
import { expose } from '../../src'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { CacheFactory, RedisCache } from '../../src/cache'
import { NopTransport, RedisMock } from '../util'
import { BasicCacheSetterTransport, buildDiffResultAdapter, cacheTests, test } from './helper'
import axios, { AxiosError } from 'axios'

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
  const api = await expose(adapter, dependencies)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

cacheTests()

test.serial('running adapter throws on cache error', async (t) => {
  const data = {
    base: 'force-error', // Having this as a part of the cache key forces a cache error on RedisMock.set
    factor: 123,
  }

  const error: AxiosError | undefined = await t.throwsAsync(
    axios.post(`${t.context.serverAddress}`, { data }),
  )
  t.is(error?.response?.status, 500)
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
  const apiA = await expose(adapterA, dependencies)
  if (!apiA) {
    throw 'Server did not start'
  }
  const addressA = `http://localhost:${(apiA.server.address() as AddressInfo).port}`

  const apiB = await expose(adapterB, dependencies)
  if (!apiB) {
    throw 'Server did not start'
  }
  const addressB = `http://localhost:${(apiB.server.address() as AddressInfo).port}`

  const data = {
    base: 'eth',
  }

  // Populate cache
  await axios.post(`${addressA}`, { data })
  await axios.post(`${addressB}`, { data })

  // Get results from cache to ensure the cache key is not returning the same response for both adapters
  const cacheResponseA = await axios.post(`${addressA}`, { data })
  const cacheResponseB = await axios.post(`${addressB}`, { data })

  t.not(cacheResponseA.data.result, cacheResponseB.data.result)
})
