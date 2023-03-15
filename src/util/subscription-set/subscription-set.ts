import Redis from 'ioredis'
import { PromiseOrValue } from '..'
import { AdapterSettings } from '../../config'
import { ExpiringSortedSet } from './expiring-sorted-set'
import { RedisSubscriptionSet } from './redis-sorted-set'

/**
 * Set to hold items to subscribe to from a provider (regardless of protocol)
 */
export interface SubscriptionSet<T> {
  /** Add a new subscription to the set */
  add(value: T, ttl: number, key?: string): PromiseOrValue<void>

  /** Get all subscriptions from the set as a list */
  getAll(): PromiseOrValue<T[]>

  get: (key: string) => T | undefined
}

export class SubscriptionSetFactory {
  private cacheType: AdapterSettings['CACHE_TYPE']
  private redisClient?: Redis
  private adapterName?: string
  private capacity: AdapterSettings['SUBSCRIPTION_SET_MAX_ITEMS']

  constructor(adapterSettings: AdapterSettings, adapterName: string, redisClient?: Redis) {
    this.cacheType = adapterSettings.CACHE_TYPE
    this.redisClient = redisClient
    this.adapterName = adapterName
    this.capacity = adapterSettings.SUBSCRIPTION_SET_MAX_ITEMS
  }

  buildSet<T>(endpointName: string, transportName: string): SubscriptionSet<T> {
    switch (this.cacheType) {
      case 'local':
        return new ExpiringSortedSet<T>(this.capacity)
      case 'redis': {
        if (!this.redisClient) {
          throw new Error('Redis client undefined. Cannot create Redis subscription set')
        }
        // Identifier key used for the subscription set in redis
        const subscriptionSetKey = `${this.adapterName}-${endpointName}-${transportName}-subscriptionSet`
        return new RedisSubscriptionSet<T>(this.redisClient, subscriptionSetKey)
      }
    }
  }
}
