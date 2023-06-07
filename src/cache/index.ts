import crypto from 'crypto'
import { EndpointContext, EndpointGenerics } from '../adapter'
import { AdapterResponse, censorLogs, makeLogger, sleep } from '../util'
import { CacheTypes as CacheType } from './metrics'

export * from './factory'
export * from './local'
export * from './redis'

const logger = makeLogger('Cache')

/**
 * An object describing an entry in the cache.
 * @typeParam T - the type of the entry's value
 */
export interface CacheEntry<T> {
  key: string
  value: T
}

/**
 * Generic interface for a local or remote Cache.
 * @typeParam T - the type of the cache entries' values
 */
export interface Cache<T = unknown> {
  type: CacheType

  /**
   * Gets an item from the Cache.
   *
   * @param key - the key of the desired entry for which to fetch its value
   * @returns a Promise of the entry's value, or undefined if not found / expired.
   */
  get: (key: string) => Promise<Readonly<T> | undefined>

  /**
   * Sets an item in the Cache.
   *
   * @param key - the key of the new entry
   * @param value - the value of the new entry
   * @param ttl - the time in milliseconds until the entry expires
   * @returns an empty Promise that resolves when the entry has been set
   */
  set: (key: string, value: Readonly<T>, ttl: number) => Promise<void>

  /**
   * Sets a list of items in the Cache.
   *
   * @param entries - a list of cache entries
   * @param ttl - the time in milliseconds until the entries expire
   * @returns an empty Promise that resolves when all entries have been set
   */
  setMany: (entries: CacheEntry<Readonly<T>>[], ttl: number) => Promise<void>

  /**
   * Deletes the specified item from the Cache
   *
   * @param key - the key of the entry to be deleted
   * @returns an empty Promise that resolves when the entry has been deleted
   */
  delete: (key: string) => Promise<void>
}

// Uses calculateKey to generate a unique key from the endpoint name, data, and input parameters
export const calculateCacheKey = <T extends EndpointGenerics>({
  data,
  adapterName,
  endpointName,
  adapterSettings,
  transportName,
}: {
  data: Record<string, unknown>
  adapterName: string
  endpointName: string
  adapterSettings: T['Settings']
  transportName: string
}): string => {
  const calculatedKey = calculateKey({
    data,
    adapterSettings,
    endpointName,
    transportName,
  })

  const cachePrefix = adapterSettings.CACHE_PREFIX ? `${adapterSettings.CACHE_PREFIX}-` : ''
  const cacheKey = `${cachePrefix}${adapterName}-${calculatedKey}`

  censorLogs(() => logger.trace(`Generated cache key for request: "${cacheKey}"`))
  return cacheKey
}

// Used to coalesce HTTP requests within the same endpoint
export const calculateHttpRequestKey = <T extends EndpointGenerics>({
  data,
  context,
  transportName,
}: {
  context: EndpointContext<T>
  data: Record<string, unknown> | Record<string, unknown>[]
  transportName: string
}): string => {
  const key = calculateKey({
    data,
    transportName,
    adapterSettings: context.adapterSettings,
    endpointName: context.endpointName,
  })
  censorLogs(() => logger.trace(`Generated HTTP request queue key: "${key}"`))
  return key
}

const calculateKey = <T extends EndpointGenerics>({
  data,
  endpointName,
  transportName,
  adapterSettings,
}: {
  data: Record<string, unknown> | Record<string, unknown>[]
  endpointName: string
  transportName: string
  adapterSettings: T['Settings']
}) => {
  const paramsKey = Object.keys(data).length
    ? calculateParamsKey(data, adapterSettings.MAX_COMMON_KEY_SIZE)
    : adapterSettings.DEFAULT_CACHE_KEY
  return `${endpointName}-${transportName}-${paramsKey}`
}

export const calculateFeedId = <T extends EndpointGenerics>(
  {
    adapterSettings,
  }: {
    adapterSettings: T['Settings']
  },
  data: Record<string, unknown>,
): string => {
  if (Object.keys(data).length === 0) {
    logger.trace(`Cannot generate Feed ID without data`)
    return 'N/A'
  }
  return calculateParamsKey(data, adapterSettings.MAX_COMMON_KEY_SIZE)
}

/**
 * Calculates a unique key from the provided data.
 *
 * @param data - the request data/body, i.e. the adapter input params
 * @param maxSize - the max length for the cache key params section
 * @returns the calculated unique key
 *
 * @example
 * ```
 * calculateKey({ base: 'ETH', quote: 'BTC' })
 * // equals `{"base":"eth","quote":"btc"}`
 * ```
 */
const calculateParamsKey = (data: unknown, maxSize: number): string => {
  if (data && typeof data !== 'object') {
    throw new Error('Data to calculate cache key should be an object')
  }

  const cacheKey = JSON.stringify(data, (_, value) => {
    if (value && typeof value === 'string') {
      return value.toLowerCase()
    }
    return value
  })

  if (cacheKey.length > maxSize) {
    logger.debug(
      `Generated cache key for adapter request is bigger than the MAX_COMMON_KEY_SIZE and will be hashed`,
    )
    const shasum = crypto.createHash('sha1')
    shasum.update(cacheKey)
    return shasum.digest('base64')
  }

  return cacheKey
}

/**
 * Polls the provided Cache for an AdapterResponse set in the provided key. If the maximum
 * amount of retries is exceeded, it returns undefined instead.
 *
 * @param cache - a Cache instance
 * @param key - the key generated from an AdapterRequest that corresponds to the desired AdapterResponse
 * @param retry - current retry, only for internal use
 * @returns the AdapterResponse if found, else undefined
 */
export const pollResponseFromCache = async (
  cache: Cache<AdapterResponse>,
  key: string,
  options: {
    maxRetries: number
    sleep: number
  },
  retry = 0,
): Promise<AdapterResponse | undefined> => {
  if (retry > options.maxRetries) {
    // Ideally this shouldn't happen often (p99 of reqs should be found in the cache)
    logger.debug('Exceeded max cache polling retries')
    return undefined
  }

  logger.trace('Getting response from cache...')
  const response = await cache.get(key)
  if (response) {
    logger.trace('Got response from cache')
    return response
  }

  if (options.maxRetries === 0) {
    logger.debug(`Response not found, retries disabled`)
    return undefined
  }

  logger.debug(`Response not found, sleeping ${options.sleep} milliseconds...`)
  await sleep(options.sleep)

  return pollResponseFromCache(cache, key, options, retry + 1)
}
