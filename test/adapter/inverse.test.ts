import test from 'ava'
import {
  hasInversionEnabled,
  InversionTransform,
  invertQuote,
  invertSingleValue,
  validateInversionRequestConfig,
} from '../../src/adapter/inverse'
import {
  LwbaEndpointInputParametersDefinition,
  LwbaResponseDataFields,
  PriceEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { calculateFeedId } from '../../src/cache'
import { SimpleResponseCache } from '../../src/cache/response-cache/simple'
import { buildAdapterSettings } from '../../src/config'
import {
  SingleNumberResultResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { AdapterInputError } from '../../src/validation/error'
import { MockCache } from '../../src/util/testing-utils'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { InputParameters } from '../../src/validation'
import { TypeFromDefinition } from '../../src/validation/input-params'

test.before(() => {
  LoggerFactoryProvider.set()
})

type SingleValueGenerics = {
  Parameters: PriceEndpointInputParametersDefinition
  Response: SingleNumberResultResponse
}

type QuoteGenerics = {
  Parameters: LwbaEndpointInputParametersDefinition
  Response: LwbaResponseDataFields
}

const timestamps = {
  providerDataRequestedUnixMs: 0,
  providerDataReceivedUnixMs: 0,
  providerIndicatedTimeUnixMs: undefined,
}

const singleValueAttempt = (
  value: number,
  params?: Record<string, unknown>,
): TimestampedProviderResult<SingleValueGenerics> => ({
  params: (params ?? {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  }) as unknown as TimestampedProviderResult<SingleValueGenerics>['params'],
  response: {
    data: { result: value },
    result: value,
    timestamps,
  },
})

const quoteAttempt = (
  bid: number,
  ask: number,
  mid?: number | null,
  sizes?: { bidSize?: number; askSize?: number },
): TimestampedProviderResult<QuoteGenerics> => ({
  params: {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  } as unknown as TimestampedProviderResult<QuoteGenerics>['params'],
  response: {
    result: null,
    data: {
      bid,
      ask,
      ...(mid === undefined ? {} : { mid }),
      ...sizes,
    } as unknown as LwbaResponseDataFields['Data'],
    timestamps,
  },
})

const isError = (
  result: TimestampedProviderResult<SingleValueGenerics> | TimestampedProviderResult<QuoteGenerics>,
): result is TimestampedProviderResult<SingleValueGenerics> & {
  response: TimestampedProviderErrorResponse
} => Boolean(result.response.errorMessage)

test('inversion request config accepts only an enabled boolean', (t) => {
  for (const config of [
    undefined,
    null,
    true,
    [],
    {},
    { enabled: 'true' },
    { enabled: true, unexpected: true },
  ]) {
    t.throws(() => validateInversionRequestConfig(config), {
      instanceOf: AdapterInputError,
    })
  }

  t.deepEqual(validateInversionRequestConfig({ enabled: true }), { enabled: true })
  t.deepEqual(validateInversionRequestConfig({ enabled: false }), { enabled: false })
})

test('single-value inversion inverts result and data.result without mutating input', (t) => {
  const input = singleValueAttempt(4)
  const output = invertSingleValue(input)

  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  t.is((output.response as { result: number }).result, 0.25)
  t.is((output.response as { data: { result: number } }).data.result, 0.25)
  t.is((input.response as { result: number }).result, 4)
  t.is((input.response as { data: { result: number } }).data.result, 4)
})

test('single-value inversion rejects invalid, overflow and malformed results with 502', (t) => {
  const attempts = [
    singleValueAttempt(0),
    singleValueAttempt(-1),
    singleValueAttempt(Number.NaN),
    singleValueAttempt(Number.POSITIVE_INFINITY),
    singleValueAttempt(Number.MIN_VALUE),
  ]

  const missingData = singleValueAttempt(4)
  delete (missingData.response as { data?: unknown }).data
  attempts.push(missingData)

  const nullResult = singleValueAttempt(4)
  ;(nullResult.response as { data: Record<string, unknown> }).data['result'] = null
  attempts.push(nullResult)

  const stringResult = singleValueAttempt(4)
  ;(stringResult.response as { data: Record<string, unknown> }).data['result'] = '4'
  attempts.push(stringResult)

  for (const attempt of attempts) {
    const output = invertSingleValue(attempt)
    t.true(isError(output))
    if (isError(output)) {
      t.is(output.response.statusCode, 502)
    }
  }
})

test('inversion transforms leave provider errors unchanged', (t) => {
  const singleInput: TimestampedProviderResult<SingleValueGenerics> = {
    params: singleValueAttempt(1).params,
    response: {
      statusCode: 502,
      errorMessage: 'provider error',
      timestamps,
    },
  }
  const quoteInput: TimestampedProviderResult<QuoteGenerics> = {
    params: quoteAttempt(1, 1.2, 1.1).params,
    response: {
      statusCode: 502,
      errorMessage: 'provider error',
      timestamps,
    },
  }

  t.is(invertSingleValue(singleInput), singleInput)
  t.is(invertQuote(quoteInput), quoteInput)
})

test('quote inversion inverts provider mid, synthesizes missing mid and swaps sizes', (t) => {
  const withMid = invertQuote(quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: 20 }))
  t.is(isError(withMid), false)
  if (isError(withMid)) {
    return
  }
  const data = (withMid.response as { data: Record<string, unknown> }).data
  t.true(Math.abs((data['bid'] as number) - 1 / 1.2) < 1e-12)
  t.true(Math.abs((data['ask'] as number) - 1) < 1e-12)
  t.true(Math.abs((data['mid'] as number) - 1 / 1.1) < 1e-12)
  t.is(data['bidSize'], 20)
  t.is(data['askSize'], 10)
  t.false('midSource' in data)

  for (const mid of [undefined, null]) {
    const synthesized = invertQuote(quoteAttempt(1, 1.2, mid))
    t.is(isError(synthesized), false)
    if (!isError(synthesized)) {
      const synthesizedData = (synthesized.response as { data: LwbaResponseDataFields['Data'] })
        .data
      t.true(Math.abs(synthesizedData.mid - (1 / 1.2 + 1) / 2) < 1e-12)
    }
  }

  const equalBidAsk = invertQuote(quoteAttempt(2, 2, 2))
  t.is(isError(equalBidAsk), false)
  if (!isError(equalBidAsk)) {
    const equalData = (equalBidAsk.response as { data: LwbaResponseDataFields['Data'] }).data
    t.is(equalData.bid, 0.5)
    t.is(equalData.ask, 0.5)
    t.is(equalData.mid, 0.5)
  }

  // TP example: invert the quote, not just the mid.
  const tp = invertQuote(quoteAttempt(1.36, 1.37, 1.365))
  t.is(isError(tp), false)
  if (!isError(tp)) {
    const tpData = (tp.response as { data: LwbaResponseDataFields['Data'] }).data
    t.true(Math.abs(tpData.bid - 1 / 1.37) < 1e-12)
    t.true(Math.abs(tpData.ask - 1 / 1.36) < 1e-12)
    t.true(Math.abs(tpData.mid - 1 / 1.365) < 1e-12)
  }
})

