import { EndpointGenerics } from '../adapter'
import { AdapterConfig, SettingsMap } from '../config'
import { AdapterResponse, makeLogger, sleep } from '../util'
import { InputParameters } from '../validation'
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
export const calculateCacheKey = <T extends EndpointGenerics>(
  {
    inputParameters,
    endpointName,
    adapterConfig,
  }: {
    inputParameters: InputParameters
    endpointName: string
    adapterConfig: AdapterConfig<T['CustomSettings']>
  },
  data: unknown,
): string => {
  if (Object.keys(inputParameters).length === 0) {
    logger.trace(`Using default cache key ${adapterConfig.DEFAULT_CACHE_KEY}`)
    return adapterConfig.DEFAULT_CACHE_KEY
  }
  const cacheKey = `${endpointName}-${calculateKey(data, adapterConfig)}`
  logger.trace(`Generated cache key for request: "${cacheKey}"`)
  return cacheKey
}

export const calculateFeedId = <T extends EndpointGenerics>(
  {
    inputParameters,
    adapterConfig,
  }: {
    inputParameters: InputParameters
    adapterConfig: AdapterConfig<T['CustomSettings']>
  },
  data: unknown,
): string => {
  if (Object.keys(inputParameters).length === 0) {
    logger.trace(`Cannot generate Feed ID without input parameters`)
    return 'N/A'
  }
  return calculateKey(data, adapterConfig)
}

/**
 * Calculates a unique key from the provided data.
 *
 * @param data - the request data/body, i.e. the adapter input params
 * @param adapterConfig - the config for this Adapter
 * @returns the calculated unique key
 *
 * @example
 * ```
 * calculateKey({ base: 'ETH', quote: 'BTC' })
 * // equals `{"base":"eth","quote":"btc"}`
 * ```
 */
export const calculateKey = <CustomSettings extends SettingsMap>(
  data: unknown,
  adapterConfig: AdapterConfig<CustomSettings>,
): string => {
  if (data && typeof data !== 'object') {
    throw new Error('Data to calculate cache key should be an object')
  }

  let cacheKey = JSON.stringify(data, (_, value) => {
    if (value && typeof value === 'string') {
      return value.toLowerCase()
    }
    return value
  })

  if (cacheKey.length > adapterConfig.MAX_COMMON_KEY_SIZE) {
    logger.warn(
      `Generated cache key for adapter request is bigger than the MAX_COMMON_KEY_SIZE and will be truncated`,
    )
    cacheKey = cacheKey.slice(0, adapterConfig.MAX_COMMON_KEY_SIZE)
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
