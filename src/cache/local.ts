import { makeLogger } from '../util'
import { Cache, CacheEntry } from './index'
import { CacheTypes } from './metrics'

const logger = makeLogger('LocalCache')

/**
 * Type for a value stored in a LocalCache entry.
 *
 * @typeParam T - the type for the entry's value
 */
export interface LocalCacheEntry<T> {
  expirationTimestamp: number
  value: T
}

/**
 * Local implementation of a Cache. It uses a simple js Object, storing entries with both
 * a value and an expiration timestamp. Expired entries are deleted on reads (i.e. no background gc/upkeep).
 *
 * @typeParam T - the type for the entries' values
 */
export class LocalCache<T = unknown> implements Cache<T> {
  type = CacheTypes.Local

  store: Record<string, LocalCacheEntry<T>> = {}

  async get(key: string): Promise<T | undefined> {
    logger.trace(`Getting key ${key}`)
    const entry = this.store[key]

    if (!entry) {
      logger.debug(`No entry in local cache for key "${key}", returning undefined`)
      return undefined
    }

    const expired = entry.expirationTimestamp <= Date.now()
    if (expired) {
      logger.debug('Entry in local cache expired, deleting and returning undefined')
      this.delete(key)
      return undefined
    } else {
      logger.debug('Found valid entry in local cache, returning value')
      return entry.value
    }
  }

  async delete(key: string): Promise<void> {
    logger.trace(`Deleting key ${key}`)
    delete this.store[key] // Deletes are slower than ignoring or setting null, fyi
  }

  async set(key: string, value: T, ttl: number): Promise<void> {
    logger.trace(`Setting key ${key} with ttl ${ttl}`)
    this.store[key] = {
      value,
      expirationTimestamp: Date.now() + ttl,
    }
  }

  async setMany(entries: CacheEntry<T>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys with ttl ${ttl}`)
    for (const { key, value } of entries) {
      this.set(key, value, ttl)
    }
  }
}
