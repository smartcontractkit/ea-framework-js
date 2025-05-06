import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv'
import { getValidator } from './schema-cache'

import { Overrides, ReservedInputParameterNames, hasRepeatedValues } from '../util'
import { AdapterError } from './error'

/* -------------------------------------------------------------------------- */
/*                               TYPE HELPERS                                 */
/* -------------------------------------------------------------------------- */

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

type ParameterOptions = string[] | readonly string[] | number[] | readonly number[]
type TypeFromOptionsOrTypeString<P extends InputParameter> = P['options'] extends ParameterOptions
  ? P['options'][number]
  : TypeFromTypeString<P['type']>

type IsUnknown<T> = unknown extends T ? true : false

type ShouldBeUndefinable<
  P extends InputParameter,
  T = TypeFromOptionsOrTypeString<P>,
> = P['required'] extends true ? T : IsUnknown<P['default']> extends true ? T | undefined : T

type NonArrayInputType<P extends InputParameter> = ShouldBeUndefinable<P>

type TypeFromParameter<P extends InputParameter, T = NonArrayInputType<P>> = P['array'] extends true
  ? Exclude<T, undefined>[]
  : T

/* ---------- constraints (unchanged, folded for brevity) ------------------ */

type InputParameterOptionConstraints =
  | { type: 'string'; options?: string[] | readonly string[] }
  | { type: 'number'; options?: number[] | readonly number[] }
  | { type: Exclude<ParameterType, 'string' | 'number'>; options?: never }

type InputParameterDefaultTypeConstraints =
  | { type: 'string'; default?: string }
  | { type: 'number'; default?: number }
  | { type: 'boolean'; default?: boolean }
  | { type: Exclude<ParameterType, 'string' | 'number' | 'boolean'>; default?: never }

type InputParameterDefaultRequiredConstraints =
  | { required: true; default?: never }
  | { required?: false; default?: PrimitiveParameterType }

type InputParameterArrayDefaultConstraints =
  | { array: true; default?: never }
  | { array?: false; default?: PrimitiveParameterType }

/* -------------------------------------------------------------------------- */

type BaseInputParameter = {
  description: string
  type: ParameterType
  default?: PrimitiveParameterType
  required?: boolean
  array?: boolean
  options?: ParameterOptions
  aliases?: readonly string[]
  dependsOn?: readonly string[]
  exclusive?: readonly string[]
}

export type InputParameter = BaseInputParameter &
  InputParameterOptionConstraints &
  InputParameterDefaultTypeConstraints &
  InputParameterDefaultRequiredConstraints &
  InputParameterArrayDefaultConstraints

export type InputParametersDefinition = Record<string, InputParameter>

type ProperInputParametersDefinition = InputParametersDefinition & {
  [K in ReservedInputParameterNames]?: never
}

type EmptyDefinition = {} // eslint-disable-line

/* eslint-disable @typescript-eslint/no-explicit-any */
export type TypeFromDefinition<T extends InputParametersDefinition> = unknown extends T
  ? any
  : {
      -readonly [K in keyof T as TypeFromDefinitionIsDefined<T[K]> extends true
        ? K
        : never]: TypeFromParameter<T[K]>
    } & {
      -readonly [K in keyof T as TypeFromDefinitionIsDefined<T[K]> extends true
        ? never
        : K]?: TypeFromParameter<T[K]>
    }
/* eslint-enable */

type TypeFromDefinitionIsDefined<T extends InputParameter> = T['required'] extends true
  ? true
  : T['array'] extends true
    ? true
    : IsUnknown<T['default']> extends false
      ? true
      : false

export type EmptyInputParameters = EmptyDefinition

/* -------------------------------------------------------------------------- */
/*                                    ERRORS                                  */
/* -------------------------------------------------------------------------- */

class InputValidationError extends AdapterError {
  constructor(message: string) {
    super({ statusCode: 400, message })
  }
}

class InputParametersDefinitionError extends Error {}

/* -------------------------------------------------------------------------- */
/*                       JSON-SCHEMA (built **once**)                         */
/* -------------------------------------------------------------------------- */

function definitionToJsonSchema(def: ProperInputParametersDefinition): AnySchema {
  const properties: Record<string, unknown> = {}

  for (const [name, param] of Object.entries(def)) {
    const s: Record<string, unknown> = {}

    if (typeof param.type === 'string') {
      s['type'] = param.type
    } else {
      s['type'] = 'object'
    }

    if (param.options) {
      s['enum'] = [...param.options]
    }

    if (param.array) {
      s['type'] = 'array'
      s['items'] = { type: typeof param.type === 'string' ? param.type : 'object' }
    }

    if (param.default !== undefined) {
      s['default'] = param.default
    }

    /* Attach under main name + aliases */
    properties[name] = s
    for (const alias of param.aliases ?? []) {
      properties[alias] = s
    }
  }

  return {
    type: 'object',
    additionalProperties: true,
    properties,
  }
}

