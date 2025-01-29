import EventEmitter from 'events'
import Redis, { Result } from 'ioredis'
import Redlock from 'redlock'
import { CMD_SENT_STATUS, recordRedisCommandMetric } from '../metrics'
import { AdapterResponse, censorLogs, makeLogger, sleep } from '../util'
import { Cache, CacheEntry, LocalCache } from './index'
import { CacheTypes, cacheMetricsLabel, cacheSet } from './metrics'

declare module 'ioredis' {
  interface RedisCommander<Context> {
    setExternalAdapterResponse(key: string, value: string, ttl: number): Result<string, Context>
  }
}

const logger = makeLogger('RedisCache')

/**
 * Redis implementation of a Cache. It uses a simple js Object, storing entries with both
 * a value and an expiration timestamp. Expired entries are deleted on reads (i.e. no background gc/upkeep).
 *
 * @typeParam T - the type for the entries' values
 */
export class RedisCache<T = unknown> implements Cache<T> {
  type = CacheTypes.Redis
  private localCache: LocalCache

  constructor(
    private client: Redis,
    localCacheCapacity: number,
  ) {
    // Local cache is used for fast reads. Every SET to redis also sets the value to local cache.
    this.localCache = new LocalCache(localCacheCapacity)
    this.defineCommands()
  }

  defineCommands() {
    // Load custom lua script 'setExternalAdapterResponse' to redis that will skip overwriting successful cache response if the new value is error response
    const lua = `local key = KEYS[1]
      local value = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local json_value = cjson.decode(value)
      local key_exists = redis.call('EXISTS', key)
      if json_value.errorMessage and key_exists == 1 then
        local existing_json_value = cjson.decode(redis.call('GET', key))
          if existing_json_value.errorMessage then
            return redis.call('SET', key, value, 'PX', ttl)
          else
            return nil
          end
      else
        return redis.call('SET', key, value, 'PX', ttl)
      end`
    this.client.defineCommand('setExternalAdapterResponse', { lua, numberOfKeys: 1 })
  }

  async get(key: string): Promise<Readonly<T> | undefined> {
    censorLogs(() => logger.trace(`Getting key ${key}`))
    // Try to find the entry in the local cache first
    const localCacheValue = await this.localCache.get(key)
    if (localCacheValue) {
      return localCacheValue as T
    }
    // If the entry doesn't exist in the local cache, search it in redis.
    // This is needed since there is a case when EA restarts with cached values in redis.
    // Those cached values are not in local cache after restart, so we search in redis.
    const value = await this.client.get(key)

    // Record get command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'get')

    if (!value) {
      censorLogs(() =>
        logger.debug(`No entry in redis cache for key "${key}", returning undefined`),
      )
      return undefined
    }

    return JSON.parse(value) as T
  }

  async delete(key: string): Promise<void> {
    censorLogs(() => logger.trace(`Deleting key ${key}`))
    await this.client.del(key)
    this.localCache.delete(key)

    // Record delete command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'delete')
  }

  async set(key: string, value: Readonly<T>, ttl: number): Promise<void> {
    censorLogs(() => logger.trace(`Setting key ${key}`))
    await this.client.setExternalAdapterResponse(key, JSON.stringify(value), ttl)
    this.localCache.set(key, value, ttl)

    // Record set command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'setExternalAdapterResponse')
  }

  async setMany(entries: CacheEntry<Readonly<T>>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys`)
    // Unfortunately, there's no ttl for mset
    let chain = this.client.multi()

    for (const entry of entries) {
      chain = chain.setExternalAdapterResponse(entry.key, JSON.stringify(entry.value), ttl)
      this.localCache.set(entry.key, entry.value, ttl)
    }

    await chain.exec()

    // Record exec command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'exec')
  }

  async setTTL(key: string, ttl: number): Promise<void> {
    censorLogs(() => logger.trace(`Updating key ${key} with a new ttl ${ttl}`))
    await this.client.pexpire(key, ttl)
    this.localCache.setTTL(key, ttl)

    // Record set command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'setTTL')
  }

  async lock(
    key: string,
    cacheLockDuration: number,
    retryCount: number,
    shutdownNotifier: EventEmitter,
  ): Promise<void> {
    const start = Date.now()
    const log = (msg: string) => `[${(Date.now() - start) / 1000}]: ${msg}`

    const redlock = new Redlock([this.client], {
      // Implementing retries manually due to redlock bug in edge cases
      retryCount: 0,
    })

    // Close redis to allow adapter to shutdown if lock is not acquired
    shutdownNotifier.on('onClose', () => {
      this.client.quit()
    })

    const acquireLock = async () => {
      // For the number of retries, try to acquire the lock
      for (let retryAttempt = 1; retryAttempt <= retryCount; retryAttempt++) {
        try {
          const lock = await redlock.acquire([key], cacheLockDuration)
          logger.info(
            log(
              `Acquired lock: ${lock.value}, key: ${key}, TTL: ${
                (lock.expiration - Date.now()) / 1000
              }`,
            ),
          )
          // If successful, return lock and break loop
          return lock
        } catch (error) {
          logger.error(`Failed to acquire lock on attempt ${retryAttempt}/${retryCount}: ${error}`)
          // On error, sleep before retrying again
          await sleep(cacheLockDuration / retryCount)
        }
      }
      // If the last retry fails, throw error
      throw new Error(
        'The adapter failed to acquire a lock on the cache. Please check if you are running another instance of the adapter with the same name and cache prefix.',
      )
    }

    let lock = await acquireLock()

    const extendLock = async () => {
      if (lock) {
        // eslint-disable-next-line require-atomic-updates
        lock = await lock.extend(cacheLockDuration)
        logger.trace(
          log(`Extended lock: ${lock.value}, TTL: ${(lock.expiration - Date.now()) / 1000}`),
        )
      }
    }

    // Lock duration multiplied by .8 to ensure lock is able to be extended before expiry
    const extendInterval = setInterval(extendLock, cacheLockDuration * 0.8)

    // Clear timeout on close for testing purposes
    shutdownNotifier.on('onClose', () => {
      clearInterval(extendInterval)
    })
  }
}
