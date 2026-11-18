import test from 'ava'
import {
  invertPrice,
  invertQuote,
  LwbaResponseDataFields,
  priceEndpointInputParametersDefinition,
  PriceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { calculateFeedId, inverseFeedIdParams, toInverseCacheKey } from '../../src/cache'
import { LocalCache } from '../../src/cache/local'
import { SimpleResponseCache } from '../../src/cache/response-cache/simple'
import { AdapterConfig, AdapterSettings, buildAdapterSettings } from '../../src/config'
import { metrics } from '../../src/metrics'
import {
  SingleNumberResultResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { MockCache } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
import { TypeFromDefinition } from '../../src/validation/input-params'
import { countCacheKeyCalculations } from '../helper'

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

type SingleValueGenerics = {
  Parameters: PriceEndpointInputParametersDefinition
  Response: SingleNumberResultResponse
}

const timestamps = {
  providerDataRequestedUnixMs: 0,
  providerDataReceivedUnixMs: 0,
  providerIndicatedTimeUnixMs: undefined,
}

test('invertPrice inverts the result without mutating the input', (t) => {
  const data = { result: 4, extra: 'kept' }
  const output = invertPrice({ data, result: 4 })

  t.deepEqual(output, { data: { result: 0.25, extra: 'kept' }, result: 0.25 })
  t.not(output.data, data)
  t.deepEqual(data, { result: 4, extra: 'kept' })

  t.is(invertPrice({ data: { result: 2 }, result: 2 }).result, 0.5)
  t.is(invertPrice({ data: { result: 0.25 }, result: 0.25 }).result, 4)
})

test('invertQuote inverts the quote, swaps sizes and leaves the input untouched', (t) => {
  const data = { bid: 1, ask: 1.2, mid: 1.1, bidSize: 10, askSize: 20 }
  const output = invertQuote({ data, result: null })

  t.is(output.result, null)
  t.true(Math.abs(output.data.bid - 1 / 1.2) < 1e-12)
  t.true(Math.abs(output.data.ask - 1) < 1e-12)
  t.true(Math.abs(output.data.mid - 1 / 1.1) < 1e-12)
  t.is(output.data.bidSize, 20)
  t.is(output.data.askSize, 10)
  t.deepEqual(data, { bid: 1, ask: 1.2, mid: 1.1, bidSize: 10, askSize: 20 })
  t.not(output.data, data)

  // Extra fields in data survive the inversion.
  const withExtra = invertQuote({
    data: { bid: 2, ask: 2, mid: 2, midSource: 'provider' },
    result: null,
  })
  t.is((withExtra.data as { midSource?: string }).midSource, 'provider')

  // No sizes at all: no size keys in the output.
  const noSizes = invertQuote({ data: { bid: 1, ask: 2, mid: 1.5 }, result: null })
  t.false('bidSize' in noSizes.data)
  t.false('askSize' in noSizes.data)

  // A single size: the pair is swapped, so the missing one becomes undefined.
  const onlyBidSize = invertQuote({
    data: { bid: 1, ask: 2, mid: 1.5, bidSize: 3 } as LwbaResponseDataFields['Data'] & {
      bidSize?: number
      askSize?: number
    },
    result: null,
  })
  t.is(onlyBidSize.data.bidSize, undefined)
  t.is(onlyBidSize.data.askSize, 3)

  // Equal bid and ask produce a valid inverse of themselves.
  const flat = invertQuote({ data: { bid: 2, ask: 2, mid: 2 }, result: null })
  t.is(flat.data.bid, 0.5)
  t.is(flat.data.ask, 0.5)
  t.is(flat.data.mid, 0.5)
})

test('invertQuote works with the LWBA response data type', (t) => {
  const data: LwbaResponseDataFields['Data'] = { bid: 1.36, ask: 1.37, mid: 1.365 }
  const output = invertQuote({ data, result: null })

  t.true(Math.abs(output.data.bid - 1 / 1.37) < 1e-12)
  t.true(Math.abs(output.data.ask - 1 / 1.36) < 1e-12)
  t.true(Math.abs(output.data.mid - 1 / 1.365) < 1e-12)
})

const inputParameters = new InputParameters(priceEndpointInputParametersDefinition)
const adapterSettings = buildAdapterSettings({})

type CacheParams = TypeFromDefinition<SingleValueGenerics['Parameters']>

const rawParams = { base: 'BTC', quote: 'USD' } as CacheParams
const otherParams = { base: 'ETH', quote: 'USD' } as CacheParams

const providerResult = (
  params: CacheParams,
  value: number,
): TimestampedProviderResult<SingleValueGenerics> => ({
  params,
  response: {
    data: { result: value },
    result: value,
    timestamps,
  },
})

const buildCache = ({
  resultValidator,
  settings = adapterSettings,
}: {
  resultValidator?: (
    result: TimestampedProviderResult<SingleValueGenerics>,
  ) => TimestampedProviderResult<SingleValueGenerics>
  settings?: AdapterSettings
} = {}) => {
  const cache = new MockCache(settings.CACHE_MAX_ITEMS)
  const responseCache = new SimpleResponseCache<SingleValueGenerics>({
    dependencies: { cache } as unknown as AdapterDependencies,
    adapterSettings: settings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters,
  })
  responseCache.invertResponse = invertPrice
  if (resultValidator) {
    responseCache.resultValidator = resultValidator
  }
  return { cache, responseCache }
}

const rawKeyOf = (responseCache: SimpleResponseCache<SingleValueGenerics>) =>
  responseCache.getCacheKey('test', rawParams)
const inverseKeyOf = (responseCache: SimpleResponseCache<SingleValueGenerics>) =>
  toInverseCacheKey(rawKeyOf(responseCache))

test.serial('the inverse key is the raw key plus -inverse', (t) => {
  const { responseCache } = buildCache()

  t.is(rawKeyOf(responseCache), 'TEST-test-test-{"base":"btc","quote":"usd"}')
  t.is(inverseKeyOf(responseCache), 'TEST-test-test-{"base":"btc","quote":"usd"}-inverse')
  t.not(rawKeyOf(responseCache), inverseKeyOf(responseCache))
})

test.serial('the inverse feed ID is computed from the params plus inversion: true', (t) => {
  const config = new AdapterConfig({})
  config.initialize()
  config.settings.METRICS_ENABLED = true
  config.settings.EXPERIMENTAL_METRICS_ENABLED = true
  config.validate()

  const { cache, responseCache } = buildCache({ settings: config.settings })

  t.is(calculateFeedId({ adapterSettings }, rawParams), '{"base":"btc","quote":"usd"}')
  t.is(
    calculateFeedId({ adapterSettings }, inverseFeedIdParams(rawParams)),
    '{"base":"btc","inversion":true,"quote":"usd"}',
  )

  return responseCache.setInverseParams('test', [rawParams]).then(async () => {
    await responseCache.write('test', [providerResult(rawParams, 4)])

    const raw = await cache.get(rawKeyOf(responseCache))
    const inverse = await cache.get(inverseKeyOf(responseCache))
    const feedIdOf = (entry: unknown) =>
      (entry as { meta?: { metrics?: { feedId?: string } } }).meta?.metrics?.feedId

    t.is(feedIdOf(raw), '{"base":"btc","quote":"usd"}')
    t.is(feedIdOf(inverse), '{"base":"btc","inversion":true,"quote":"usd"}')
    t.not(feedIdOf(raw), feedIdOf(inverse))
  })
})

test.serial('the inverse entry holds the inverted value next to the raw entry', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.setInverseParams('test', [rawParams])
  await responseCache.write('test', [providerResult(rawParams, 4)])

  t.is(((await cache.get(rawKeyOf(responseCache))) as { result: number }).result, 4)
  t.is(((await cache.get(inverseKeyOf(responseCache))) as { result: number }).result, 0.25)
  t.is(
    ((await cache.get(inverseKeyOf(responseCache))) as { data: { result: number } }).data.result,
    0.25,
  )
})

test.serial('with no inverse requested the entries are exactly the raw ones', async (t) => {
  const { responseCache } = buildCache()
  const written: { key: string; value: { result?: number; statusCode?: number } }[] = []
  responseCache.writeEntries = async (entries) => {
    written.push(...(entries as unknown as typeof written))
  }

  await responseCache.write('test', [providerResult(rawParams, 4), providerResult(otherParams, 8)])

  t.is(written.length, 2)
  t.deepEqual(
    written.map((entry) => entry.key),
    [rawKeyOf(responseCache), responseCache.getCacheKey('test', otherParams)],
  )
  t.deepEqual(
    written.map((entry) => entry.value.result),
    [4, 8],
  )
  t.true(written.every((entry) => entry.value.statusCode === 200))
  t.false(written.some((entry) => entry.key.endsWith('-inverse')))
})

test.serial('no inverse variant is written when none is requested', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.write('test', [providerResult(rawParams, 4)])

  t.is(((await cache.get(rawKeyOf(responseCache))) as { result: number }).result, 4)
  t.is(await cache.get(inverseKeyOf(responseCache)), undefined)
})

