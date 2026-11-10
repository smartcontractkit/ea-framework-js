import test from 'ava'
import {
  getInversionConfig,
  getRawInversionConfig,
  hasInversionEnabled,
  InversionPolicy,
  QuoteInversionPolicy,
  SingleValueInversionPolicy,
  stripInversionConfig,
} from '../../src/adapter/inverse'
import { calculateProviderParamsKey } from '../../src/transports/abstract/provider-variants'
import {
  LwbaEndpointInputParametersDefinition,
  LwbaResponseDataFields,
  PriceEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../../src/adapter'
import { AdapterDependencies } from '../../src/adapter/types'
import { Cache, calculateFeedId } from '../../src/cache'
import { SimpleResponseCache } from '../../src/cache/response-cache/simple'
import { buildAdapterSettings } from '../../src/config'
import { metrics } from '../../src/metrics'
import {
  SingleNumberResultResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { AdapterInputError } from '../../src/validation/error'
import { makeStub, MockCache } from '../../src/util/testing-utils'
import { LoggerFactoryProvider } from '../../src/util/logger'
import CensorList from '../../src/util/censor/censor-list'
import { InputParameters } from '../../src/validation'
import { TypeFromDefinition } from '../../src/validation/input-params'

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

type SingleValueGenerics = {
  Parameters: PriceEndpointInputParametersDefinition
  Response: SingleNumberResultResponse
}

type QuoteGenerics = {
  Parameters: LwbaEndpointInputParametersDefinition
  Response: LwbaResponseDataFields
}

const singleValuePolicy = new SingleValueInversionPolicy<SingleValueGenerics>()
const quotePolicy = new QuoteInversionPolicy<QuoteGenerics>()

const timestamps = {
  providerDataRequestedUnixMs: 0,
  providerDataReceivedUnixMs: 0,
  providerIndicatedTimeUnixMs: undefined,
}

const singleValueAttempt = (value: number): TimestampedProviderResult<SingleValueGenerics> => ({
  params: {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true, policyId: 'single-value', policyVersion: 1 },
  } as unknown as TimestampedProviderResult<SingleValueGenerics>['params'],
  response: {
    data: { result: value },
    result: value,
    timestamps,
  },
})

const quoteAttempt = (
  bid: number,
  ask: number,
  mid?: number,
  sizes?: { bidSize?: number | string; askSize?: number | string },
): TimestampedProviderResult<QuoteGenerics> => ({
  params: {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true, policyId: 'lwba', policyVersion: 1 },
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
} => 'errorMessage' in result.response

test('rejects invalid inversion request configs', (t) => {
  for (const config of [
    undefined,
    null,
    true,
    [],
    {},
    { enabled: 'true' },
    { enabled: true, x: 1 },
  ]) {
    t.throws(() => singleValuePolicy.validateRequestConfig(config), {
      instanceOf: AdapterInputError,
    })
  }
})

test('accepts enabled inversion request config', (t) => {
  t.deepEqual(singleValuePolicy.validateRequestConfig({ enabled: true }), { enabled: true })
  t.deepEqual(singleValuePolicy.resolveConfig({ enabled: true }), {
    enabled: true,
    policyId: 'single-value',
    policyVersion: 1,
  })
})

test('single-value policy inverts result and data.result without mutating input', (t) => {
  const input = singleValueAttempt(4)
  const output = singleValuePolicy.transform(input)

  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  t.is((output.response as { result: number }).result, 0.25)
  t.is((output.response as { data: { result: number } }).data.result, 0.25)
  t.is((input.response as { result: number }).result, 4)
  t.is((input.response as { data: { result: number } }).data.result, 4)
})

test('single-value policy rejects invalid raw values', (t) => {
  for (const value of [0, -1, NaN, Infinity]) {
    const output = singleValuePolicy.transform(singleValueAttempt(value))
    t.true(isError(output))
    if (isError(output)) {
      t.is(output.response.statusCode, 502)
    }
  }
})

test('single-value policy leaves provider errors unchanged', (t) => {
  const input: TimestampedProviderResult<SingleValueGenerics> = {
    params: singleValueAttempt(1).params,
    response: {
      statusCode: 502,
      errorMessage: 'provider error',
      timestamps,
    },
  }

  const output = singleValuePolicy.transform(input)
  t.is(output, input)
})

test('policies leave results unchanged when inversion is not enabled', (t) => {
  const singleValue = {
    ...singleValueAttempt(4),
    params: {
      base: 'BTC',
      quote: 'USD',
    } as unknown as TimestampedProviderResult<SingleValueGenerics>['params'],
  }
  t.is(singleValuePolicy.transform(singleValue), singleValue)

  const quote = {
    ...quoteAttempt(1, 1.2, 1.1),
    params: {
      base: 'BTC',
      quote: 'USD',
    } as unknown as TimestampedProviderResult<QuoteGenerics>['params'],
  }
  t.is(quotePolicy.transform(quote), quote)
})

test('policies reject configs resolved for another policy', (t) => {
  const mismatch = singleValueAttempt(4)
  ;(mismatch.params as unknown as { inversion: { policyId: string } }).inversion.policyId = 'lwba'

  const output = singleValuePolicy.transform(mismatch)
  t.true(isError(output))
  if (isError(output)) {
    t.true(output.response.errorMessage.includes('does not match'))
  }
})

test('single-value policy round-trips on double inversion', (t) => {
  const first = singleValuePolicy.transform(singleValueAttempt(3))
  t.is(isError(first), false)
  if (isError(first)) {
    return
  }

  const second = singleValuePolicy.transform(first)
  t.is(isError(second), false)
  if (isError(second)) {
    return
  }

  t.true(Math.abs((second.response as { result: number }).result - 3) < 1e-12)
})

test('quote policy uses provider mid when present', (t) => {
  const output = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1))
  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  const data = (output.response as { data: LwbaResponseDataFields['Data'] }).data
  t.true(Math.abs(data.bid - 1 / 1.2) < 1e-12)
  t.true(Math.abs(data.ask - 1 / 1) < 1e-12)
  t.true(Math.abs(data.mid - 1 / 1.1) < 1e-12)
  t.false('midSource' in data)
})

