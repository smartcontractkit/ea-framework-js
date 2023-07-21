import EventEmitter from 'events'
import Redis, { Result } from 'ioredis'
import Redlock from 'redlock'
import { CMD_SENT_STATUS, recordRedisCommandMetric } from '../metrics'
import { AdapterResponse, censorLogs, makeLogger, sleep } from '../util'
import { Cache, CacheEntry } from './index'
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

  constructor(private client: Redis) {
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

    // Record delete command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'delete')
  }

  async set(key: string, value: Readonly<T>, ttl: number): Promise<void> {
    censorLogs(() => logger.trace(`Setting key ${key}`))
    await this.client.setExternalAdapterResponse(key, JSON.stringify(value), ttl)

    // Record set command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'setExternalAdapterResponse')
  }

  async setMany(entries: CacheEntry<Readonly<T>>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys`)
    // Unfortunately, there's no ttl for mset
    let chain = this.client.multi()

    for (const entry of entries) {
      chain = chain.setExternalAdapterResponse(entry.key, JSON.stringify(entry.value), ttl)
    }

    await chain.exec()

    // Loop again, but this time to record these in metrics
    const now = Date.now()
    for (const entry of entries) {
      // Only record metrics if feed Id is present, otherwise assuming value is not adapter response to record
      const response = entry.value as unknown as AdapterResponse
      const feedId = response.meta?.metrics?.feedId
      if (feedId) {
        const providerTime = response.timestamps?.providerIndicatedTimeUnixMs
        const timeDelta = providerTime ? now - providerTime : undefined

        // Record cache set count, max age, and staleness (set to 0 for cache set)
        const label = cacheMetricsLabel(entry.key, feedId, CacheTypes.Redis)
        cacheSet(label, ttl, timeDelta)
      }
    }

    // Record exec command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'exec')
  }

  async lock(
    key: string,
    cacheLockDuration: number,
    retryCount: number,
    shutdownNotifier: EventEmitter,
  ): Promise<void> {
    const start = Date.now()
    const log = (msg: string) => `[${(Date.now() - start) / 1000}]: ${msg}`
    // Ensures lock is able to be extended in time
    const durationBuffer = cacheLockDuration * 0.8

    const redlock = new Redlock([this.client], {
      retryCount: 0,
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
          // If the last retry fails, throw error
          if (retryAttempt === retryCount) {
            throw new Error(
              'The adapter failed to acquire a lock on the cache. Please check if you are running another instance of the adapter with the same name and cache prefix.',
            )
          }
          // On error, sleep before retrying again
          await sleep(cacheLockDuration / retryCount)
        }
      }
    }

    let lock = await acquireLock()

    const extendLock = async () => {
      if (lock) {
        // eslint-disable-next-line require-atomic-updates
        lock = await lock.extend(cacheLockDuration)
        logger.trace(
          log(`Extended lock: ${lock.value}, TTL: ${(lock.expiration - Date.now()) / 1000}`),
        )

        const lockTimeout = setTimeout(extendLock, durationBuffer)

        // Clear timeout on close for testing purposes
        shutdownNotifier.on('onClose', () => {
          clearTimeout(lockTimeout)
        })
      }
    }

    await extendLock()
  }
}
