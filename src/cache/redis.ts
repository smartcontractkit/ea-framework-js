import Redis from 'ioredis'
import { metrics } from '../metrics'
import { AdapterResponse, makeLogger } from '../util'
import { Cache, CacheEntry } from './index'
import { cacheMetricsLabel, cacheSet, CacheTypes, CMD_SENT_STATUS } from './metrics'

const logger = makeLogger('RedisCache')

export const recordRedisCommandMetric = (status: CMD_SENT_STATUS, functionName: string): void =>
  metrics
    .get('redisCommandsSentCount')
    .labels({ status: CMD_SENT_STATUS[status], function_name: functionName })
    .inc()

/**
 * Redis implementation of a Cache. It uses a simple js Object, storing entries with both
 * a value and an expiration timestamp. Expired entries are deleted on reads (i.e. no background gc/upkeep).
 *
 * @typeParam T - the type for the entries' values
 */
export class RedisCache<T = unknown> implements Cache<T> {
  type = CacheTypes.Redis

  constructor(private client: Redis) {}

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
    await this.client.set(key, JSON.stringify(value), 'PX', ttl)

    // Record set command sent to Redis
    recordRedisCommandMetric(CMD_SENT_STATUS.SUCCESS, 'set')
  }

  async setMany(entries: CacheEntry<Readonly<T>>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys`)
    // Unfortunately, there's no ttl for mset
    let chain = this.client.multi()

    for (const entry of entries) {
      chain = chain.set(entry.key, JSON.stringify(entry.value), 'PX', ttl)
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
