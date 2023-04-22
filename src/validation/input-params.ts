import { Overrides, ReservedInputParameterNames } from '../util'
import { AdapterInputError } from './error'

/* INPUT TYPE VALIDATIONS */
export type Override = Map<string, Map<string, string>>

type PrimitiveParameterTypeString = 'boolean' | 'number' | 'string'

type PrimitiveParameterType = TypeFromTypeString<PrimitiveParameterTypeString>

type ParameterType = PrimitiveParameterTypeString | InputParametersDefinition

type TypeFromTypeString<T extends ParameterType> = T extends 'string'
  ? string
  : T extends 'number'
  ? number
  : T extends 'boolean'
  ? boolean
  : T extends InputParametersDefinition
  ? TypeFromDefinition<T>
  : never

type IsUnknown<T> = unknown extends T ? true : false

type ShouldBeUndefinable<
  P extends InputParameter,
  T = TypeFromTypeString<P['type']>,
> = P['required'] extends true ? T : IsUnknown<P['default']> extends true ? T | undefined : T

type NonArrayInputType<P extends InputParameter> = ShouldBeUndefinable<P>

type TypeFromParameter<
  P extends InputParameter,
  T = TypeFromTypeString<P['type']>,
> = P['array'] extends true ? T[] : NonArrayInputType<P>

type BaseInputParameter = {
  description: string
  type: ParameterType

  // Purposefully ignored in the types, as aliases will be converted to the main keys
  aliases?: readonly string[]

  // Not accounted for in the types
  options?: string[] | readonly string[] // Enumerated options, ex. ['ADA', 'BTC', 'ETH']
  dependsOn?: readonly string[] // Other inputs this one depends on
  exclusive?: readonly string[] // Other inputs that cannot be present with this one
}

type OptionalInputParameter = BaseInputParameter & {
  // Excluded props
  required?: never
  array?: never
  default?: never
}

// Trying to define the default type based on the self object would be an "existential type" and is not supported by typescript.
// Attempting to do it with workarounds is a deep rabbit hole and should be avoided.
type InputParameterWithDefault = BaseInputParameter & {
  default?: PrimitiveParameterType

  // Excluded props
  required?: never
  array?: never
}

type RequiredInputParameter = BaseInputParameter & {
  required: true

  // Excluded props
  default?: never
  array?: never
}

// Currently array params are always expected to be present and have at least one item
type ArrayInputParameter = BaseInputParameter & {
  array: true

  // Excluded props
  default?: never
  required?: never
}

export type InputParameter =
  | OptionalInputParameter
  | InputParameterWithDefault
  | RequiredInputParameter
  | ArrayInputParameter

export type InputParametersDefinition = Record<string, InputParameter>

export type TypeFromDefinition<T extends InputParametersDefinition> = {
  [K in keyof T]: TypeFromParameter<T[K]>
} & {
  [K in ReservedInputParameterNames]?: never
}

// Type TypeFromInputParameters<D extends InputParametersDefinition, T extends InputParameters<D>> = TypeFromDefinition<T['definition']>

// const nestedParam = {
//   nestedStringParam: {
//     description: 'nested string',
//     type: 'string',
//   },
//   nestedRequiredNumberParam: {
//     description: 'nested number',
//     type: 'number',
//     required: true,
//   },
//   nestedDefaultBooleanParam: {
//     description: 'nested boolean',
//     type: 'boolean',
//     default: true,
//   },
// } as const satisfies InputParametersDefinition

// const paramsDefinition = {
//   stringParam: {
//     description: 'asd',
//     type: 'string',
//     options: ['asd', 'qwe']
//   },
//   numberParam: {
//     description: 'asd',
//     type: 'number',
//   },
//   requiredParam: {
//     description: 'asd',
//     type: 'boolean',
//     required: true,
//   },
//   defaultStringParam: {
//     description: 'string',
//     type: 'string',
//     default: 'qwe',
//   },
//   stringArrayParam: {
//     description: 'string',
//     type: 'string',
//     array: true,
//   },
//   numberArrayParam: {
//     description: 'numberArray',
//     type: 'number',
//     array: true,
//   },
//   objectParam: {
//     description: 'object',
//     type: nestedParam,
//   },
// } as const satisfies InputParametersDefinition

class InputValidationError extends AdapterInputError {
  constructor(message: string) {
    super({
      statusCode: 400,
      message,
    })
  }
}

class InputParametersDefinitionError extends Error {}

class ProcessedParam<const T extends InputParameter = InputParameter> {
  aliases: string[]
  options?: Set<string>
  type: PrimitiveParameterTypeString | InputParameters<InputParametersDefinition>

  constructor(public name: string, public definition: T) {
    this.aliases = [this.name, ...(this.definition.aliases || [])]
    this.type =
      typeof definition.type === 'object' ? new InputParameters(definition.type) : definition.type

    if (definition.options) {
      this.options = new Set(definition.options)
    }

    this.validateDefinition()
  }

  private definitionError(message: string): InputParametersDefinitionError {
    return new InputParametersDefinitionError(`[Param: ${this.name}] ${message}`)
  }
  private validationError(message: string): InputParametersDefinitionError {
    return new InputValidationError(`[Param: ${this.name}] ${message}`)
  }

