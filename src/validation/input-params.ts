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
  type: 'string'

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
  required?: boolean

  // Excluded props
  default?: never
}

export type InputParameter =
  | OptionalInputParameter
  | InputParameterWithDefault
  | RequiredInputParameter
  | ArrayInputParameter

export type InputParametersDefinition = Record<string, InputParameter>

type ProperInputParametersDefinition = InputParametersDefinition & {
  [K in ReservedInputParameterNames]?: never
}

export type TypeFromDefinition<T extends InputParametersDefinition> = {
  -readonly [K in keyof T]: TypeFromParameter<T[K]>
}

export type EmptyInputParameters = InputParametersDefinition

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

    // Check that if options are specified it has at least one entry
    if (this.definition.options?.length === 0) {
      throw this.definitionError(`The options array must contain at least one option`)
    }

    // Check that there are no repeated options
    if (this.options && this.definition.options?.length !== this.options.size) {
      throw this.definitionError(
        `There are duplicates in the specified options: ${this.definition.options}`,
      )
    }
  }

  validateInput(input: unknown): unknown {
    if (this.definition.required && input == null) {
      throw this.validationError('param is required but no value was provided')
    }

    if (this.definition.default && input == null) {
      return this.definition.default
    }

    if (this.definition.array) {
      if (!(Array.isArray(input) && input.length >= 0)) {
        if (this.definition.required || input != null) {
          throw this.validationError('input value must be a non-empty array')
        } else {
          return []
        }
      }

      // Validate each value from the array individually
      return input.map((item) => this.validateInputType(item))
    }

    // We already know this won't be an array, but the generics are too complex for typescript
    // to infer by itself so we cast manually
    return this.validateInputType(input as ShouldBeUndefinable<T>)
  }

  private validateInputType(input: NonArrayInputType<T>) {
    // If we're here we've already checked this is not required
    if (input == null) {
      return
    }

    // If the type is a nested input params object, use that to validate
    if (this.type instanceof InputParameters) {
      return this.type.validateInput(input)
    }

    // If the param has specified options, check that the input is one of them.
    // In this case we don't need to check the type, since the options will do that for us
    if (this.options && !this.options.has(input as string)) {
      throw this.validationError(`input is not one of valid options (${this.definition.options})`)
    } else if (typeof input !== this.definition.type) {
      throw this.validationError(`input type is not the expected one (${this.type})`)
    }

    // If no validations failed and no defaults / modifications were applied, use the original input
    return input
  }
}

const hasRepeatedValues = (array: string[]) => array.length !== new Set(array).size

export class InputParameters<const T extends ProperInputParametersDefinition> {
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
    const paramNames = new Set(this.params.map((p) => p.name))

    // Check that aliases don't clash with other properties
    if (hasRepeatedValues(this.params.map((p) => p.aliases).flat())) {
      throw new InputParametersDefinitionError(
        'There are clashes in property names and aliases, check that they are all unique',
      )
    }

    for (const param of this.params) {
      // Check that all dependencies reference valid options
      for (const dependency of param.definition.dependsOn || []) {
        if (!paramNames.has(dependency)) {
          throw new InputParametersDefinitionError(
            `Param "${param.name}" depends on non-existent param "${dependency}"`,
          )
        }
        if (this.definition[dependency].required) {
          throw new InputParametersDefinitionError(
            `Param "${param.name}" has an unnecessary dependency on "${dependency}" (dependency is always required)`,
          )
        }
      }

      for (const exclusion of param.definition.exclusive || []) {
        if (!paramNames.has(exclusion)) {
          throw new InputParametersDefinitionError(
            `Param "${param.name}" excludes non-existent param "${exclusion}"`,
          )
        }
        if (this.definition[exclusion].required) {
          throw new InputParametersDefinitionError(
            `Param "${param.name}" excludes required (i.e. always present) param "${exclusion}"`,
          )
        }
      }
    }
  }

  // TODO: Add docs to all fns
  validateInput(rawData: unknown): TypeFromDefinition<T> {
    if (typeof rawData !== 'object' || rawData == null) {
      throw new InputValidationError('Input for input parameters should be an object')
    }

    const data = rawData as Record<string, unknown>
    const validated: Record<string, unknown> = {}

    // Validate each param individually
    for (const param of this.params) {
      let value: unknown
      for (const alias of param.aliases) {
        if (data[alias] == null) {
          continue
        }
        if (value) {
          throw new InputValidationError(
            `Parameter "${param.name}" is specified more than once (aliases: ${param.aliases})`,
          )
        }
        value = data[alias]
      }

      // Perform all validations for the individual param value
      validated[param.name] = param.validateInput(value)
    }

    // We iterate again, now with the complete validated obj to check for dependencies and exclusions
    for (const param of this.params) {
      if (validated[param.name] == null) {
        continue
      }

      if (param.definition.dependsOn?.some((d) => validated[d] == null)) {
        throw new InputValidationError(
          `Parameter "${param.name}" is missing dependencies (${param.definition.dependsOn})`,
        )
      }

      if (param.definition.exclusive?.some((d) => validated[d] != null)) {
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

  if (typeof input.overrides !== 'object') {
    throw new InputValidationError('Overrides should be an object')
  }

  for (const adapterName in input.overrides) {
    const overrides = input.overrides[adapterName]
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
