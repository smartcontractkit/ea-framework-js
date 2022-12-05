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
    if (value && value < 0) {
      return `Value should be positive number, Received ${value}`
    }
    return
  }
}

const minNumber: ValidatorWithParams<number, number | string> = (param) => {
  return (value) => {
    if (value && value < param) {
      return `Minimum allowed value is ${param}. Received ${value}`
    }
    return
  }
}

const maxNumber: ValidatorWithParams<number, number | string> = (param) => {
  return (value) => {
    if (value && value > param) {
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
  if (params?.min) {
    validators.push(minNumber(params.min))
  }
  if (params?.max) {
    validators.push(maxNumber(params.max))
  }
  return compose(validators)
}

const port = () => integer({ min: 1, max: 65535 })

export const validator = {
  integer,
  positiveInteger,
  port,
  url,
  host,
  compose,
}