/* -------------------------------------------------------------------------- */
/*                         PARAM WRAPPER (unchanged)                          */
/* -------------------------------------------------------------------------- */

class ProcessedParam<const T extends InputParameter = InputParameter> {
  aliases: string[]
  options?: Set<TypeFromParameter<T>>
  type: PrimitiveParameterTypeString | InputParameters<InputParametersDefinition>

  constructor(
    public name: string,
    public definition: T,
  ) {
    this.aliases = [this.name, ...(this.definition.aliases || [])]
    this.type =
      typeof definition.type === 'object' ? new InputParameters(definition.type) : definition.type

    if (definition.options) {
      this.options = new Set(definition.options as TypeFromParameter<T>[])
    }

    this.validateDefinition()
  }

  private definitionError(message: string): InputParametersDefinitionError {
    return new InputParametersDefinitionError(`[Param: ${this.name}] ${message}`)
  }

  private validationError(message: string): InputValidationError {
    return new InputValidationError(`[Param: ${this.name}] ${message}`)
  }

  private validateDefinition() {
    if (hasRepeatedValues(this.aliases)) {
      throw this.definitionError(
        `There are repeated aliases for input param ${this.name}: ${this.aliases}`,
      )
    }

    if (this.definition.options?.length === 0) {
      throw this.definitionError(`The options array must contain at least one option`)
    }

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

    if (this.definition.default != null && input == null) {
      return this.definition.default
    }

    if (this.definition.array) {
      if (!(Array.isArray(input) && input.length >= 0)) {
        if (this.definition.required || input != null) {
          throw this.validationError('input value must be a non-empty array')
        }
        return []
      }

      return input.map((item) => this.validateInputType(item))
    }

    return this.validateInputType(input as ShouldBeUndefinable<T>)
  }

  private validateInputType(input: NonArrayInputType<T>) {
    if (input == null) {
      return
    }

    if (this.type instanceof InputParameters) {
      return this.type.validateInput(input)
    }

    if (this.options && !this.options.has(input as TypeFromParameter<T>)) {
      throw this.validationError(`input is not one of valid options (${this.definition.options})`)
    }
    if (typeof input !== this.definition.type) {
      throw this.validationError(`input type is not the expected one (${this.definition.type})`)
    }

    return input
  }
}

/* -------------------------------------------------------------------------- */
/*                 MAIN CLASS – WITH COMPILED AJV VALIDATOR                   */
/* -------------------------------------------------------------------------- */

export class InputParameters<const T extends ProperInputParametersDefinition> {
  /* Helper type; not emitted at runtime */
  readonly validated!: TypeFromDefinition<T>

  params: ProcessedParam[]

  private readonly schema: AnySchema
  private readonly validateFn: ValidateFunction

  constructor(
    public definition: T,
    public examples?: TypeFromDefinition<T>[],
  ) {
    this.params = Object.entries(this.definition).map(
      ([name, param]) => new ProcessedParam(name, param),
    )
    this.validateDefinition()

    /* New: compile schema once */
    this.schema = definitionToJsonSchema(this.definition)
    this.validateFn = getValidator(this.schema)
  }

  private validateDefinition() {
    const paramNames = new Set(this.params.map((p) => p.name))

    if (hasRepeatedValues(this.params.map((p) => p.aliases).flat())) {
      throw new InputParametersDefinitionError(
        'There are clashes in property names and aliases, check that they are all unique',
      )
    }

    for (const param of this.params) {
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

  validateInput(rawData: unknown): TypeFromDefinition<T> {
    if (typeof rawData !== 'object' || rawData == null) {
      throw new InputValidationError('Input for input parameters should be an object')
    }

    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rawData as Record<string, unknown>)) {
      if (v !== null) {
        sanitized[k] = v
      }
    }

    /* Fast Ajv check */
    if (!this.validateFn(sanitized)) {
      const errors: ErrorObject[] = this.validateFn.errors ?? []
      const msg =
        errors.length === 0
          ? 'Input failed validation'
          : errors.map((e) => `${e.instancePath} ${e.message ?? ''}`).join(', ')
      throw new InputValidationError(`Input validation error: ${msg}`)
    }

    const data = sanitized
    const validated: Record<string, unknown> = {}

    for (const param of this.params) {
      let value: unknown
      for (const alias of param.aliases) {
        if (data[alias] == null) {
          continue
        }
        if (value !== undefined) {
          throw new InputValidationError(
            `Parameter "${param.name}" is specified more than once (aliases: ${param.aliases})`,
          )
        }
        value = data[alias]
      }

      validated[param.name] = param.validateInput(value)
    }

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

/* -------------------------------------------------------------------------- */
/*                        OVERRIDES VALIDATION (minor fix)                    */
/* -------------------------------------------------------------------------- */

export const validateOverrides = (input: { overrides?: Overrides }) => {
  if (!input.overrides) {
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
