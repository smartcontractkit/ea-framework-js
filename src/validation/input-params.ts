import { ReservedInputParameterNames } from '../util'

/* INPUT TYPE VALIDATIONS */
export type Override = Map<string, Map<string, string>>

type ParameterType = 'bigint' | 'boolean' | 'array' | 'number' | 'object' | 'string'

export type InputParameter = {
  aliases?: readonly string[]
  description?: string
  type?: ParameterType
  required?: boolean
  options?: unknown[] // Enumerated options, ex. ['ADA', 'BTC', 'ETH']
  default?: unknown
  dependsOn?: readonly string[] // Other inputs this one depends on
  exclusive?: readonly string[] // Other inputs that cannot be present with this one
}

// Improve this, it's counting these with endopint and transport as undefined but existing
export type InputParameters = {
  [name: string]: InputParameter
} & {
  [K in ReservedInputParameterNames]?: never
}

export type SpecificInputParameters<T> = {
  [K in keyof T]: InputParameter
}
