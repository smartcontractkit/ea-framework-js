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
