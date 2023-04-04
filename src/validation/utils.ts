import { ValidationErrorMessage } from '../config'
import { isIP } from 'net'

export type Validator<V> = (value?: V) => ValidationErrorMessage
export type ValidatorWithParams<P, V> = (param: P, customError?: string) => Validator<V>

// Composes complex validator function that runs each validator in order and returns first occurred error description and skips the rest of validation
const compose: (f: Validator<string | number>[]) => Validator<number | string> = (
  validatorFunctions: Validator<number | string>[],
) => {
  return (value) => {
    for (const validator of validatorFunctions) {
      const errorText = validator(value)
      if (errorText?.length) {
        return errorText
      }
    }
    return
  }
}

const _integer: () => Validator<number | string> = () => {
  return (value) => {
    if (!Number.isInteger(value)) {
      return `Value should be an integer (no floating point)., Received ${typeof value} ${value}`
    }
    return
  }
}

const positive: () => Validator<number | string> = () => {
  return (value) => {
    if (value !== undefined && value < 0) {
      return `Value should be positive number, Received ${value}`
    }
    return
  }
}

const minNumber: ValidatorWithParams<number, number | string> = (param) => {
  return (value) => {
    if (value !== undefined && value < param) {
      return `Minimum allowed value is ${param}. Received ${value}`
    }
    return
  }
}

const maxNumber: ValidatorWithParams<number, number | string> = (param) => {
  return (value) => {
    if (value !== undefined && value > param) {
      return `Maximum allowed value is ${param}. Received ${value}`
    }
    return
  }
}

const url: () => Validator<string> = () => {
  return (value) => {
    try {
      value && new URL(value)
    } catch (e) {
      return `Value should be valid URL. Received ${value}`
    }
    return
  }
}

const host: () => Validator<string> = () => {
  return (value) => {
    const result = isIP(value || '')
    if (result === 0 && value !== 'localhost') {
      return `Value is not valid IP address. Received ${value}`
    }
    return
  }
}

const object = () => {
  return (value: Record<string, unknown>) => {
    const isObject = typeof value === 'object' && value !== null
    if (!isObject) {
      return `Value is not valid object.`
    }
    return
  }
}

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

// Validates that value is a valid timestamp from 2018-01-01 to now
const responseTimestamp = () => integer({ min: 1514764861000, max: new Date().getTime() })

const base64 = () => {
  return (value: string) => {
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      const encodedAgain = Buffer.from(decoded, 'utf-8').toString('base64');
      return value !== encodedAgain ?  `Value is not valid base64 string.` : undefined
    } catch (err) {
      return `Value is not valid base64 string.`
    }
  }
}

export const validator = {
  integer,
  positiveInteger,
  port,
  url,
  host,
  object,
  responseTimestamp,
  base64,
  compose,
}
