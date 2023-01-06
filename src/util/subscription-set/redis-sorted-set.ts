import Redis from 'ioredis'
import { SubscriptionSet } from './subscription-set'

export class RedisSubscriptionSet<T> implements SubscriptionSet<T> {
  private redisClient: Redis
  // Key for Redis sorted set containing all subscriptions
  private subscriptionSetKey: string

  constructor(redisClient: Redis, subscriptionSetKey: string) {
    this.redisClient = redisClient
    this.subscriptionSetKey = subscriptionSetKey
  }

  async add(value: T, ttl: number): Promise<undefined> {
    const storedValue = JSON.stringify(value)
    await this.redisClient.zadd(this.subscriptionSetKey, Date.now() + ttl, storedValue)
    return
  }

  async getAll(): Promise<T[]> {
    // Remove expired keys from sorted set
    await this.redisClient.zremrangebyscore(this.subscriptionSetKey, '-inf', Date.now())
    const parsedRequests: T[] = []
    const validEntries = await this.redisClient.zrange(this.subscriptionSetKey, 0, -1)
    validEntries.forEach((entry) => {
      // Separate request and cache key prior to populating results array
      parsedRequests.push(JSON.parse(entry))
    })
    return parsedRequests
  }

  get(): T | undefined {
    return undefined
  }
}
