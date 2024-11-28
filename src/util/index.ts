export * from './logger'
export * from './subscription-set/subscription-set'
export * from './types'

/**
 * Sleeps for the provided number of milliseconds
 * @param ms - The number of milliseconds to sleep for
 * @returns a Promise that resolves once the specified time passes
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export type PromiseOrValue<T> = Promise<T> | T

export class LinkedListNode<T = unknown> {
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

export class DoubleLinkedList {
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
}

class PromiseTimeoutError extends Error {}

/**
 * Waits for the provided promise to finish up to a specified amount of time, at which point
 * an error is thrown if the promise hasn't finished yet. Note that this cannot abort the execution
 * of the provided promise, as the underlying node structure cannot cancel the thread.
 *
 * @param promise - the promise to wait for
 * @param timeout - the maximum amount of time to wait for the promise to finish
 * @returns the result of the promise
 */
export const timeoutPromise = <T>(
  label: string,
  promise: Promise<T>,
  timeout: number,
): Promise<T> => {
  let timer: NodeJS.Timeout
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new PromiseTimeoutError(`The promise "${label}" took longer than ${timeout} ms to execute, unblocking execution.
      (NOTE: the original promise is not cancelled from this error, it will continue to execute in the background)`),
          ),
        timeout,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

type DeferredResolve<T> = (value: T) => void
type DeferredReject = (reason?: unknown) => void

/**
 * This function will create a promise, and synchronously return both the promise itself and
 * the resolve and reject callbacks so that they can be used and passed around individually.
 *
 * @returns all the deconstructed elements of a promise, to handle in synchronous-ish logic
 */
export const deferredPromise = <T>(): [Promise<T>, DeferredResolve<T>, DeferredReject] => {
  let resolve!: DeferredResolve<T>
  let reject!: DeferredReject
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return [promise, resolve, reject]
}

/**
 * Checks if the provided array includes any duplicates
 *
 * @param array - any array to check
 * @returns whether the array has duplicate items
 */
export const hasRepeatedValues = (array: string[]) => array.length !== new Set(array).size

/**
 * Splits an array into smaller arrays of a specified size.
 *
 * @param array - any array to be chunked
 * @param size - the maximum size of each chunk
 * @returns an array of arrays, each of which contains up to `size` elements
 */
export const splitArrayIntoChunks = <T>(array: T[], size: number): T[][] => {
  return array.length > size
    ? [array.slice(0, size), ...splitArrayIntoChunks(array.slice(size), size)]
    : [array]
}

/**
 * Groups an array of objects by a specified key
 * @param  array - The array of objects to group
 * @param  key - The name of the key to group by
 * @returns An object where the keys are the unique values of the specified key
 * and the values are array of items with that key
 */
export const groupArrayByKey = <T extends Record<string, string>, K extends keyof T>(
  array: T[],
  key: K,
) => {
  return array.reduce(
    (groupedItems, item) => {
      const keyValue = item[key]
      groupedItems[keyValue] ??= []
      groupedItems[keyValue].push(item)
      return groupedItems
    },
    {} as Record<T[K], T[]>,
  )
}
