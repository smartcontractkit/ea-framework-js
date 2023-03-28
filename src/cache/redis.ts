import Redis from 'ioredis'
import { CMD_SENT_STATUS, recordRedisCommandMetric } from '../metrics'
import { AdapterResponse, makeLogger } from '../util'
import { Cache, CacheEntry } from './index'
import { cacheMetricsLabel, cacheSet, CacheTypes } from './metrics'

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
    this.loadFunctions()
  }

  async loadFunctions() {
    // Load custom function 'setResponse' with lua script to redis that will skip overwriting successful cache response if the new value is error response
    const source =
      '#!lua name=ea \n ' +
      "redis.register_function('setResponse', function(keys, args) " +
      'local key = keys[1] ' +
      'local value = args[1] ' +
      'local ttl = tonumber(args[2]) ' +
      'local json_value = cjson.decode(value) ' +
      "local key_exists = redis.call('EXISTS', key) " +
      'if json_value.errorMessage and key_exists == 1 then ' +
      '  return nil ' +
      'else ' +
      "  return redis.call('SET', key, value, 'PX', ttl) " +
      'end ' +
      'end)'

    const fnList = await this.client.function('LIST')
    if (!fnList.length) {
      this.client.function('LOAD', source)
    } else {
      this.client.function('LOAD', 'REPLACE', source)
    }
  }

  async get(key: string): Promise<Readonly<T> | undefined> {
    logger.trace(`Getting key ${key}`)
    const value = await this.client.get(key)

    // Record get command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'get')

    if (!value) {
      logger.debug(`No entry in redis cache for key "${key}", returning undefined`)
      return undefined
    }

    return JSON.parse(value) as T
  }

  async delete(key: string): Promise<void> {
    logger.trace(`Deleting key ${key}`)
    await this.client.del(key)

    // Record delete command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'delete')
  }

  async set(key: string, value: Readonly<T>, ttl: number): Promise<void> {
    logger.trace(`Setting key ${key}`)
    await this.client.fcall('setResponse', 1, key, JSON.stringify(value), ttl)

    // Record set command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'set')
  }

  async setMany(entries: CacheEntry<Readonly<T>>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys`)
    // Unfortunately, there's no ttl for mset
    let chain = this.client.multi()

    for (const entry of entries) {
      chain = chain.fcall('setResponse', 1, entry.key, JSON.stringify(entry.value), ttl)
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
}