test('quote policy computes mid when provider mid is absent', (t) => {
  const output = quotePolicy.transform(quoteAttempt(1, 1.2))
  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  const data = (output.response as { data: LwbaResponseDataFields['Data'] }).data
  const expectedMid = (1 / 1.2 + 1 / 1) / 2
  t.true(Math.abs(data.mid - expectedMid) < 1e-12)
  t.false('midSource' in data)
})

test('quote policy swaps auxiliary sizes verbatim without rejecting missing values', (t) => {
  const output = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: 20 }))
  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  const data = (output.response as { data: Record<string, unknown> }).data
  t.is(data['bidSize'], 20)
  t.is(data['askSize'], 10)

  const partial = quotePolicy.transform(
    quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: undefined }),
  )
  t.is(isError(partial), false)
  if (isError(partial)) {
    return
  }

  const partialData = (partial.response as { data: Record<string, unknown> }).data
  t.is(partialData['bidSize'], undefined)
  t.is(partialData['askSize'], 10)

  const strings = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1, { bidSize: '10', askSize: '20' }))
  t.is(isError(strings), false)
  if (isError(strings)) {
    return
  }

  const stringData = (strings.response as { data: Record<string, unknown> }).data
  t.is(stringData['bidSize'], '20')
  t.is(stringData['askSize'], '10')
})