test.serial('no inverse variant is written without an inverter', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.setInverseParams('test', [rawParams])
  responseCache.invertResponse = undefined
  await responseCache.write('test', [providerResult(rawParams, 4)])

  t.is(await cache.get(inverseKeyOf(responseCache)), undefined)
})

test.serial('an inverse variant is no longer written once it is not requested', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.setInverseParams('test', [rawParams])
  await responseCache.write('test', [providerResult(rawParams, 4)])

  await responseCache.setInverseParams('test', [])
  await responseCache.write('test', [providerResult(rawParams, 5)])

  t.is(((await cache.get(rawKeyOf(responseCache))) as { result: number }).result, 5)
  t.is(((await cache.get(inverseKeyOf(responseCache))) as { result: number }).result, 0.25)
})

test.serial(
  'setInverseParams seeds a newly requested inverse variant from the cached raw value',
  async (t) => {
    const { cache, responseCache } = buildCache()

    await responseCache.write('test', [providerResult(rawParams, 4)])
    t.is(await cache.get(inverseKeyOf(responseCache)), undefined)

    // No new provider result: the seed must come from the cache.
    await responseCache.setInverseParams('test', [rawParams])

    t.is(((await cache.get(inverseKeyOf(responseCache))) as { result: number }).result, 0.25)
    t.is(((await cache.get(rawKeyOf(responseCache))) as { result: number }).result, 4)
  },
)

