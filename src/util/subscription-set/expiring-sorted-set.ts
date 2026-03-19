import { SubscriptionSet } from './subscription-set'
import { DoubleLinkedList, LinkedListNode, makeLogger, PromiseOrValue } from '..'

const logger = makeLogger('ExpiringSortedSet')

/**
 * An object describing an entry in the expiring sorted set.
 * @typeParam T - the type of the entry's value
 */
interface ExpiringSortedSetEntry<T> {
  value: T
  expirationTimestamp: number
}

/**
 * This class implements a set of unique items, each of which has an expiration timestamp.
 * On reads, items that have expired will be deleted from the set and not returned.
 *
 * @typeParam T - the type of the set entries' values
 */
export class ExpiringSortedSet<T> implements SubscriptionSet<T> {
  capacity: number
  map: Map<string, LinkedListNode<ExpiringSortedSetEntry<T>>>
  list: DoubleLinkedList

  constructor(capacity: number) {
    this.capacity = capacity
    this.map = new Map<string, LinkedListNode<ExpiringSortedSetEntry<T>>>()
    this.list = new DoubleLinkedList()
  }

  add(value: T, ttl: number, key: string) {
    let node = this.map.get(key)
    if (node) {
      if (JSON.stringify(value) !== JSON.stringify(node.data.value)) {
        logger.warn(
          `Subscription set received a value for key "${key}" that differs from the stored value. ` +
            `Keeping the original value to avoid unnecessary subscription churn. ` +
            `This indicates requests are using inconsistent parameter casing - ` +
            `stored: ${JSON.stringify(node.data.value)}, incoming: ${JSON.stringify(value)}`,
        )
      }
      node.data = {
        // Preserve the existing value rather than overwriting it. The key is the
        // normalised cache key (e.g. lowercased), so two entries that share a key
        // represent the same logical subscription. Overwriting the value with a
        // differently-cased variant would cause the streaming transport's
        // JSON.stringify-based diff to see a change, triggering an
        // unnecessary unsubscribe + resubscribe cycle that can permanently kill
        // the provider feed. Only the TTL needs refreshing here.
        value: node.data.value,
        expirationTimestamp: Date.now() + ttl,
      }
      this.moveToTail(node)
    } else {
      this.evictIfNeeded()
      const data = {
        value,
        expirationTimestamp: Date.now() + ttl,
      }
      node = new LinkedListNode(key, data)
      this.list.insertAtTail(node)
      this.map.set(key, node)
    }
  }

  getAll(): PromiseOrValue<T[]> {
    const results: T[] = []
    for (const [key] of this.map.entries()) {
      const value = this.get(key) as T
      if (value) {
        results.push(value)
      }
    }
    return results
  }

  get(key: string): T | undefined {
    const node = this.map.get(key)
    if (node) {
      const expired = node.data.expirationTimestamp <= Date.now()
      if (expired) {
        this.delete(key)
        return undefined
      } else {
        return node.data.value
      }
    } else {
      return undefined
    }
  }

  delete(key: string): void {
    const node = this.map.get(key)
    if (node) {
      this.list.remove(node)
      this.map.delete(key)
    }
  }

  private moveToTail(node: LinkedListNode) {
    this.list.remove(node)
    this.list.insertAtTail(node)
  }

  private evictIfNeeded() {
    if (this.list.size >= this.capacity) {
      const node = this.list.removeHead()
      if (node) {
        logger.warn(
          `List reached maximum capacity, evicting least recently updated entry. The subscription with key ${node.key} was removed.`,
        )
        this.map.delete(node.key)
      }
    }
  }
}
