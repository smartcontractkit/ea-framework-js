import { metrics } from '../metrics'
import { AdapterResponse, DoubleLinkedList, LinkedListNode, censorLogs, makeLogger } from '../util'
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
 * Local implementation of a Cache. It uses a DoubleLinkedList class for storing cache nodes.
 * Each LinkedListNode is storing entries with both value and an expiration timestamp.
 * Expired entries are deleted on reads (i.e. no background gc/upkeep).
 * @typeParam T - the type for the entries' values
 */
export class LocalCache<T = unknown> implements Cache<T> {
  type = CacheTypes.Local
  capacity: number
  // Cache will hold cache keys as 'key' and references to LinkedListNodes as 'value' for fast search
  cache: Map<string, LinkedListNode<LocalCacheEntry<T>>>
  list: DoubleLinkedList

  constructor(capacity: number) {
    this.capacity = capacity
    this.cache = new Map()
    this.list = new DoubleLinkedList()
  }

  async get(key: string): Promise<Readonly<T> | undefined> {
    censorLogs(() => logger.trace(`Getting key ${key}`))
    if (this.cache.has(key)) {
      const node = this.cache.get(key) as LinkedListNode<LocalCacheEntry<T>>
      const expired = node.data.expirationTimestamp <= Date.now()
      if (expired) {
        logger.debug('Entry in local cache expired, deleting and returning undefined')
        this.delete(key)
        return undefined
      } else {
        logger.debug('Found valid entry in local cache, returning value')
        return node.data.value
      }
    } else {
      censorLogs(() =>
        logger.debug(`No entry in local cache for key "${key}", returning undefined`),
      )
      return undefined
    }
  }

  async delete(key: string): Promise<void> {
    censorLogs(() => logger.trace(`Deleting key ${key}`))
    if (this.cache.has(key)) {
      const node = this.cache.get(key) as LinkedListNode<LocalCacheEntry<T>>
      this.list.remove(node)
      this.cache.delete(key)
    }
  }

  async set(key: string, value: Readonly<T>, ttl: number): Promise<void> {
    censorLogs(() => logger.trace(`Setting key ${key} with ttl ${ttl}`))
    if (this.cache.has(key)) {
      censorLogs(() => logger.trace(`Found existing key ${key}. Updating value...`))
      const node = this.cache.get(key) as LinkedListNode<LocalCacheEntry<T>>
      const isCacheExpired = node.data.expirationTimestamp <= Date.now()
      // If the new value is an error, we don't want to overwrite the current active(not expired) 'successful' cache. If both cached and new values are errors or successful entries, the cache will be updated.
      if (
        'errorMessage' in (value as unknown as AdapterResponse) &&
        !isCacheExpired &&
        !('errorMessage' in (node.data.value as AdapterResponse))
      ) {
        censorLogs(() =>
          logger.trace(`New value for key ${key} is an error, not updating existing value`),
        )
      } else {
        node.data = {
          value,
          expirationTimestamp: Date.now() + ttl,
        }
        // When existing key is updated we move it to the end of the list as we keep recently updated entries there
        this.moveToTail(node)
      }
    } else {
      // For new cache entries check if we reached maximum size to delete least recently updated entry and free up space
      this.evictIfNeeded()
      const data = {
        value,
        expirationTimestamp: Date.now() + ttl,
      }
      const node = new LinkedListNode(key, data)
      // New entries are always added at the end of the list
      this.list.insertAtTail(node)
      this.cache.set(key, node)
    }
  }

  async setMany(entries: CacheEntry<Readonly<T>>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys with ttl ${ttl}`)
    for (const { key, value } of entries) {
      this.set(key, value, ttl)
    }
  }

  private evictIfNeeded() {
    if (this.list.size >= this.capacity) {
      logger.warn(`Cache list reached maximum capacity, evicting least recently updated entry`)
      const node = this.list.removeHead()
      if (node) {
        this.cache.delete(node.key)
        metrics.get('cacheOverflowCount').inc()
      }
    }
  }

  private moveToTail(node: LinkedListNode) {
    this.list.remove(node)
    this.list.insertAtTail(node)
  }
}
