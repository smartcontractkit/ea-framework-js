import { isIP } from 'net'
import { ValidationErrorMessage } from '../config'

export type Validator<V> = (value?: V) => ValidationErrorMessage
export type ValidatorWithParams<P, V> = (param: P, customError?: string) => Validator<V>

// Composes complex validator function that runs each validator in order and returns first occurred error description and skips the rest of validation
const compose: <T>(f: Validator<T>[]) => Validator<T> = <T>(validatorFunctions: Validator<T>[]) => {
  return (value: T | undefined) => {
    for (const validator of validatorFunctions) {
      const errorText = validator(value)
      if (errorText?.length) {
        return errorText
      }
    }
    return
  }
}

const _integer: () => Validator<number> = () => {
  return (value) => {
    if (!Number.isInteger(value)) {
      return `Value should be an integer (no floating point)., Received ${typeof value} ${value}`
    }
    return
  }
}

const positive: () => Validator<number> = () => {
  return (value) => {
    if (value !== undefined && Number(value) < 0) {
      return `Value should be positive number, Received ${value}`
    }
    return
  }
}

const minNumber: ValidatorWithParams<number, number> = (param) => {
  return (value) => {
    if (value !== undefined && Number(value) < param) {
      return `Minimum allowed value is ${param}. Received ${value}`
    }
    return
  }
}

const maxNumber: ValidatorWithParams<number, number> = (param) => {
  return (value) => {
    if (value !== undefined && Number(value) > param) {
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

const base64: () => Validator<string> = () => {
  return (value) => {
    const errorMessage = `Value is not valid base64 string.`
    if (!value) {
      return errorMessage
    }
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8')
      const encodedAgain = Buffer.from(decoded, 'utf-8').toString('base64')
      return value !== encodedAgain ? errorMessage : undefined
    } catch (err) {
      return errorMessage
    }
  }
}

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
