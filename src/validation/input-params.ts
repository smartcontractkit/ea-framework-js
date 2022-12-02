/* INPUT TYPE VALIDATIONS */
export type Override = Map<string, Map<string, string>>

export type InputParameter = {
  aliases?: readonly string[]
  description?: string
  type?: 'bigint' | 'boolean' | 'array' | 'number' | 'object' | 'string'
  required?: boolean
  options?: unknown[] // Enumerated options, ex. ['ADA', 'BTC', 'ETH']
  default?: unknown
  dependsOn?: readonly string[] // Other inputs this one depends on
  exclusive?: readonly string[] // Other inputs that cannot be present with this one
}

export type InputParameters = {
  [name: string]: InputParameter
}
