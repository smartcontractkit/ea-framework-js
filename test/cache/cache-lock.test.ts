import Redis from 'ioredis'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { RedisCache } from '../../src/cache'
import { AdapterConfig } from '../../src/config'
import { sleep } from '../../src/util'
import { MockCache, NopTransport, RedisMock, TestAdapter } from '../../src/util/testing-utils'
import { test } from './helper'

test.serial(
  'An adapter with the same name and no cache prefix should fail to acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
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

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    t.context.cache = cache

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await TestAdapter.start(adapter2, t.context, dependencies)

      t.fail('Resource locked error should have been thrown')
    } catch (error) {
      console.log('error is:', error)
      t.pass()
    }
  },
)

test.serial(
  'An adapter with the same name and a cache prefix should acquire successfully acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
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

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_PREFIX: 'PREFIX',
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    t.context.cache = cache

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await TestAdapter.start(adapter2, t.context, dependencies)

      t.pass()
    } catch (error) {
      t.fail('An error should not have been thrown')
      console.log('error is:', error)
    }
  },
)

test.serial(
  'An adapter with the same name but using a local cache should not attempt to acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
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

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'local',
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    let cache: RedisCache | MockCache = new RedisCache(redisClient) // Fake redis

    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    cache = new MockCache(100) // Fake local cache

    const dependencies2: Partial<AdapterDependencies> = {
      cache,
    }

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await TestAdapter.start(adapter2, t.context, dependencies2)

      t.pass()
    } catch (error) {
      t.fail('An error should not have been thrown')
      console.log('error is:', error)
    }
  },
)

test.serial(
  'A lock should automatically extend and prevent another adapter from acquiring a lock with the same key',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
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

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    t.context.cache = cache

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await sleep(5000)
      await TestAdapter.start(adapter2, t.context, dependencies)

      t.fail('An error should have been thrown')
    } catch (error) {
      t.pass()
      console.log('error is:', error)
    }
  },
)