test('quote policy rejects missing, zero, negative, crossed and out-of-range quotes', (t) => {
  for (const attempt of [
    quoteAttempt(0, 1.2, 1.1),
    quoteAttempt(1, -1.2, 1.1),
    quoteAttempt(1.2, 1, 1.1),
    quoteAttempt(1, 1.2, 1.3),
    quoteAttempt(1, 1.2, 0.9),
    quoteAttempt(1, Number.NaN, 1.1),
    quoteAttempt(1, Number.POSITIVE_INFINITY, 1.1),
  ]) {
    const output = quotePolicy.transform(attempt)
    t.true(isError(output))
  }

  const missingBid = quoteAttempt(1, 1.2, 1.1)
  delete (missingBid.response as { data: Record<string, unknown> }).data['bid']
  t.true(isError(quotePolicy.transform(missingBid)))

  for (const data of [undefined, null, [], 'quote']) {
    const attempt = quoteAttempt(1, 1.2, 1.1)
    ;(attempt.response as { data: unknown }).data = data
    t.true(isError(quotePolicy.transform(attempt)))
  }
})

test('quote policy is atomic across bid, mid and ask', (t) => {
  const valid = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1))
  t.is(isError(valid), false)
  if (!isError(valid)) {
    const data = (valid.response as { data: LwbaResponseDataFields['Data'] }).data
    t.true(Math.abs(data.bid - 1 / 1.2) < 1e-12)
    t.true(Math.abs(data.ask - 1 / 1) < 1e-12)
    t.true(Math.abs(data.mid - 1 / 1.1) < 1e-12)
  }

  const input = quoteAttempt(1, 1.2, 1.3)
  const invalid = quotePolicy.transform(input)
  t.true(isError(invalid))
  if (isError(invalid)) {
    t.false('data' in invalid.response)
    t.false('result' in invalid.response)
  }

  const originalData = (input.response as { data: LwbaResponseDataFields['Data'] }).data
  t.is(originalData.bid, 1)
  t.is(originalData.ask, 1.2)
  t.is(originalData.mid, 1.3)
})

test('quote policy leaves input unchanged', (t) => {
  const input = quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: 20 })
  quotePolicy.transform(input)

  const data = (input.response as { data: LwbaResponseDataFields['Data'] }).data
  t.is(data.bid, 1)
  t.is(data.ask, 1.2)
  t.is(data.mid, 1.1)

  const rawData = data as unknown as Record<string, unknown>
  t.is(rawData['bidSize'], 10)
  t.is(rawData['askSize'], 20)
})

test('inversion params are stripped for provider grouping', (t) => {
  const raw = { base: 'BTC', quote: 'USD' }
  const inverse = {
    ...raw,
    inversion: { enabled: true, policyId: 'single-value', policyVersion: 1 },
  }

  const stripped = stripInversionConfig(inverse)
  t.not(stripped, inverse)
  t.deepEqual(stripped, raw)
  t.deepEqual(inverse.inversion, {
    enabled: true,
    policyId: 'single-value',
    policyVersion: 1,
  })
  t.is(calculateProviderParamsKey(raw), calculateProviderParamsKey(inverse))
  t.deepEqual(getInversionConfig(inverse), inverse.inversion)
  t.is(getInversionConfig(raw), undefined)
})

test('inversion config detection is safe for Proxy-based test doubles', (t) => {
  const params = makeStub('params', { base: 'BTC', quote: 'USD' })

  t.notThrows(() => getInversionConfig(params))
  t.notThrows(() => hasInversionEnabled(params))
  t.is(getRawInversionConfig(params), undefined)
  t.is(getInversionConfig(params), undefined)
  t.false(hasInversionEnabled(params))
  t.is(stripInversionConfig(params as Record<string, unknown>), params)
})

test('raw config presence is distinct from resolved policy metadata', (t) => {
  const malformed = {
    base: 'BTC',
    quote: 'USD',
    inversion: { enabled: true },
  }

  t.true(hasInversionEnabled(malformed))
  t.deepEqual(getRawInversionConfig(malformed), {
    enabled: true,
    policyId: undefined,
    policyVersion: undefined,
  })
  t.is(getInversionConfig(malformed), undefined)
  t.false(hasInversionEnabled({ ...malformed, inversion: { enabled: false } }))
  t.is(getInversionConfig({ ...malformed, inversion: { enabled: false } }), undefined)
})

