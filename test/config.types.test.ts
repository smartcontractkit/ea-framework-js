import test from 'ava'
import { AdapterConfig, Getter, SettingDefinition, Settings } from '../src/config'

// This file has type declarations that test the types of the config system at
// compile time.

// Declarations with a (@)ts-expect-error comment are expected to produce a
// type error, and compilation will fail if they don't.

// Declarations are followed by `void foo` to prevent "declared but never used"
// errors from the TypeScript compiler.

// Utility types:

// This uses a trick proposed on https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// Without this, the type system sometimes doesn't realize that two types are
// equal even though they are.
type Expand<T> = { [K in keyof T]: T[K] }

type ExpectEqual<A, E> =
  Equal<Expand<A>, Expand<E>> extends true
    ? true
    : { error: 'Types are not equal'; actual: A; expected: E }

// Test that the shape of the SettingsDefinition is enforced by the type
// system.

// @ts-expect-error test
const _assertStringDefault: SettingDefinition = {
  type: 'string',
  description: 'string settings cannot have a number as default',
  default: 2,
}
void _assertStringDefault

// @ts-expect-error test
const _assertNumberDefault: SettingDefinition = {
  type: 'string',
  description: 'number settings cannot have a boolean as default',
  default: true,
}
void _assertNumberDefault

// @ts-expect-error test
const _assertBooleanDefault: SettingDefinition = {
  type: 'boolean',
  description: 'boolean settings cannot have a string as default',
  default: 'true',
}
void _assertBooleanDefault

// @ts-expect-error test
const _assertEnumNumberDefault: SettingDefinition = {
  type: 'enum',
  description: 'enum settings cannot have a number as default',
  options: ['option1', 'option2', 'option3'],
  default: 1,
}
void _assertEnumNumberDefault

// Ideally this would fail but it doesn't
const _assertEnumOptionDefault: SettingDefinition = {
  type: 'enum',
  description: 'enum settings can have a default that is not a valid option',
  options: ['option1', 'option2', 'option3'],
  default: 'option4',
}
void _assertEnumOptionDefault

// Test that the type of the settings is correctly inferred from the type of
// the settings definition.

const testSettingsDefinition = {
  optionalStringSetting: {
    type: 'string',
    description: 'optional string setting',
  },
  requiredStringSetting: {
    type: 'string',
    description: 'required string setting',
    required: true,
  },
  defaultStringSetting: {
    type: 'string',
    description: 'string setting with default value',
    default: 'default value',
  },
  optionalNumberSetting: {
    type: 'number',
    description: 'optional number setting',
  },
  requiredNumberSetting: {
    type: 'number',
    description: 'required number setting',
    required: true,
  },
  defaultNumberSetting: {
    type: 'number',
    description: 'number setting with default value',
    default: 42,
  },
  optionalBooleanSetting: {
    type: 'boolean',
    description: 'optional boolean setting',
  },
  requiredBooleanSetting: {
    type: 'boolean',
    description: 'required boolean setting',
    required: true,
  },
  defaultBooleanSetting: {
    type: 'boolean',
    description: 'boolean setting with default value',
    default: true,
  },
  optionalEnumSetting: {
    type: 'enum',
    description: 'optional enum setting',
    options: ['option1', 'option2', 'option3'],
  },
  requiredEnumSetting: {
    type: 'enum',
    description: 'required enum setting',
    required: true,
    options: ['option1', 'option2', 'option3'],
  },
  defaultEnumSetting: {
    type: 'enum',
    description: 'enum setting with default value',
    options: ['option1', 'option2', 'option3'],
    default: 'option1',
  },
  variableOptionalStringSetting: {
    type: 'string',
    description: 'optional string setting',
    variablePlaceholder: 'variable',
  },
  variableRequiredStringSetting: {
    type: 'string',
    description: 'required string setting',
    required: true,
    variablePlaceholder: 'variable',
  },
  variableDefaultStringSetting: {
    type: 'string',
    description: 'string setting with default value',
    default: 'default value',
    variablePlaceholder: 'variable',
  },
  variableOptionalNumberSetting: {
    type: 'number',
    description: 'optional number setting',
    variablePlaceholder: 'variable',
  },
  variableRequiredNumberSetting: {
    type: 'number',
    description: 'required number setting',
    required: true,
    variablePlaceholder: 'variable',
  },
  variableDefaultNumberSetting: {
    type: 'number',
    description: 'number setting with default value',
    default: 42,
    variablePlaceholder: 'variable',
  },
  variableOptionalBooleanSetting: {
    type: 'boolean',
    description: 'optional boolean setting',
    variablePlaceholder: 'variable',
  },
  variableRequiredBooleanSetting: {
    type: 'boolean',
    description: 'required boolean setting',
    required: true,
    variablePlaceholder: 'variable',
  },
  variableDefaultBooleanSetting: {
    type: 'boolean',
    description: 'boolean setting with default value',
    default: true,
    variablePlaceholder: 'variable',
  },
  variableOptionalEnumSetting: {
    type: 'enum',
    description: 'optional enum setting',
    options: ['option1', 'option2', 'option3'],
    variablePlaceholder: 'variable',
  },
  variableRequiredEnumSetting: {
    type: 'enum',
    description: 'required enum setting',
    required: true,
    options: ['option1', 'option2', 'option3'],
    variablePlaceholder: 'variable',
  },
  variableDefaultEnumSetting: {
    type: 'enum',
    description: 'enum setting with default value',
    options: ['option1', 'option2', 'option3'],
    default: 'option1',
    variablePlaceholder: 'variable',
  },
} as const
void testSettingsDefinition