test('quote inversion rejects invalid quotes and overflow with 502', (t) => {
  const missingAsk = quoteAttempt(1, 1.2, 1.1)
  delete (missingAsk.response as { data: Record<string, unknown> }).data['ask']

  const malformedData = quoteAttempt(1, 1.2, 1.1)
  ;(malformedData.response as { data: unknown }).data = 'quote'

  const cases: [string, TimestampedProviderResult<QuoteGenerics>][] = [
    ['zero bid', quoteAttempt(0, 1.2, 1.1)],
    ['negative ask', quoteAttempt(1, -1.2, 1.1)],
    ['crossed bid/ask', quoteAttempt(1.2, 1, 1.1)],
    ['mid above ask', quoteAttempt(1, 1.2, 1.3)],
    ['mid below bid', quoteAttempt(1, 1.2, 0.9)],
    ['non-finite ask', quoteAttempt(1, Number.NaN, 1.1)],
    ['infinite bid', quoteAttempt(Number.POSITIVE_INFINITY, 1.2, 1.1)],
    ['overflowing inverse', quoteAttempt(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE)],
    ['missing ask', missingAsk],
    ['non-object data', malformedData],
    ['crossed without mid', quoteAttempt(1.2, 1)],
    ['non-finite without mid', quoteAttempt(Number.NaN, 1.2)],
  ]

  for (const [name, attempt] of cases) {
    const output = invertQuote(attempt)
    t.true(isError(output), name)
    if (isError(output)) {
      t.is(output.response.statusCode, 502, name)
    }
  }
})