test('policies reject malformed or missing policy metadata with 502', (t) => {
  const singleValue = {
    ...singleValueAttempt(4),
    params: {
      base: 'BTC',
      quote: 'USD',
      inversion: { enabled: true },
    } as unknown as TimestampedProviderResult<SingleValueGenerics>['params'],
  }
  const singleOutput = singleValuePolicy.transform(singleValue)
  t.true(isError(singleOutput))
  if (isError(singleOutput)) {
    t.is(singleOutput.response.statusCode, 502)
    t.true(singleOutput.response.errorMessage.includes('missing or invalid'))
  }

  const quote = {
    ...quoteAttempt(1, 1.2, 1.1),
    params: {
      base: 'BTC',
      quote: 'USD',
      inversion: { enabled: true, policyId: 'lwba' },
    } as unknown as TimestampedProviderResult<QuoteGenerics>['params'],
  }
  const quoteOutput = quotePolicy.transform(quote)
  t.true(isError(quoteOutput))
  if (isError(quoteOutput)) {
    t.is(quoteOutput.response.statusCode, 502)
    t.true(quoteOutput.response.errorMessage.includes('missing or invalid'))
  }
})

test('quote policy round-trips on double inversion, including sizes', (t) => {
  const first = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: 20 }))
  t.is(isError(first), false)
  if (isError(first)) {
    return
  }

  const second = quotePolicy.transform(first)
  t.is(isError(second), false)
  if (isError(second)) {
    return
  }

  const data = (second.response as { data: Record<string, number> }).data
  t.true(Math.abs(data['bid'] - 1) < 1e-12)
  t.true(Math.abs(data['ask'] - 1.2) < 1e-12)
  t.true(Math.abs(data['mid'] - 1.1) < 1e-12)
  t.is(data['bidSize'], 10)
  t.is(data['askSize'], 20)
})

test('quote policy handles null/string mid, missing ask and boundary quotes', (t) => {
  const nullMid = quotePolicy.transform(quoteAttempt(1, 1.2, null as unknown as number))
  t.is(isError(nullMid), false)
  if (!isError(nullMid)) {
    const data = (nullMid.response as { data: LwbaResponseDataFields['Data'] }).data
    t.true(Math.abs(data.mid - (1 / 1.2 + 1) / 2) < 1e-12)
  }

  const stringMid = quotePolicy.transform(quoteAttempt(1, 1.2, '1.1' as unknown as number))
  t.true(isError(stringMid))

  const missingAsk = quoteAttempt(1, 1.2, 1.1)
  delete (missingAsk.response as { data: Record<string, unknown> }).data['ask']
  t.true(isError(quotePolicy.transform(missingAsk)))

  const equalBidAsk = quotePolicy.transform(quoteAttempt(2, 2, 2))
  t.is(isError(equalBidAsk), false)
  if (!isError(equalBidAsk)) {
    const data = (equalBidAsk.response as { data: LwbaResponseDataFields['Data'] }).data
    t.is(data.bid, 0.5)
    t.is(data.ask, 0.5)
    t.is(data.mid, 0.5)
  }

  for (const mid of [1, 1.2]) {
    const output = quotePolicy.transform(quoteAttempt(1, 1.2, mid))
    t.is(isError(output), false)
  }
})

