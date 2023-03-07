export * from './types'
export * from './logger'
export * from './subscription-set/subscription-set'

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

export const isObject = (o: unknown): boolean =>
  o !== null && typeof o === 'object' && Array.isArray(o) === false

export const isArray = (o: unknown): boolean =>
  o !== null && typeof o === 'object' && Array.isArray(o)

export const isEmpty = (o: unknown): boolean => o === undefined || o === null || o === ''

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
