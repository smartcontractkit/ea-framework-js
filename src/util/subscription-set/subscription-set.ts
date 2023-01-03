import Redis from 'ioredis'
import { PromiseOrValue } from '..'
import { AdapterConfig } from '../../config'
import { ExpiringSortedSet } from './expiring-sorted-set'
import { RedisSubscriptionSet } from './redis-sorted-set'

/**
 * Set to hold items to subscribe to from a provider (regardless of protocol)
 */
export interface SubscriptionSet<T> {
  /** Add a new subscription to the set */
  add(value: T, ttl: number): PromiseOrValue<void>

  /** Get all subscriptions from the set as a list */
  getAll(): PromiseOrValue<T[]>
}

export class SubscriptionSetFactory {
  private cacheType: AdapterConfig['CACHE_TYPE']
  private redisClient?: Redis
  private adapterName?: string

  constructor(config: AdapterConfig, adapterName: string, redisClient?: Redis) {
    this.cacheType = config.CACHE_TYPE
    this.redisClient = redisClient
    this.adapterName = adapterName
  }

  buildSet<T>(endpointName: string): SubscriptionSet<T> {
    switch (this.cacheType) {
      case 'local':
        return new ExpiringSortedSet<T>()
      case 'redis': {
        if (!this.redisClient) {
          throw new Error('Redis client undefined. Cannot create Redis subscription set')
        }
        // Identifier key used for the subscription set in redis
        const subscriptionSetKey = `${this.adapterName}-${endpointName}-subscriptionSet`
        return new RedisSubscriptionSet<T>(this.redisClient, subscriptionSetKey)
      }
    }
  }
}