test('single-value policy tolerates a missing top-level result and extreme values', (t) => {
  const missingTopLevel = singleValueAttempt(4)
  delete (missingTopLevel.response as { result?: number }).result
  const output = singleValuePolicy.transform(missingTopLevel)
  t.is(isError(output), false)
  if (!isError(output)) {
    t.is((output.response as { result: number }).result, 0.25)
    t.is((output.response as { data: { result: number } }).data.result, 0.25)
  }

  const huge = singleValuePolicy.transform(singleValueAttempt(Number.MAX_VALUE))
  t.is(isError(huge), false)
  if (!isError(huge)) {
    t.true((huge.response as { result: number }).result > 0)
  }

  t.true(isError(singleValuePolicy.transform(singleValueAttempt(Number.MIN_VALUE))))
})

test('single-value policy rejects missing or malformed data', (t) => {
  for (const makeAttempt of [
    () => {
      const attempt = singleValueAttempt(4)
      delete (attempt.response as { data?: unknown }).data
      return attempt
    },
    () => {
      const attempt = singleValueAttempt(4)
      ;(attempt.response as { data: unknown }).data = [4]
      return attempt
    },
    () => {
      const attempt = singleValueAttempt(4)
      ;(attempt.response as { data: unknown }).data = '4'
      return attempt
    },
    () => {
      const attempt = singleValueAttempt(4)
      ;(attempt.response as { data: Record<string, unknown> }).data['result'] = null
      return attempt
    },
    () => {
      const attempt = singleValueAttempt(4)
      delete (attempt.response as { data: Record<string, unknown> }).data['result']
      return attempt
    },
    () => {
      const attempt = singleValueAttempt(4)
      ;(attempt.response as { data: Record<string, unknown> }).data['result'] = '4'
      return attempt
    },
  ]) {
    t.true(isError(singleValuePolicy.transform(makeAttempt())))
  }
})

const inputParameters = new InputParameters(priceEndpointInputParametersDefinition)
const adapterSettings = buildAdapterSettings({})

type CacheParams = TypeFromDefinition<SingleValueGenerics['Parameters']>

const resolvedConfig = {
  enabled: true,
  policyId: 'single-value',
  policyVersion: 1,
}