test.serial('a raw write that lands while seeding wins over the seed', async (t) => {
  const { cache, responseCache } = buildCache()
  const rawKey = rawKeyOf(responseCache)
  const inverseKey = inverseKeyOf(responseCache)

  await responseCache.write('test', [providerResult(rawParams, 4)])

  const originalGet = cache.get.bind(cache)
  const staleCached = await originalGet(rawKey)

  let releaseHeldGet: () => void = () => {}
  let markGetCalled: () => void = () => {}
  const getCalled = new Promise<void>((resolve) => {
    markGetCalled = resolve
  })

  cache.get = (key: string) => {
    if (key !== rawKey) {
      return originalGet(key)
    }
    return new Promise((resolve) => {
      releaseHeldGet = () => resolve(staleCached)
      markGetCalled()
    })
  }

  try {
    const seeding = responseCache.setInverseParams('test', [rawParams])
    // Wait until the seeding path is holding the read of the raw entry.
    await getCalled

    // A fresh raw value lands before the seed can be written.
    await responseCache.write('test', [providerResult(rawParams, 8)])

    // Now let the held read resolve with the stale value.
    releaseHeldGet()
    await seeding
  } finally {
    cache.get = originalGet
  }

  t.is(((await cache.get(rawKey)) as { result: number }).result, 8)
  t.is(((await cache.get(inverseKey)) as { result: number }).result, 1 / 8)
})

test.serial('setInverseParams does not reseed already tracked params', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.setInverseParams('test', [rawParams])
  await responseCache.write('test', [providerResult(rawParams, 4)])

  // Simulate the inverse entry disappearing; a param that is already tracked is not reseeded.
  await cache.delete(inverseKeyOf(responseCache))
  await responseCache.setInverseParams('test', [rawParams])

  t.is(await cache.get(inverseKeyOf(responseCache)), undefined)
})

