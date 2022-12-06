import Redis from 'ioredis'
import { makeLogger } from '../util'
import { LocalCache } from './local'
import { RedisCache } from './redis'

const logger = makeLogger('CacheFactory')
export class CacheFactory {
  static buildCache(
    { cacheType, maxSizeForLocalCache }: { cacheType: string; maxSizeForLocalCache: number },
    redisClient?: Redis,
  ) {
    logger.info(`Using "${cacheType}" cache.`)
    switch (cacheType) {
      case 'local':
        return new LocalCache(maxSizeForLocalCache)
      case 'redis': {
        if (!redisClient) {
          throw new Error('Redis client undefined. Cannot create Redis cache')
        }
        return new RedisCache(redisClient)
      }
    }
  }
}
