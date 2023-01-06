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
      node.data = {
        value,
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
