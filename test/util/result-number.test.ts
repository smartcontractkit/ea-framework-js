import test from 'ava'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { validateResultNumber, ValidatedResultNumber } from '../../src/util/result-number'

const isProviderError = (
  v: ValidatedResultNumber,
): v is { statusCode: 502; errorMessage: string } => 'statusCode' in v

test.before(() => {
  LoggerFactoryProvider.set()
})

test('validateResultNumber returns a valid number for numeric input', (t) => {
  t.deepEqual(validateResultNumber(123.45, 'error'), { result: 123.45 })
})

test('validateResultNumber coerces numeric strings to numbers', (t) => {
  t.deepEqual(validateResultNumber('67.89', 'error'), { result: 67.89 })
})

test('validateResultNumber accepts 0 by default', (t) => {
  t.deepEqual(validateResultNumber(0, 'error'), { result: 0 })
  t.deepEqual(validateResultNumber('0', 'error'), { result: 0 })
})

test('validateResultNumber rejects 0 when acceptZeroValue is false', (t) => {
  const result = validateResultNumber(0, 'error', { acceptZeroValue: false })
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects null', (t) => {
  const result = validateResultNumber(null, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects undefined', (t) => {
  const result = validateResultNumber(undefined, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects NaN', (t) => {
  const result = validateResultNumber(NaN, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects "NaN" string', (t) => {
  const result = validateResultNumber('NaN', 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects empty string', (t) => {
  const result = validateResultNumber('', 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects whitespace-only string', (t) => {
  const result = validateResultNumber('   ', 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects objects', (t) => {
  const result = validateResultNumber({ value: 123 }, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects arrays', (t) => {
  const result = validateResultNumber([123], 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects booleans', (t) => {
  const result = validateResultNumber(true, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects Infinity', (t) => {
  const result = validateResultNumber(Infinity, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber rejects -Infinity', (t) => {
  const result = validateResultNumber(-Infinity, 'error')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.statusCode, 502)
  }
})

test('validateResultNumber preserves the provided error message', (t) => {
  const result = validateResultNumber(null, 'custom error message')
  t.true(isProviderError(result))
  if (isProviderError(result)) {
    t.is(result.errorMessage, 'custom error message')
  }
})

test('isProviderError returns false for a valid result', (t) => {
  const result = validateResultNumber(123, 'error')
  t.false(isProviderError(result))
})
