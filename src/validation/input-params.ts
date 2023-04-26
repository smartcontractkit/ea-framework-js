import { Overrides, ReservedInputParameterNames, hasRepeatedValues } from '../util'
import { AdapterError } from './error'

/**
 * Type for the overrides object that is either hardcoded in the adapter,
 * or present in the incoming request body
 */
export type Override = Map<string, Map<string, string>>

/**
 * Possible strings that correspond to types of primitive values
 * that can be specified for an input parameter
 */
type PrimitiveParameterTypeString = 'boolean' | 'number' | 'string'

/**
 * Possible types for each of the possible type strings
 */
type PrimitiveParameterType = TypeFromTypeString<PrimitiveParameterTypeString>

/**
 * All possible types for an input parameter (either a string, or a nested param definition)
 */
type ParameterType = PrimitiveParameterTypeString | InputParametersDefinition

/**
 * Given a type parameter T that is a parameter type (string or nested definition),
 * equals to the corresponding type for that type string or definition
 */
type TypeFromTypeString<T extends ParameterType> = T extends 'string'
  ? string
  : T extends 'number'
  ? number
  : T extends 'boolean'
  ? boolean
  : T extends InputParametersDefinition
  ? TypeFromDefinition<T>
  : never

/**
 * Util type to be able to discern exactly if a generic is exactly unknown
 * (because everything extends unknown, but unknown only extends itself)
 */
type IsUnknown<T> = unknown extends T ? true : false

/**
 * Given a concrete InputParameter P, results in the type for that definition taking into account
 * the required property of the definition (i.e. makes it optional or not)
 */
type ShouldBeUndefinable<
  P extends InputParameter,
  T = TypeFromTypeString<P['type']>,
> = P['required'] extends true ? T : IsUnknown<P['default']> extends true ? T | undefined : T

/**
 * Just an alias to make types below more readable
 */
type NonArrayInputType<P extends InputParameter> = ShouldBeUndefinable<P>

/**
 * Given an InputParameter P, results in the corresponding type for that definition,
 * accounting for configurations like required, array, defaults, etc.
 */
type TypeFromParameter<
  P extends InputParameter,
  T = TypeFromTypeString<P['type']>,
> = P['array'] extends true ? T[] : NonArrayInputType<P>

/**
 * Constraint for an InputParameter to make sure options are only specified for parameters of type string.
 * All these constraints, for them to work properly, should represent the entire closed realm of possibilities.
 * That is, there should be no possible input parameter that the constraint doesn't accept one way or the other.
 */
type InputParameterOptionConstraints =
  | {
      type: 'string'
      options?: string[] | readonly string[]
    }
  | {
      type: 'number'
      options?: number[] | readonly number[]
    }
  | {
      type: Exclude<ParameterType, 'string' | 'number'>
      options?: never
    }

/**
 * Constraint to make sure input parameter defaults match their type, and that
 * defaults are only allowed for primitive types
 */
type InputParameterDefaultTypeConstraints =
  | {
      type: 'string'
      default?: string
    }
  | {
      type: 'number'
      default?: number
    }
  | {
      type: 'boolean'
      default?: boolean
    }
  | {
      type: Exclude<ParameterType, 'string' | 'number' | 'boolean'>
      default?: never
    }

/**
 * Constraint to avoid unnecessary or impossible required and default combinations
 */
type InputParameterDefaultRequiredConstraints =
  | {
      required: true
      default?: never
    }
  | {
      required?: false
      default?: PrimitiveParameterType
    }

/**
 * Constraint to make sure array input parameters don't specify a default
 */
type InputParameterArrayDefaultConstraints =
  | {
      array: true
      default?: never
    }
  | {
      array?: false
      default?: PrimitiveParameterType
    }

/**
 * Basic structure for an InputParameter.
 * The concrete possible types that will be used in a definition can be found below this one.
 * (they are split into several types due to existential types not being supported)
 */
type BaseInputParameter = {
  description: string
  type: ParameterType

  // Constrained properties (check *Constraints types above)
  default?: PrimitiveParameterType
  required?: boolean
  array?: boolean
  options?: string[] | readonly string[] | number | readonly number[] // Enumerated options, ex. ['ADA', 'BTC', 'ETH']

  // Purposefully ignored in the types, as aliases will be converted to the main keys
  aliases?: readonly string[]

  // Not accounted for in the types
  dependsOn?: readonly string[] // Other inputs this one depends on
  exclusive?: readonly string[] // Other inputs that cannot be present with this one
}

