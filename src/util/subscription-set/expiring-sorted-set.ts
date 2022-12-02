import { SubscriptionSet } from './subscription-set'

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
  map = new Map<string, ExpiringSortedSetEntry<T>>()

  add(key: string, value: T, ttl: number) {
    this.map.set(key, {
      value,
      expirationTimestamp: Date.now() + ttl,
    })
  }

  getAll(): T[] {
    const results: T[] = []
    const now = Date.now()

    // Since we're iterating, might as well prune here
    for (const [key, entry] of this.map.entries()) {
      if (entry.expirationTimestamp < now) {
        this.map.delete(key) // In theory, this shouldn't happen frequently for feeds
      } else {
        results.push(entry.value)
      }
    }

    return results
  }
}
