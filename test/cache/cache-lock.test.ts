import Redis from 'ioredis'
import { expose } from '../../src'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { RedisCache } from '../../src/cache'
import { AdapterConfig } from '../../src/config'
import { sleep } from '../../src/util'
import { MockCache, NopTransport, RedisMock } from '../../src/util/testing-utils'
import { test } from './helper'

// This test needs to use expose to wait for the cache lock promise in the basic EA flow
process.env['EA_PORT'] = '0'

test.serial(
  'An adapter with a duplicate name and no cache prefix should fail to acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 2000,
          CACHE_LOCK_RETRIES: 2,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
          CACHE_LOCK_DURATION: 2000,
          CACHE_LOCK_RETRIES: 2,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
    const cache = new RedisCache(redisClient, 10000) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      await expose(adapter, dependencies)
      await expose(adapter2, dependencies)

      t.fail('An error should have been thrown')
    } catch (error: unknown) {
      t.is(
        (error as Error).message,
        'The adapter failed to acquire a lock on the cache. Please check if you are running another instance of the adapter with the same name and cache prefix.',
      )
    }
  },
)

test.serial(
  'An adapter with a duplicate name but a unique cache prefix should acquire successfully acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
          CACHE_LOCK_DEFERRAL_MS: 0,
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
    const cache = new RedisCache(redisClient, 10000) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      await expose(adapter, dependencies)
      await expose(adapter2, dependencies)

      t.pass()
    } catch (error) {
      t.fail(`The following error should not have been thrown: ${error}`)
    }
  },
)

test.serial(
  'An adapter with a duplicate name but using a local cache should not attempt to acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
          CACHE_LOCK_DEFERRAL_MS: 0,
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
    let cache: RedisCache | MockCache = new RedisCache(redisClient, 10000) // Fake redis

    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    cache = new MockCache(100) // Fake local cache

    const dependencies2: Partial<AdapterDependencies> = {
      cache,
    }

    try {
      await expose(adapter, dependencies)
      await expose(adapter2, dependencies2)

      t.pass()
    } catch (error) {
      t.fail(`The following error should not have been thrown: ${error}`)
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
          CACHE_LOCK_DURATION: 1000,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
          CACHE_LOCK_DURATION: 100,
          CACHE_LOCK_RETRIES: 1,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
    const cache = new RedisCache(redisClient, 10000) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      await expose(adapter, dependencies)
      await expose(adapter2, dependencies)

      t.fail('An ExecutionError should have been thrown')
    } catch (error: unknown) {
      t.is(
        (error as Error).message,
        'The adapter failed to acquire a lock on the cache. Please check if you are running another instance of the adapter with the same name and cache prefix.',
      )
    }
  },
)

test.serial(
  'If an adapter shuts down, an adapter with the same key should successfully acquire a lock on retries',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 1000,
          CACHE_LOCK_DEFERRAL_MS: 0,
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
          CACHE_LOCK_DURATION: 1000,
          CACHE_LOCK_RETRIES: 10,
          CACHE_LOCK_DEFERRAL_MS: 0,
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

    const redisMock = new RedisMock()
    const redisClient = redisMock as unknown as Redis
    const cache = new RedisCache(redisClient, 10000) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      const api = await expose(adapter, dependencies)
      // Sleep for 1 second to allow the lock to be extended
      await sleep(1000)
      // Store the unique ID of the first adapter
      const firstAdapterID = redisMock.keys['TEST']
      // Shut down the first adapter
      await api?.close()
      // Start the second adapter before deleting the old key
      expose(adapter2, dependencies)
      // Sleep to allow for retries
      await sleep(500)
      // Delete the old key from the first adapter
      delete redisMock.keys['TEST']
      // Sleep to allow the second adapter to acquire the lock on retry and extend
      await sleep(500)
      const secondAdapterID = redisMock.keys['TEST']
      // Assert that the second adapters unique ID is stored in the redisMock
      t.is(
        redisMock.keys['TEST'] !== firstAdapterID && redisMock.keys['TEST'] === secondAdapterID,
        true,
      )
    } catch (error) {
      t.fail(`The following error should not have been thrown: ${error}`)
    }
  },
)