const inputParameters = new InputParameters(priceEndpointInputParametersDefinition)
const adapterSettings = buildAdapterSettings({})

type CacheParams = TypeFromDefinition<SingleValueGenerics['Parameters']>

const rawParams = { base: 'BTC', quote: 'USD' } as CacheParams
const inverseParams = {
  ...rawParams,
  inversion: { enabled: true },
} as unknown as CacheParams

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
  transform,
  resultValidator,
}: {
  transform?: InversionTransform<SingleValueGenerics>
  resultValidator?: (
    result: TimestampedProviderResult<SingleValueGenerics>,
  ) => TimestampedProviderResult<SingleValueGenerics>
} = {}) => {
  const cache = new MockCache(adapterSettings.CACHE_MAX_ITEMS)
  const responseCache = new SimpleResponseCache<SingleValueGenerics>({
    dependencies: { cache } as unknown as AdapterDependencies,
    adapterSettings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters,
  })
  responseCache.inversionTransform = transform ?? invertSingleValue<SingleValueGenerics>
  if (resultValidator) {
    responseCache.resultValidator = resultValidator
  }
  return { cache, responseCache }
}

test.serial('no inversion preserves the raw cache key, feed ID and value', async (t) => {
  const { responseCache, cache } = buildCache()
  const rawKey = responseCache.getCacheKey('test', rawParams)

  t.is(rawKey, 'TEST-test-test-{"base":"btc","quote":"usd"}')
  t.is(calculateFeedId({ adapterSettings }, rawParams), '{"base":"btc","quote":"usd"}')
  t.not(rawKey, responseCache.getCacheKey('test', inverseParams))
  t.not(
    calculateFeedId({ adapterSettings }, rawParams),
    calculateFeedId({ adapterSettings }, inverseParams),
  )

  await responseCache.write('test', [providerResult(rawParams, 4)])

  t.is(((await cache.get(rawKey)) as { result: number }).result, 4)
})

test.serial('mixed batches only invert configured results', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.write('test', [
    providerResult(rawParams, 4),
    providerResult(inverseParams, 4),
  ])

  const rawCached = await cache.get(responseCache.getCacheKey('test', rawParams))
  const inverseCached = await cache.get(responseCache.getCacheKey('test', inverseParams))
  t.is((rawCached as { result: number }).result, 4)
  t.is((inverseCached as { result: number }).result, 0.25)
})

test.serial('inversion failures reject only the inverse variant', async (t) => {
  const scenarios: {
    name: string
    configure?: (responseCache: SimpleResponseCache<SingleValueGenerics>) => void
    makeInverse?: () => TimestampedProviderResult<SingleValueGenerics>
    expectedMessage: string
  }[] = [
    {
      name: 'no transform',
      configure: (responseCache) => {
        responseCache.inversionTransform = undefined
      },
      expectedMessage: 'no inversion transform',
    },
    {
      name: 'clone failure',
      makeInverse: () => {
        const result = providerResult(inverseParams, 4)
        ;(result.response as Record<string, unknown>)['self'] = result.response
        return result
      },
      expectedMessage: 'could not be cloned',
    },
    {
      name: 'validator throw',
      configure: (responseCache) => {
        responseCache.resultValidator = (result) => {
          if (hasInversionEnabled(result.params)) {
            throw new Error('validator boom')
          }
          return result
        }
      },
      expectedMessage: 'validator boom',
    },
  ]

  for (const scenario of scenarios) {
    const { cache, responseCache } = buildCache()
    scenario.configure?.(responseCache)
    const inverseResult = scenario.makeInverse?.() ?? providerResult(inverseParams, 4)

    await responseCache.write('test', [providerResult(rawParams, 4), inverseResult])

    const rawCached = await cache.get(responseCache.getCacheKey('test', rawParams))
    const inverseCached = await cache.get(responseCache.getCacheKey('test', inverseParams))

    t.is((rawCached as { result: number }).result, 4, scenario.name)
    t.is((inverseCached as { statusCode: number }).statusCode, 502, scenario.name)
    t.true(
      (inverseCached as { errorMessage: string }).errorMessage.includes(scenario.expectedMessage),
      scenario.name,
    )
  }
})