/**
 * Type for the definition of one InputParameter.
 * This is built from the base type, intersected with a bunch of constraints.
 */
export type InputParameter = BaseInputParameter &
  InputParameterOptionConstraints &
  InputParameterDefaultTypeConstraints &
  InputParameterDefaultRequiredConstraints &
  InputParameterArrayDefaultConstraints

/**
 * Map of input names to their corresponding definition.
 */
export type InputParametersDefinition = Record<string, InputParameter>

/**
 * Constrains the InputParametersDefinition to exclude reserved param names.
 */
type ProperInputParametersDefinition = InputParametersDefinition & {
  [K in ReservedInputParameterNames]?: never
}

/**
 * Given an input parameter definition, results in the type for the actual params object.
 */
export type TypeFromDefinition<T extends InputParametersDefinition> = {
  -readonly [K in keyof T]: TypeFromParameter<T[K]>
}

/**
 * Util type to represent the absence of input parameters for an adapter endpoint.
 */
export type EmptyInputParameters = InputParametersDefinition

/**
 * Error thrown when the validation of a request's params fails.
 */
class InputValidationError extends AdapterError {
  constructor(message: string) {
    super({
      statusCode: 400,
      message,
    })
  }
}

/**
 * Error thrown when the validation of the input parameters definition fails.
 */
class InputParametersDefinitionError extends Error {}

/**
 * This class encapsulates logic for a single input parameter, taking its definition
 * and performing validations (both on the definition on construction, and params when prompted).
 */
class ProcessedParam<const T extends InputParameter = InputParameter> {
  /** List of aliases for this processed parameter, including the original parameter name */
  aliases: string[]

  /** Set of all possible options for this parameter (used when validating inputs) */
  options?: Set<TypeFromParameter<T>>

  /** Definition for the type of this parameter */
  type: PrimitiveParameterTypeString | InputParameters<InputParametersDefinition>

  constructor(public name: string, public definition: T) {
    this.aliases = [this.name, ...(this.definition.aliases || [])]
    this.type =
      typeof definition.type === 'object' ? new InputParameters(definition.type) : definition.type

    if (definition.options) {
      this.options = new Set(definition.options as TypeFromParameter<T>[])
    }

    this.validateDefinition()
  }

  /** Util method to throw a definition error prefixed with this param name */
  private definitionError(message: string): InputParametersDefinitionError {
    return new InputParametersDefinitionError(`[Param: ${this.name}] ${message}`)
  }

  /** Util method to throw a validation error prefixed with this param name */
  private validationError(message: string): InputParametersDefinitionError {
    return new InputValidationError(`[Param: ${this.name}] ${message}`)
  }

  /**
   * Validates the definition that this parameter has been constructed with.
   */
  private validateDefinition() {
    // Check that there are no repeated aliases
    if (hasRepeatedValues(this.aliases)) {
      throw this.definitionError(
        `There are repeated aliases for input param ${this.name}: ${this.aliases}`,
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

  /**
   * Validates an incoming adapter request's input params and
   * performs all necessary checks and modifications.
   *
   * @param input - the input data from an incoming adapter request
   * @returns - the validated data
   */
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

  /**
   * Validates a single value from the incoming params.
   *
   * @param input - a single value from the request params object
   * @returns - the validated input data
   */
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
    if (this.options && !this.options.has(input as TypeFromParameter<T>)) {
      throw this.validationError(`input is not one of valid options (${this.definition.options})`)
    } else if (typeof input !== this.definition.type) {
      throw this.validationError(`input type is not the expected one (${this.type})`)
    }

    // If no validations failed and no defaults / modifications were applied, use the original input
    return input
  }
}

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

  /**
   * Validates the entire definitions object provided to the constructor.
   */
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

  /**
   * Validates an incoming adapter request's input params and
   * performs all necessary checks and modifications.
   *
   * @param input - the input data from an incoming adapter request
   * @returns - the validated data
   */
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

/**
 * Validates that the overrides object in a request (if present) is correct.
 *
 * @param input - a request's input data, which may contain overrides
 * @returns nothing, only throws if an error is found
 */
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