type ExpectedSettingsType = {
  optionalStringSetting?: string
  requiredStringSetting: string
  defaultStringSetting: string
  optionalNumberSetting?: number
  requiredNumberSetting: number
  defaultNumberSetting: number
  optionalBooleanSetting?: boolean
  requiredBooleanSetting: boolean
  defaultBooleanSetting: boolean
  optionalEnumSetting?: 'option1' | 'option2' | 'option3'
  requiredEnumSetting: 'option1' | 'option2' | 'option3'
  defaultEnumSetting: 'option1' | 'option2' | 'option3'
  variableOptionalStringSetting: Getter<string | undefined>
  variableRequiredStringSetting: Getter<string>
  variableDefaultStringSetting: Getter<string>
  variableOptionalNumberSetting: Getter<number | undefined>
  variableRequiredNumberSetting: Getter<number>
  variableDefaultNumberSetting: Getter<number>
  variableOptionalBooleanSetting: Getter<boolean | undefined>
  variableRequiredBooleanSetting: Getter<boolean>
  variableDefaultBooleanSetting: Getter<boolean>
  variableOptionalEnumSetting: Getter<'option1' | 'option2' | 'option3' | undefined>
  variableRequiredEnumSetting: Getter<'option1' | 'option2' | 'option3'>
  variableDefaultEnumSetting: Getter<'option1' | 'option2' | 'option3'>
}

const _settingsType: ExpectEqual<
  Settings<typeof testSettingsDefinition>,
  ExpectedSettingsType
> = true
void _settingsType

// Reproduces the bug from `packages/sources/liveart/src/config/index.ts`.
// Annotating the variable with the default `AdapterConfig` (no
// inferred generic) widens the settings map to `Record<string,
// SettingDefinition>`. Any custom setting then resolves via an index
// signature whose value type is the full `SettingType<SettingDefinition>`
// union.
//
// Previously this collapsed to `undefined` (because `SettingType` was not
// distributive over `SettingDefinition`), which silently allowed values
// like `adapterSettings.API_BASE_URL` to be passed into stricter types
// such as Axios's `baseURL: string | undefined`.
const wideConfig: AdapterConfig = new AdapterConfig({
  API_BASE_URL: {
    type: 'string',
    description: 'API base URL',
    required: true,
    default: 'https://example.com',
  },
})

wideConfig.initialize()

// @ts-expect-error TS2339: Property 'API_BASE_URL' does not exist on type 'AdapterConfig<SettingsDefinitionMap>'.
const _wideConfigAccess = wideConfig.settings.API_BASE_URL
void _wideConfigAccess

// The tests below are not directly a test of the config types, but it
// demonstrates an important principle used in SettingType.

type MyType = { foo: number } | { foo: string }

type TypeOfFoo<T extends { foo: unknown }> = T['foo'] extends string
  ? string
  : T['foo'] extends number
    ? number
    : never

type DistributeTypeOfFoo<T extends { foo: unknown }> = T extends never ? never : TypeOfFoo<T>

// If TypeOfFoo is applied directly to MyType, it will evaluate T['foo'] as
// `string | number`, which does not satisfy either condition and results in
// `never`.
const _testTypeOfFooDirectly: ExpectEqual<TypeOfFoo<MyType>, never> = true
void _testTypeOfFooDirectly

// But if you do the same inside a seemingly useless conditional, it will apply
// `TypeOfFoo` to each member of the union separately (first to
// `{ foo: number }` and then to `{ foo: string }`), and then combine the
// results together. So it will evaluate to `number` for the first member and
// `string` for the second member, and the result will be `number | string`.
// then unions the results together.
const _testTypeOfFooDistributed: ExpectEqual<DistributeTypeOfFoo<MyType>, string | number> = true
void _testTypeOfFooDistributed

test('add one actual test so the test framework does not complain', (t) => {
  t.pass()
})