test.serial('setInverseParams with no inverse requests is a no-op', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.write('test', [providerResult(rawParams, 4)])
  await responseCache.setInverseParams('test', [])

  t.is(await cache.get(inverseKeyOf(responseCache)), undefined)
})

test.serial('writeTTL called with raw params also extends the inverse entry TTL', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.setInverseParams('test', [rawParams])
  await responseCache.write('test', [providerResult(rawParams, 4)])

  const expirationOf = (key: string) =>
    (cache as unknown as LocalCache).cache.get(key)?.data.expirationTimestamp as number

  const rawBefore = expirationOf(rawKeyOf(responseCache))
  const inverseBefore = expirationOf(inverseKeyOf(responseCache))
  const newTtl = adapterSettings.CACHE_MAX_AGE + 100_000

  await responseCache.writeTTL('test', [rawParams], newTtl)

  t.true(expirationOf(rawKeyOf(responseCache)) > rawBefore)
  t.true(expirationOf(inverseKeyOf(responseCache)) > inverseBefore)
  t.true(expirationOf(inverseKeyOf(responseCache)) >= inverseBefore + 100_000)
})

test.serial('a provider error is copied to the inverse entry unchanged', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.setInverseParams('test', [rawParams])
  await responseCache.write('test', [
    {
      params: rawParams,
      response: { statusCode: 429, errorMessage: 'rate limited', timestamps },
    },
  ])

  const raw = await cache.get(rawKeyOf(responseCache))
  const inverse = await cache.get(inverseKeyOf(responseCache))

  t.is((raw as { statusCode: number }).statusCode, 429)
  t.is((inverse as { statusCode: number }).statusCode, 429)
  t.is((inverse as { errorMessage: string }).errorMessage, 'rate limited')
})

test.serial(
  'a resultValidator that throws only on the inverted value keeps the raw entry',
  async (t) => {
    const { cache, responseCache } = buildCache({
      resultValidator: (result) => {
        if ((result.response as { result?: number }).result === 0.25) {
          throw new Error('validator boom')
        }
        return result
      },
    })

    await responseCache.setInverseParams('test', [rawParams])
    await responseCache.write('test', [providerResult(rawParams, 4)])

    const raw = await cache.get(rawKeyOf(responseCache))
    const inverse = (await cache.get(inverseKeyOf(responseCache))) as unknown as
      TimestampedProviderErrorResponse | undefined

    t.is((raw as { result: number }).result, 4)
    t.truthy(inverse)
    t.is(inverse?.statusCode, 502)
    t.true(inverse?.errorMessage?.includes('inverting or validating the result threw'))
  },
)

test.serial('the raw entry is written when the inverter itself throws', async (t) => {
  const { cache, responseCache } = buildCache()
  responseCache.invertResponse = () => {
    throw new Error('invert boom')
  }

  await responseCache.setInverseParams('test', [rawParams])
  await responseCache.write('test', [providerResult(rawParams, 4)])

  const inverse = (await cache.get(inverseKeyOf(responseCache))) as unknown as
    TimestampedProviderErrorResponse | undefined

  t.is(((await cache.get(rawKeyOf(responseCache))) as { result: number }).result, 4)
  t.is(inverse?.statusCode, 502)
  t.true(inverse?.errorMessage?.includes('inverting or validating the result threw'))
})

test.serial('writing N results with an inverse requested calculates exactly N keys', async (t) => {
  const { responseCache } = buildCache()
  await responseCache.setInverseParams('test', [rawParams, otherParams])

  const count = await countCacheKeyCalculations(async () => {
    await responseCache.write('test', [
      providerResult(rawParams, 4),
      providerResult(otherParams, 8),
    ])
  })

  t.is(count, 2)
})

test.serial('writing N results with no inverse requested calculates exactly N keys', async (t) => {
  const { responseCache } = buildCache()

  const count = await countCacheKeyCalculations(async () => {
    await responseCache.write('test', [
      providerResult(rawParams, 4),
      providerResult(otherParams, 8),
    ])
  })

  t.is(count, 2)
})
