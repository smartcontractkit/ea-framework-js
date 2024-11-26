import { isIP } from 'net'
import { ValidationErrorMessage } from '../config'

export type ValidatorMeta = {
  min?: number
  max?: number
  details?: string
}

export type Validator<V> = {
  meta: ValidatorMeta
  fn: (value?: V) => ValidationErrorMessage
}
export type ValidatorWithParams<P, V> = (param: P, customError?: string) => Validator<V>

// Composes complex validator function that runs each validator in order and returns first occurred error description and skips the rest of validation
const compose: (f: Validator<string | number>[]) => Validator<number | string> = (
  validatorFunctions: Validator<number | string>[],
) => {
  const meta: ValidatorMeta = {}
  const details: string[] = []

  for (const validator of validatorFunctions) {
    if (validator.meta.min !== undefined) {
      meta.min = validator.meta.min
    }
    if (validator.meta.max !== undefined) {
      meta.max = validator.meta.max
    }
    if (validator.meta.details) {
      details.push(validator.meta.details)
    }
  }

  meta.details = details.join(', ')

  return {
    meta: meta,
    fn: (value) => {
      for (const validator of validatorFunctions) {
        const errorText = validator.fn(value)
        if (errorText?.length) {
          return errorText
        }
      }
      return
    },
  }
}

const _integer: () => Validator<number | string> = () => ({
  meta: {
    details: 'Value must be an integer',
  },
  fn: (value) => {
    if (!Number.isInteger(value)) {
      return `Value must be an integer (no floating point)., Received ${typeof value} ${value}`
    }
    return
  },
})

const positive: () => Validator<number | string> = () => ({
  meta: {
    details: 'Value must be a positive number',
  },
  fn: (value) => {
    if (value !== undefined && Number(value) < 0) {
      return `Value must be positive number, Received ${value}`
    }
    return
  },
})

const minNumber: ValidatorWithParams<number, number | string> = (param) => ({
  meta: {
    details: 'Value must be above the minimum',
    min: param,
  },
  fn: (value) => {
    if (value !== undefined && Number(value) < param) {
      return `Minimum allowed value is ${param}. Received ${value}`
    }
    return
  },
})

const maxNumber: ValidatorWithParams<number, number | string> = (param) => ({
  meta: {
    details: 'Value must be below the maximum',
    max: param,
  },
  fn: (value) => {
    if (value !== undefined && Number(value) > param) {
      return `Maximum allowed value is ${param}. Received ${value}`
    }
    return
  },
})

const url: () => Validator<string> = () => ({
  meta: {
    details: 'Value must be a valid URL',
  },
  fn: (value) => {
    try {
      /* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
      value && new URL(value)
    } catch (e) {
      return `Value must be valid URL. Received ${value}, error ${e}`
    }
    return
  },
})

const host: () => Validator<string> = () => ({
  meta: {
    details: 'Value must be a valid IP address',
  },
  fn: (value) => {
    const result = isIP(value || '')
    if (result === 0 && value !== 'localhost') {
      return `Value is not valid IP address. Received ${value}`
    }
    return
  },
})

const positiveInteger = () => compose([_integer(), positive()])

const integer = (params?: { min?: number; max?: number }) => {
  const validators = [_integer()]
  if (params?.min !== undefined) {
    validators.push(minNumber(params.min))
  }
  if (params?.max !== undefined) {
    validators.push(maxNumber(params.max))
  }
  return compose(validators)
}

const port = () => integer({ min: 1, max: 65535 })

// Validates that value is a valid timestamp from 2018-01-01 to now + 50ms to account for clock drift
const responseTimestamp = () => integer({ min: 1514764861000, max: new Date().getTime() + 50 })

const base64: () => Validator<string> = () => ({
  meta: {
    details: 'Value must be a valid base64 string',
  },
  fn: (value) => {
    const errorMessage = `Value is not valid base64 string.`
    if (!value) {
      return errorMessage
    }
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8')
      const encodedAgain = Buffer.from(decoded, 'utf-8').toString('base64')
      return value !== encodedAgain ? errorMessage : undefined
    } catch (err) {
      return `Value is not valid base64 string. ${err}`
    }
  },
})

export const validator = {
  integer,
  positiveInteger,
  port,
  url,
  host,
  responseTimestamp,
  base64,
  compose,
}
