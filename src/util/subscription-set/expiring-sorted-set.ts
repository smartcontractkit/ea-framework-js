import { SubscriptionSet } from './subscription-set'
import { DoubleLinkedList, LinkedListNode } from '../../cache'
import { PromiseOrValue } from '..'
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

  add(key: string, value: T, ttl: number) {
    if (this.map.has(key)) {
      const node = this.map.get(key) as LinkedListNode<ExpiringSortedSetEntry<T>>

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
      const node = new LinkedListNode(key, data)
      this.list.insertAtTail(node)
      this.map.set(key, node)
    }
  }

  getAll(): PromiseOrValue<T[]> {
    const results: T[] = []
    for (const [key] of this.map.entries()) {
      const value = this.get(key) as T
      results.push(value)
    }
    return results
  }

  get(key: string): T | undefined {
    if (this.map.has(key)) {
      const node = this.map.get(key) as LinkedListNode<ExpiringSortedSetEntry<T>>
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
    if (this.map.has(key)) {
      const node = this.map.get(key) as LinkedListNode<ExpiringSortedSetEntry<T>>
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
        this.map.delete(node.key)
      }
    }
  }
}