const rawParams = { base: 'BTC', quote: 'USD' } as CacheParams
const inverseParams = {
  ...rawParams,
  inversion: resolvedConfig,
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

class CapturingSimpleResponseCache extends SimpleResponseCache<SingleValueGenerics> {
  captured?: TimestampedProviderResult<SingleValueGenerics>[]

  protected override async _write(
    transportName: string,
    results: TimestampedProviderResult<SingleValueGenerics>[],
  ): Promise<void> {
    this.captured = results
    return super._write(transportName, results)
  }
}

const buildCache = ({
  policy,
  resultValidator,
}: {
  policy?: InversionPolicy<SingleValueGenerics>
  resultValidator?: (
    result: TimestampedProviderResult<SingleValueGenerics>,
  ) => TimestampedProviderResult<SingleValueGenerics>
} = {}) => {
  const cache = new MockCache(adapterSettings.CACHE_MAX_ITEMS)
  const responseCache = new CapturingSimpleResponseCache({
    dependencies: { cache } as unknown as AdapterDependencies,
    adapterSettings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters,
  })
  responseCache.inversionPolicy = policy ?? new SingleValueInversionPolicy<SingleValueGenerics>()
  if (resultValidator) {
    responseCache.resultValidator = resultValidator
  }
  return { cache, responseCache }
}

test.serial(
  'no inversion keeps the raw cache key, feed ID, array and objects unchanged',
  async (t) => {
    const { responseCache } = buildCache()
    const results = [providerResult(rawParams, 4)]

    t.is(
      responseCache.getCacheKey('test', rawParams),
      'TEST-test-test-{"base":"btc","quote":"usd"}',
    )
    t.is(calculateFeedId({ adapterSettings }, rawParams), '{"base":"btc","quote":"usd"}')
    t.not(
      responseCache.getCacheKey('test', inverseParams),
      responseCache.getCacheKey('test', rawParams),
    )
    t.not(
      calculateFeedId({ adapterSettings }, inverseParams),
      calculateFeedId({ adapterSettings }, rawParams),
    )

    await responseCache.write('test', results)

    t.is(responseCache.captured, results)
    t.is(responseCache.captured?.[0], results[0])
  },
)

test.serial('no inversion does not call the inversion policy', async (t) => {
  let calls = 0
  const basePolicy = new SingleValueInversionPolicy<SingleValueGenerics>()
  const policy: InversionPolicy<SingleValueGenerics> = {
    id: basePolicy.id,
    version: basePolicy.version,
    validateRequestConfig: (config) => basePolicy.validateRequestConfig(config),
    resolveConfig: (config) => basePolicy.resolveConfig(config),
    transform: (result) => {
      calls += 1
      return basePolicy.transform(result)
    },
  }
  const { responseCache } = buildCache({ policy })

  await responseCache.write('test', [providerResult(rawParams, 4)])

  t.is(calls, 0)
})

test.serial('mixed batches only invert configured results', async (t) => {
  const { cache, responseCache } = buildCache()

  await responseCache.write('test', [
    providerResult(rawParams, 4),
    providerResult(inverseParams, 4),
  ])

  t.is(responseCache.captured?.length, 2)
  t.is((responseCache.captured?.[0].response as { result: number }).result, 4)
  t.is((responseCache.captured?.[1].response as { result: number }).result, 0.25)

  const rawCached = await cache.get(responseCache.getCacheKey('test', rawParams))
  const inverseCached = await cache.get(responseCache.getCacheKey('test', inverseParams))
  t.is((rawCached as { result: number }).result, 4)
  t.is((inverseCached as { result: number }).result, 0.25)
})

test.serial('malformed or mismatched policy metadata is written as a 502', async (t) => {
  const { cache, responseCache } = buildCache()

  for (const params of [
    { ...rawParams, inversion: { enabled: true } },
    { ...rawParams, inversion: { ...resolvedConfig, policyVersion: 2 } },
    { ...rawParams, inversion: { ...resolvedConfig, policyId: 'other' } },
  ] as unknown as CacheParams[]) {
    await responseCache.write('test', [providerResult(params, 4)])

    const response = responseCache.captured?.[0].response
    t.true(response !== undefined && 'errorMessage' in response)
    if (response && 'errorMessage' in response) {
      const errorResponse = response as TimestampedProviderErrorResponse
      t.is(errorResponse.statusCode, 502)
      t.true(errorResponse.errorMessage.includes('Inversion failed'))
    }

    const cached = await cache.get(responseCache.getCacheKey('test', params))
    t.is((cached as { statusCode: number }).statusCode, 502)
  }
})

test.serial('a throwing policy is converted to a 502 and does not reject the write', async (t) => {
  const basePolicy = new SingleValueInversionPolicy<SingleValueGenerics>()

  for (const thrown of [new Error('boom'), 'boom-string']) {
    const throwingPolicy: InversionPolicy<SingleValueGenerics> = {
      id: basePolicy.id,
      version: basePolicy.version,
      validateRequestConfig: (config) => basePolicy.validateRequestConfig(config),
      resolveConfig: (config) => basePolicy.resolveConfig(config),
      transform: () => {
        throw thrown
      },
    }
    const { responseCache } = buildCache({ policy: throwingPolicy })

    await t.notThrowsAsync(() => responseCache.write('test', [providerResult(inverseParams, 4)]))

    const response = responseCache.captured?.[0].response
    t.true(response !== undefined && 'errorMessage' in response)
    if (response && 'errorMessage' in response) {
      const errorResponse = response as TimestampedProviderErrorResponse
      t.is(errorResponse.statusCode, 502)
      t.true(errorResponse.errorMessage.includes('policy transform threw'))
      t.true(errorResponse.errorMessage.includes('boom'))
    }
  }
})

test.serial('resultValidator runs after inversion', async (t) => {
  const seen: number[] = []
  const { responseCache } = buildCache({
    resultValidator: (result) => {
      if (!('errorMessage' in result.response)) {
        seen.push(result.response.result as number)
      }
      return result
    },
  })

  await responseCache.write('test', [providerResult(inverseParams, 4)])

  t.deepEqual(seen, [0.25])
})

test.serial('writeTTL extends distinct raw and inverse cache keys', async (t) => {
  const ttlCalls: { key: string; ttl: number }[] = []
  const cache = {
    setTTL: async (key: string, ttl: number) => {
      ttlCalls.push({ key, ttl })
    },
  } as unknown as Cache
  const responseCache = new CapturingSimpleResponseCache({
    dependencies: { cache } as unknown as AdapterDependencies,
    adapterSettings,
    adapterName: 'TEST',
    endpointName: 'test',
    inputParameters,
  })

  await responseCache.writeTTL('test', [rawParams, inverseParams, rawParams], 123)

  t.deepEqual(ttlCalls, [
    { key: responseCache.getCacheKey('test', rawParams), ttl: 123 },
    { key: responseCache.getCacheKey('test', inverseParams), ttl: 123 },
    { key: responseCache.getCacheKey('test', rawParams), ttl: 123 },
  ])
  t.not(ttlCalls[0].key, ttlCalls[1].key)
})

test.serial('writes fail closed when inversion is requested but no policy exists', async (t) => {
  const { responseCache } = buildCache()
  responseCache.inversionPolicy = undefined

  await responseCache.write('test', [providerResult(inverseParams, 4)])

  const response = responseCache.captured?.[0].response
  t.true(response !== undefined && 'errorMessage' in response)
  if (response && 'errorMessage' in response) {
    const errorResponse = response as TimestampedProviderErrorResponse
    t.is(errorResponse.statusCode, 502)
    t.true(errorResponse.errorMessage.includes('no inversion policy'))
  }
})

test.serial('proxy-based result params do not throw when inversion is absent', async (t) => {
  const { responseCache } = buildCache()
  const stubParams = makeStub('params', { base: 'BTC', quote: 'USD' }) as CacheParams

  await t.notThrowsAsync(() => responseCache.write('test', [providerResult(stubParams, 4)]))
})

test('provider param keys are case-insensitive like cache keys', (t) => {
  t.is(
    calculateProviderParamsKey({ base: 'BTC', quote: 'USD' }),
    calculateProviderParamsKey({ base: 'btc', quote: 'usd' }),
  )
})

test('provider param keys sort arrays and nested objects deterministically', (t) => {
  const first = {
    base: 'BTC',
    quote: 'USD',
    filters: [1, 2, 3],
    nested: { b: 2, a: 1 },
  }
  const second = {
    nested: { a: 1, b: 2 },
    filters: [1, 2, 3],
    quote: 'USD',
    base: 'BTC',
  }

  t.is(calculateProviderParamsKey(first), calculateProviderParamsKey(second))
})

test('provider param keys handle __proto__ without prototype pollution', (t) => {
  const params = JSON.parse('{"base":"BTC","__proto__":{"polluted":true}}') as Record<
    string,
    unknown
  >

  const key = calculateProviderParamsKey(params)
  t.true(key.includes('__proto__'))
  t.is(({} as { polluted?: boolean }).polluted, undefined)
})

test('policies return 502 when the response cannot be cloned', (t) => {
  const single = singleValueAttempt(4)
  ;(single.response as { data: Record<string, unknown> }).data['self'] = single.response.data
  const singleOutput = singleValuePolicy.transform(single)
  t.true(isError(singleOutput))
  if (isError(singleOutput)) {
    t.is(singleOutput.response.statusCode, 502)
    t.true(singleOutput.response.errorMessage.includes('could not be cloned'))
  }

  const quote = quoteAttempt(1, 1.2, 1.1)
  ;(quote.response as { data: Record<string, unknown> }).data['self'] = quote.response.data
  const quoteOutput = quotePolicy.transform(quote)
  t.true(isError(quoteOutput))
  if (isError(quoteOutput)) {
    t.is(quoteOutput.response.statusCode, 502)
    t.true(quoteOutput.response.errorMessage.includes('could not be cloned'))
  }
})

test('quote policy leaves provider errors unchanged', (t) => {
  const input: TimestampedProviderResult<QuoteGenerics> = {
    params: quoteAttempt(1, 1.2, 1.1).params,
    response: {
      statusCode: 502,
      errorMessage: 'provider error',
      timestamps,
    },
  }

  t.is(quotePolicy.transform(input), input)
})

test('quote policy rejects invalid quotes when provider mid is absent', (t) => {
  for (const attempt of [
    quoteAttempt(0, 1.2),
    quoteAttempt(1, -1.2),
    quoteAttempt(1.2, 1),
    quoteAttempt(Number.NaN, 1.2),
    quoteAttempt(1, Number.POSITIVE_INFINITY),
  ]) {
    t.true(isError(quotePolicy.transform(attempt)))
  }
})

test('raw inversion config rejects non-object and malformed values', (t) => {
  for (const params of [
    null,
    'inversion',
    [],
    { inversion: 'enabled' },
    { inversion: {} },
    { inversion: { enabled: 'true' } },
  ]) {
    t.is(getRawInversionConfig(params), undefined)
  }

  const infiniteVersion = {
    inversion: { enabled: true, policyId: 'single-value', policyVersion: Number.POSITIVE_INFINITY },
  }
  t.truthy(getRawInversionConfig(infiniteVersion))
  t.is(getInversionConfig(infiniteVersion), undefined)
})

test.serial('thrown policy errors are redacted with the censor list', async (t) => {
  const previous = CensorList.getAll()
  CensorList.set([{ key: 'SECRET', value: /super-secret/g }])

  try {
    const basePolicy = new SingleValueInversionPolicy<SingleValueGenerics>()
    const policy: InversionPolicy<SingleValueGenerics> = {
      id: basePolicy.id,
      version: basePolicy.version,
      validateRequestConfig: (config) => basePolicy.validateRequestConfig(config),
      resolveConfig: (config) => basePolicy.resolveConfig(config),
      transform: () => {
        throw new Error('boom super-secret')
      },
    }
    const { responseCache } = buildCache({ policy })

    await responseCache.write('test', [providerResult(inverseParams, 4)])

    const response = responseCache.captured?.[0].response
    t.true(response !== undefined && 'errorMessage' in response)
    if (response && 'errorMessage' in response) {
      const errorResponse = response as TimestampedProviderErrorResponse
      t.true(errorResponse.errorMessage.includes('boom'))
      t.true(errorResponse.errorMessage.includes('[SECRET REDACTED]'))
      t.false(errorResponse.errorMessage.includes('super-secret'))
    }
  } finally {
    CensorList.set(previous)
  }
})

test.serial('inversionTotal counts applied and rejected results', async (t) => {
  const counter = metrics.get('inversionTotal') as unknown as {
    reset: () => void
    get: () => Promise<{
      values: { labels: Record<string, string>; value: number }[]
    }>
  }
  counter.reset()

  const { responseCache } = buildCache()
  const malformedParams = {
    ...rawParams,
    inversion: { enabled: true },
  } as unknown as CacheParams

  await responseCache.write('test', [
    providerResult(rawParams, 4),
    providerResult(inverseParams, 4),
    providerResult(malformedParams, 4),
  ])

  const values = (await counter.get()).values
  const applied = values.find((value) => value.labels['status'] === 'applied')?.value
  const rejected = values.find((value) => value.labels['status'] === 'rejected')?.value

  t.is(applied, 1)
  t.is(rejected, 1)
  t.true(
    values.every(
      (value) =>
        value.labels['adapter_endpoint'] === 'test' && value.labels['policy'] === 'single-value',
    ),
  )
})
