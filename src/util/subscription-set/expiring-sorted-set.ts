import { SubscriptionSet } from './subscription-set'

/**
 * This class implements a set of unique items, each of which has an expiration timestamp.
 * On reads, items that have expired will be deleted from the set and not returned.
 *
 * @typeParam T - the type of the set entries' values
 */
export class ExpiringSortedSet<T> implements SubscriptionSet<T> {
  map = new Map<string, number>()

  add(value: T, ttl: number) {
    this.map.set(JSON.stringify(value), Date.now() + ttl)
  }

  getAll(): T[] {
    const results: T[] = []
    const now = Date.now()

    // Since we're iterating, might as well prune here
    for (const [value, ttl] of this.map.entries()) {
      if (ttl < now) {
        this.map.delete(value) // In theory, this shouldn't happen frequently for feeds
      } else {
        results.push(JSON.parse(value))
      }
    }

    return results
  }
}
