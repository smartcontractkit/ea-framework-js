// Import { isEmpty } from '../util'
// import { AdapterInputError } from './error'
// import { InputParameters } from './input-params'
// import { validator } from './utils'

// export type NormalizedInput = Record<string, unknown>

// export type Override = Record<string, string>
// export type OverridesMap = Record<string, Override>

// const isNotObject = validator.object()

// export class InputValidator {
//   private aliases: { [key: string]: string[] } = {}
//   constructor(private readonly inputConfig: InputParameters) {
//     this.inputConfig = { ...inputConfig }
//     this.validateInputParamsSchema()
//   }

//   validateInput(input: Record<string, unknown>) {
//     const normalized = this.initializeInputs(input)
//     this.validateOverrides(input?.['overrides'] as OverridesMap)

//     for (const configKey in this.inputConfig) {
//       this.validateRequiredConfig(configKey, normalized)
//       if (!isEmpty(normalized[configKey])) {
//         this.validateTypes(configKey, normalized)
//         this.validateOptions(configKey, normalized)
//         this.validateDeps(configKey, normalized)
//       }
//     }

//     return normalized
//   }

//   private validateOverrides(overrides: OverridesMap) {
//     if (!overrides) {
//       return
//     }

//     if (isNotObject(overrides)) {
//       throw new AdapterInputError({
//         statusCode: 400,
//         message: `'overrides' should be an object.`,
//       })
//     }

//     for (const endpointName in overrides) {
//       if (isNotObject(overrides[endpointName])) {
//         throw new AdapterInputError({
//           statusCode: 400,
//           message: `overrides.${endpointName} should be an object.`,
//         })
//       }

//       for (const overrideKey in overrides[endpointName]) {
//         if (typeof overrides[endpointName][overrideKey] !== 'string') {
//           throw new AdapterInputError({
//             statusCode: 400,
//             message: `overrides.${endpointName}.${overrideKey} should be string.`,
//           })
//         }
//       }
//     }
//   }

//   // Private initializeInputs(input: Record<string, unknown>) {
//   //   const normalized: NormalizedInput = {}
//   //   for (const paramName in this.inputConfig) {
//   //     const usedKey = this.getUsedKey(this.aliases[paramName], input)
//   //     normalized[paramName] =
//   //       !usedKey || isEmpty(input[usedKey]) ? this.inputConfig[paramName].default : input[usedKey]
//   //   }
//   //   return normalized
//   // }

//   // private validateInputParamsSchema() {
//   //   for (const configKey in this.inputConfig) {
//   //     const config = this.inputConfig[configKey]
//   //     if (config.required && config.default) {
//   //       throw new AdapterInputError({
//   //         statusCode: 400,
//   //         message: `${configKey} can't be required and have default value`,
//   //       })
//   //     }

//   //     const aliases = [configKey, ...(config.aliases ?? [])]
//   //     if (aliases.length !== new Set(aliases).size) {
//   //       throw new AdapterInputError({
//   //         statusCode: 400,
//   //         message: `Duplicate aliases`,
//   //       })
//   //     }

//   //     this.aliases[configKey] = aliases

//   //     const deps = [...(config.dependsOn ?? []), ...(config.exclusive ?? [])]
//   //     if (!deps || !deps.length) {
//   //       continue
//   //     }
//   //     deps.forEach((inputDepKey) => {
//   //       if (!this.inputConfig[inputDepKey]) {
//   //         throw new AdapterInputError({
//   //           statusCode: 400,
//   //           message: `Input dependency/exclusive '${inputDepKey}' is missing in input schema`,
//   //         })
//   //       }
//   //     })
//   //   }
//   // }

//   // private validateRequiredConfig(configKey: string, normalized: NormalizedInput) {
//   //   if (!this.inputConfig[configKey].required) {
//   //     return
//   //   }

//   //   if (isEmpty(normalized[configKey])) {
//   //     this.throwInvalid(`Required parameter ${configKey} must be non-null and non-empty`)
//   //   }
//   // }

//   // private validateOptions(key: string, normalized: NormalizedInput) {
//   //   if (!this.inputConfig[key].options?.length) {
//   //     return
//   //   }

//   //   if (!this.inputConfig[key].options?.includes(normalized[key])) {
//   //     this.throwInvalid(
//   //       `${key} parameter must be one of following options: ${this.inputConfig[key].options?.join(
//   //         ',',
//   //       )}`,
//   //     )
//   //   }
//   // }

//   // private validateTypes(key: string, normalized: NormalizedInput) {
//   //   const type = this.inputConfig[key].type
//   //   if (!type) {
//   //     return
//   //   }

//   //   if (['array', 'object'].includes(type)) {
//   //     if (
//   //       type === 'array' &&
//   //       (!Array.isArray(normalized[key]) || (normalized[key] as unknown[]).length === 0)
//   //     ) {
//   //       this.throwInvalid(`${key} parameter must be a non-empty array`)
//   //     }
//   //     if (
//   //       type === 'object' &&
//   //       normalized[key] &&
//   //       (isNotObject(normalized[key] as Record<string, unknown>) ||
//   //         Object.keys(normalized[key] as Record<string, unknown>).length === 0)
//   //     ) {
//   //       this.throwInvalid(`${key} parameter must be an object with at least one property`)
//   //     }
//   //     return
//   //   } else if (typeof normalized[key] !== type) {
//   //     this.throwInvalid(`${key} parameter must be of type ${type}`)
//   //   }
//   // }

//   // private validateDeps(key: string, normalized: NormalizedInput) {
//   //   for (const dependency of this.inputConfig[key].dependsOn ?? []) {
//   //     const value = normalized[dependency]
//   //     if (isEmpty(value)) {
//   //       this.throwInvalid(`${key} dependency ${dependency} not supplied`)
//   //     }
//   //   }

//   //   for (const exclusive of this.inputConfig[key].exclusive ?? []) {
//   //     const value = normalized[exclusive]
//   //     if (!isEmpty(value)) {
//   //       this.throwInvalid(`${key} cannot be supplied concurrently with ${exclusive}`)
//   //     }
//   //   }
//   // }

//   // private getUsedKey = (allKeys: string[], input: Record<string, unknown>): string =>
//   //   allKeys.find((k) => input && !isEmpty(input[k])) || ''

//   // private throwInvalid = (message: string): void => {
//   //   throw new AdapterInputError({ statusCode: 400, message })
//   // }
// }
