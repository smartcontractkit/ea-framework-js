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

class LinkedListNode<T = unknown> {
  data: T
  next: LinkedListNode | null
  prev: LinkedListNode | null
  key: string
  constructor(key: string, data: T) {
    this.data = data
    this.next = null
    this.prev = null
    this.key = key
  }
}

class DoubleLinkedList {
  head: LinkedListNode | null
  tail: LinkedListNode | null
  size: number
  constructor() {
    this.head = null
    this.tail = null
    this.size = 0
  }

  insertAtTail(node: LinkedListNode) {
    if (!this.tail) {
      this.tail = node
      this.head = node
      node.next = null
    } else {
      this.tail.next = node
      node.prev = this.tail
      this.tail = node
      node.next = null
    }

    this.size++
    return node
  }

  insertAtHead(node: LinkedListNode) {
    if (!this.head) {
      this.tail = node
      this.head = node
    } else {
      node.next = this.head
      this.head.prev = node
      this.head = node
    }

    this.size++
    return node
  }

  remove(node: LinkedListNode | null): LinkedListNode | undefined {
    if (!node) {
      return
    }

    if (node.prev !== null) {
      node.prev.next = node.next
    }

    if (node.next !== null) {
      node.next.prev = node.prev
    }

    if (node === this.head) {
      this.head = this.head.next
    }

    if (node === this.tail) {
      this.tail = this.tail.prev
    }
    this.size--
    return node
  }

  removeHead(): LinkedListNode | undefined {
    return this.remove(this.head)
  }

  removeTail(): LinkedListNode | undefined {
    return this.remove(this.tail)
  }
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

  async get(key: string): Promise<T | undefined> {
    logger.trace(`Getting key ${key}`)
    if (this.cache.has(key)) {
      const node = this.cache.get(key) as LinkedListNode<LocalCacheEntry<T>>
      const expired = node.data.expirationTimestamp <= Date.now()
      if (expired) {
        logger.debug('Entry in local cache expired, deleting and returning undefined')
        this.delete(key)
        return undefined
      } else {
        logger.debug('Found valid entry in local cache, returning value')
        // When key is accessed we move it to end of the list as we keep recently used entries there
        this.moveToTail(node)
        return node.data.value
      }
    } else {
      logger.debug(`No entry in local cache for key "${key}", returning undefined`)
      return undefined
    }
  }

  async delete(key: string): Promise<void> {
    logger.trace(`Deleting key ${key}`)
    if (this.cache.has(key)) {
      const node = this.cache.get(key) as LinkedListNode<LocalCacheEntry<T>>
      this.list.remove(node)
      this.cache.delete(key)
    }
  }

  async set(key: string, value: T, ttl: number): Promise<void> {
    logger.trace(`Setting key ${key} with ttl ${ttl}`)
    if (this.cache.has(key)) {
      logger.trace(`Found existing key ${key}. Updating value...`)
      const node = this.cache.get(key) as LinkedListNode<LocalCacheEntry<T>>
      node.data = {
        value,
        expirationTimestamp: Date.now() + ttl,
      }
      // When existing key is updated we move it to the end of the list as we keep recently used entries there
      this.moveToTail(node)
    } else {
      // For new cache entries check if we reached maximum size to delete least recently used entries and free up space
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

  async setMany(entries: CacheEntry<T>[], ttl: number): Promise<void> {
    logger.trace(`Setting a bunch of keys with ttl ${ttl}`)
    for (const { key, value } of entries) {
      this.set(key, value, ttl)
    }
  }

  private evictIfNeeded() {
    if (this.list.size >= this.capacity) {
      const node = this.list.removeHead()
      if (node) {
        this.cache.delete(node.key)
      }
    }
  }

  private moveToTail(node: LinkedListNode) {
    this.list.remove(node)
    this.list.insertAtTail(node)
  }
}
