import test from 'ava'
import {
  calculateProviderParamsKey,
  getInversionConfig,
  QuoteInversionPolicy,
  SingleValueInversionPolicy,
  stripInversionConfig,
} from '../../src/adapter/inverse'
import {
  LwbaEndpointInputParametersDefinition,
  LwbaResponseDataFields,
  PriceEndpointInputParametersDefinition,
} from '../../src/adapter'
import {
  SingleNumberResultResponse,
  TimestampedProviderErrorResponse,
  TimestampedProviderResult,
} from '../../src/util'
import { AdapterInputError } from '../../src/validation/error'
import { LoggerFactoryProvider } from '../../src/util/logger'

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

test('quote policy preserves and updates midSource only when present', (t) => {
  const attempt = quoteAttempt(1, 1.2, 1.1)
  const inputData = (attempt.response as { data: Record<string, unknown> }).data
  inputData['midSource'] = 'computed'

  const output = quotePolicy.transform(attempt)
  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  const data = (output.response as { data: Record<string, unknown> }).data
  t.is(data['midSource'], 'provider')
})

test('quote policy swaps auxiliary sizes verbatim without rejecting missing values', (t) => {
  const output = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: 20 }))
  t.is(isError(output), false)
  if (isError(output)) {
    return
  }

  const data = (output.response as { data: LwbaResponseDataFields['Data'] }).data
  t.is(data.bidSize, 20)
  t.is(data.askSize, 10)

  const partial = quotePolicy.transform(
    quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: undefined }),
  )
  t.is(isError(partial), false)
  if (isError(partial)) {
    return
  }

  const partialData = (partial.response as { data: LwbaResponseDataFields['Data'] }).data
  t.is(partialData.bidSize, undefined)
  t.is(partialData.askSize, 10)

  const strings = quotePolicy.transform(quoteAttempt(1, 1.2, 1.1, { bidSize: '10', askSize: '20' }))
  t.is(isError(strings), false)
  if (isError(strings)) {
    return
  }

  const stringData = (strings.response as { data: LwbaResponseDataFields['Data'] }).data
  t.is(stringData.bidSize, '20')
  t.is(stringData.askSize, '10')
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
})

test('quote policy leaves input unchanged', (t) => {
  const input = quoteAttempt(1, 1.2, 1.1, { bidSize: 10, askSize: 20 })
  quotePolicy.transform(input)

  const data = (input.response as { data: LwbaResponseDataFields['Data'] }).data
  t.is(data.bid, 1)
  t.is(data.ask, 1.2)
  t.is(data.mid, 1.1)
  t.is(data.bidSize, 10)
  t.is(data.askSize, 20)
})

test('inversion params are stripped for provider grouping', (t) => {
  const raw = { base: 'BTC', quote: 'USD' }
  const inverse = {
    ...raw,
    inversion: { enabled: true, policyId: 'single-value', policyVersion: 1 },
  }

  t.deepEqual(stripInversionConfig(inverse), raw)
  t.is(calculateProviderParamsKey(raw), calculateProviderParamsKey(inverse))
  t.deepEqual(getInversionConfig(inverse), inverse.inversion)
  t.is(getInversionConfig(raw), undefined)
})