  private validateDefinition() {
    // Check that there are no repeated aliases
    if (hasRepeatedValues(this.aliases)) {
      throw this.definitionError(
        `There are repeated aliases for input param ${this.name}: ${this.aliases}`,
      )
    }

    // Check that the default specified complies with the param type
    if (this.definition.default && typeof this.definition.default !== this.definition.type) {
      throw this.definitionError(
        `The specified default "${this.definition.default}" does not comply with the param type "${this.definition.type}"`,
      )
    }

    // Check that every option complies with the param type
    if (this.definition.options?.some((o) => typeof o !== this.definition.type)) {
      throw this.definitionError(
        `The options specified (${this.definition.options}) do not all comply with the param type ${this.definition.type}`,
      )
    }

    // Check that there are no repeated options
    if (this.options && this.definition.options?.length !== this.options.size) {
      throw this.definitionError(
        `There are duplicates in the specified options: ${this.definition.options}`,
      )
    }
  }

  validateInput(input: unknown) {
    if (this.definition.required && input == null) {
      throw this.validationError('param is required but no value was provided')
    }

    if (this.definition.array) {
      if (!Array.isArray(input)) {
        throw this.validationError('input value is not an array')
      }
      if (input.length === 0) {
        throw this.validationError('input array must be non-empty')
      }

      // Validate each value from the array individually
      return input.map(this.validateInputType)
    } else {
      // We already know this won't be an array, but the generics are too complex for typescript
      // to infer by itself so we cast manually
      this.validateInputType(input as ShouldBeUndefinable<T>)
    }
  }

  private validateInputType(input: NonArrayInputType<T>) {
    // If the type is a nested input params object, use that to validate
    if (this.definition.type instanceof InputParameters) {
      return this.definition.type.validateInput(input)
    }

    // If the param has specified options, check that the input is one of them.
    // In this case we don't need to check the type, since the options will do that for us
    if (this.options && !this.options.has(input as string)) {
      throw this.validationError(`input is not one of valid options (${this.definition.options})`)
    } else if (typeof input !== this.definition.type) {
      throw this.validationError(`input type is not the expected one (${this.type})`)
    }
  }
}

const hasRepeatedValues = (array: string[]) => array.length !== new Set(array).size

export class InputParameters<const T extends InputParametersDefinition> {
  params: ProcessedParam[]

  constructor(public definition: T) {
    this.params = Object.entries(this.definition).map(
      ([name, param]) => new ProcessedParam(name, param),
    )

    // Check that all options match param type
    // Check that defaults matches param validation
    this.validateDefinition()
  }

  private validateDefinition() {
    const paramNames = new Set(...this.params.map((p) => p.name))

    // Check that aliases don't clash with other properties
    if (hasRepeatedValues(this.params.map((p) => p.aliases).flat())) {
      throw new InputParametersDefinitionError(
        'There are clashes in property names and aliases, check that they are all unique',
      )
    }

    for (const param of this.params) {
      // Check that all dependencies reference valid options
      if (param.definition.dependsOn?.some((d) => !paramNames.has(d))) {
        throw new InputParametersDefinitionError(
          `Param "${param.name}" depends on non-existent params (${param.definition.dependsOn})`,
        )
      }

      // Check that all exclusions reference valid options
      if (param.definition.exclusive?.some((d) => !paramNames.has(d))) {
        throw new InputParametersDefinitionError(
          `Param "${param.name}" excludes non-existent params (${param.definition.exclusive})`,
        )
      }
    }
  }

  validateInput(rawData: unknown): TypeFromDefinition<T> {
    if (typeof rawData !== 'object' || rawData == null) {
      throw new InputValidationError('Input for input parameters should be an object')
    }

    const data = rawData as Record<string, unknown>
    const validated: Record<string, unknown> = {}

    // Validate each param individually
    for (const param of this.params) {
      for (const alias of param.aliases) {
        const value = data[alias]
        if (!value) {
          continue
        }
        if (validated[param.name]) {
          throw new InputValidationError(
            `Parameter "${param.name}" is specified more than once (aliases: ${param.aliases})`,
          )
        }

        validated[param.name] = value
      }

      // Perform all validations for the individual param value
      param.validateInput(validated[param.name])
    }

    // We iterate again, now with the complete validated obj to check for dependencies and exclusions
    for (const param of this.params) {
      if (!validated[param.name]) {
        continue
      }

      if (param.definition.dependsOn?.some((d) => !validated[d])) {
        throw new InputValidationError(
          `Parameter "${param.name}" is missing dependencies (${param.definition.dependsOn})`,
        )
      }

      if (param.definition.exclusive?.some((d) => validated[d])) {
        throw new InputValidationError(
          `Parameter "${param.name}" cannot be present at the same time as exclusions (${param.definition.exclusive})`,
        )
      }
    }

    return validated as TypeFromDefinition<T>
  }
}

export const validateOverrides = (input: { overrides?: Overrides }) => {
  if (!input.overrides) {
    // Nothing to validate!
    return
  }

  if (typeof input !== 'object') {
    throw new InputValidationError('Overrides should be an object')
  }

  for (const adapterName in input.overrides) {
    const overrides = input.overrides
    if (typeof overrides !== 'object') {
      throw new InputValidationError(`Overrides for adapter "${adapterName}" should be an object`)
    }

    for (const symbol in overrides) {
      const override = overrides[symbol]
      if (typeof symbol !== 'string' || typeof override !== 'string') {
        throw new InputValidationError(
          `Overrides should map strings to strings, got ${symbol} to ${override}`,
        )
      }
    }
  }
}
