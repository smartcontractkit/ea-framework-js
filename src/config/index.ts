import CensorList, { CensorKeyValue } from '../util/censor/censor-list'
import { Validator, validator } from '../validation/utils'

export const BaseSettingsDefinition = {
  API_TIMEOUT: {
    description:
      'The number of milliseconds a request can be pending before returning a timeout error for data provider request',
    type: 'number',
    default: 30000,
    validate: validator.integer({ min: 0, max: 60000 }),
  },
  API_VERBOSE: {
    description:
      'Toggle whether the response from the EA should contain just the results or also include the full response body from the queried API.',
    type: 'boolean',
    default: false,
  },
  BASE_URL: {
    description: 'Starting path for the EA handler endpoint',
    type: 'string',
    default: '/',
    sensitive: false,
  },
  CACHE_LOCK_DURATION: {
    description: 'Time (in ms) used as a baseline for the acquisition and extension of cache locks',
    type: 'number',
    default: 10000,
  },
  CACHE_LOCK_RETRIES: {
    description: 'Number of retries to acquire a cache lock',
    type: 'number',
    default: 10,
  },
  CACHE_LOCK_DEFERRAL_MS: {
    description: 'The amount of time (in ms) to wait before attempting to lock the cache',
    type: 'number',
    default: 60000,
  },
  CACHE_MAX_AGE: {
    description: 'Maximum amount of time (in ms) that a response will stay cached',
    type: 'number',
    default: 90000,
    validate: validator.integer({ min: 1000, max: 60 * 60 * 1000 }), // Max 1 hour
  },
  CACHE_MAX_ITEMS: {
    type: 'number',
    description: 'The maximum number of items that remain in the cache',
    default: 10000,
    validate: validator.integer({ min: 1000, max: 50000 }),
  },
  CACHE_REDIS_CONNECTION_TIMEOUT: {
    description: 'Connection timeout for redis client',
    type: 'number',
    default: 15000,
    validate: validator.integer({ min: 3000, max: 60000 }),
  },
  CACHE_REDIS_HOST: {
    description: 'Hostname for the Redis instance to be used',
    type: 'string',
    default: '127.0.0.1',
    sensitive: false,
  },
  CACHE_REDIS_MAX_RECONNECT_COOLDOWN: {
    description: 'Max cooldown (in ms) before attempting redis reconnection',
    type: 'number',
    default: 3000,
    validate: validator.integer({ min: 3000, max: 10000 }),
  },
  CACHE_REDIS_PASSWORD: {
    description: 'The password required for redis auth',
    type: 'string',
    sensitive: true,
  },
  CACHE_REDIS_PATH: {
    description: 'The UNIX socket string of the Redis server',
    type: 'string',
    sensitive: false,
  },
  CACHE_REDIS_PORT: {
    description: 'Port for the Redis instance to be used',
    type: 'number',
    default: 6379,
    validate: validator.port(),
  },
  CACHE_REDIS_TIMEOUT: {
    description: 'Timeout to fail a Redis server request if no response (ms)',
    type: 'number',
    default: 500,
    validate: validator.integer({ min: 500, max: 10000 }),
  },
  CACHE_REDIS_URL: {
    description:
      'The URL of the Redis server. Format: [redis[s]:]//[[user][:password@]][host][:port][/db-number][?db=db-number[&password=bar[&option=value]]]',
    type: 'string',
    validate: validator.url(),
    sensitive: true,
  },
  CACHE_TYPE: {
    description: 'The type of cache to use throughout the EA',
    type: 'enum',
    default: 'local',
    options: ['local', 'redis'],
  },
  CACHE_PREFIX: {
    description: 'Specifies a prefix to use for cache keys',
    type: 'string',
    default: '',
    sensitive: false,
  },
  STREAM_HANDLER_RETRY_MAX_MS: {
    type: 'number',
    description:
      'The maximum time (ms) to wait before running the stream handler (takes precedent over STREAM_HANDLER_RETRY_MIN_MS',
    default: 20 * 60 * 1000,
    validate: validator.integer({ min: 3_000, max: 24 * 60 * 60 * 1000 }),
  },
  STREAM_HANDLER_RETRY_MIN_MS: {
    type: 'number',
    description: 'The minimum/base time (ms) to wait before trying to run the stream handler',
    default: 100,
    validate: validator.integer({ min: 100, max: 10_000 }),
  },
  STREAM_HANDLER_RETRY_EXP_FACTOR: {
    type: 'number',
    description:
      'The factor for exponential back-off to wait before running the stream handler (1 = no change from STREAM_HANDLER_RETRY_MIN_MS)',
    default: 3,
    validate: validator.integer({ min: 1, max: 10 }),
  },
  SUBSCRIPTION_SET_MAX_ITEMS: {
    type: 'number',
    description: 'The maximum number of subscriptions set',
    default: 10000,
    validate: validator.integer({ min: 1000, max: 10000 }),
  },
  CORRELATION_ID_ENABLED: {
    description: 'Flag to enable correlation IDs for sent requests in logging',
    type: 'boolean',
    default: true,
  },
  DEBUG: {
    description: 'Toggles debug mode',
    type: 'boolean',
    default: false,
  },
  EA_PORT: {
    description:
      'Port through which the EA will listen for REST requests (if mode is set to "reader" or "reader-writer")',
    type: 'number',
    default: 8080,
    validate: validator.port(),
  },
  EXPERIMENTAL_METRICS_ENABLED: {
    description:
      'Flag to specify whether or not to collect metrics. Used as fallback for METRICS_ENABLED',
    type: 'boolean',
    default: true,
  },
  LOG_LEVEL: {
    description: 'Minimum level required for logs to be output',
    type: 'string',
    default: 'info',
    sensitive: false,
  },
  CENSOR_SENSITIVE_LOGS: {
    description: 'Controls whether the logging of sensitive information is enabled or disabled',
    type: 'boolean',
    default: false,
  },
  MAX_PAYLOAD_SIZE_LIMIT: {
    description: 'Max payload size limit for the Fastify server',
    type: 'number',
    default: 1048576,
    validate: validator.integer({ min: 1048576, max: 1073741824 }),
  },
  METRICS_ENABLED: {
    description: 'Flag to specify whether or not to startup the metrics server',
    type: 'boolean',
    default: true,
  },
  METRICS_PORT: {
    description: 'Port metrics will be exposed to',
    type: 'number',
    default: 9080,
    validate: validator.port(),
  },
  METRICS_USE_BASE_URL: {
    description: 'Flag to specify whether or not to prepend the BASE_URL to the metrics endpoint',
    type: 'boolean',
  },
  RATE_LIMIT_API_TIER: {
    description:
      'Rate limiting tier to use from the available options for the adapter. If not present, the adapter will run using the first tier on the list.',
    type: 'string',
    sensitive: false,
  },
  RATE_LIMIT_CAPACITY: {
    description: 'Used as rate limit capacity per minute and ignores tier settings if defined',
    type: 'number',
    validate: validator.integer({ min: 0 }),
  },
  RATE_LIMIT_CAPACITY_MINUTE: {
    description:
      'Used as rate limit capacity per minute and ignores tier settings if defined. Supercedes RATE_LIMIT_CAPACITY if both vars are set',
    type: 'number',
    validate: validator.integer({ min: 0 }),
  },
  RATE_LIMIT_CAPACITY_SECOND: {
    description: 'Used as rate limit capacity per second and ignores tier settings if defined',
    type: 'number',
    validate: validator.integer({ min: 0 }),
  },
  RETRY: {
    type: 'number',
    description: 'Retry count for failed HTTP requests',
    default: 1,
    validate: validator.integer({ min: 0, max: 10 }),
  },
  SSE_KEEPALIVE_SLEEP: {
    description: 'Maximum amount of time (in ms) between each SSE keepalive request',
    type: 'number',
    default: 60000,
    validate: validator.integer({ min: 0, max: 120000 }),
  },
  SSE_SUBSCRIPTION_TTL: {
    description:
      'Maximum amount of time (in ms) an SSE subscription will be cached before being unsubscribed',
    type: 'number',
    default: 300000,
    validate: validator.integer({ min: 0, max: 3600000 }),
  },
  WARMUP_SUBSCRIPTION_TTL: {
    type: 'number',
    description: 'TTL for batch warmer subscriptions',
    default: 300000,
    validate: validator.integer({ min: 0, max: 3600000 }),
  },
  WS_SUBSCRIPTION_TTL: {
    description: 'The time in ms a request will live in the subscription set before becoming stale',
    type: 'number',
    default: 120000,
    validate: validator.integer({ min: 0, max: 3600000 }),
  },
  WS_SUBSCRIPTION_UNRESPONSIVE_TTL: {
    description:
      'The maximum acceptable time (in milliseconds) since the last message was received and stored in the cache on a WebSocket connection before it is considered unresponsive, causing the adapter to close and attempt to reopen it.',
    type: 'number',
    default: 120000,
    validate: validator.integer({ min: 1000, max: 180000 }),
  },
  WS_CONNECTION_OPEN_TIMEOUT: {
    description:
      'The maximum amount of time in milliseconds to wait for the websocket connection to open (including custom open handler)',
    type: 'number',
    default: 10_000,
    validate: validator.integer({ min: 500, max: 30_000 }),
  },
  WS_HEARTBEAT_INTERVAL_MS: {
    description:
      'The number of ms between each hearbeat message that EA sends to server, only works if heartbeat handler is provided',
    type: 'number',
    default: 10_000,
    validate: validator.integer({ min: 5_000, max: 300_000 }),
  },
  CACHE_POLLING_MAX_RETRIES: {
    description:
      'Max amount of times to attempt to find EA response in the cache after the Transport has been set up',
    type: 'number',
    default: 10,
    validate: validator.integer({ min: 0, max: 20 }),
  },
  CACHE_POLLING_SLEEP_MS: {
    description:
      'The number of ms to sleep between each retry to fetch the EA response in the cache',
    type: 'number',
    default: 200,
    validate: validator.integer({ min: 10, max: 1000 }),
  },
  DEFAULT_CACHE_KEY: {
    description: 'Default key to be used when one cannot be determined from request parameters',
    type: 'string',
    default: 'DEFAULT_CACHE_KEY',
    sensitive: false,
  },
  EA_HOST: {
    description:
      'Host this EA will listen for REST requests on (if mode is set to "reader" or "reader-writer")',
    type: 'string',
    default: '::',
    validate: validator.host(),
    sensitive: false,
  },
  EA_MODE: {
    description:
      'Port this EA will listen for REST requests on (if mode is set to "reader" or "reader-writer")',
    type: 'enum',
    default: 'reader-writer',
    options: ['reader', 'writer', 'reader-writer'],
  },
  MAX_COMMON_KEY_SIZE: {
    description:
      'Maximum amount of characters that the common part of the cache key or feed ID can have',
    type: 'number',
    default: 300,
    validate: validator.integer({ min: 150, max: 500 }),
  },
  MTLS_ENABLED: {
    description: 'Flag to specify whether mutual TLS/SSL is enabled or not',
    type: 'boolean',
    default: false,
  },
  TLS_ENABLED: {
    description: 'Flag to specify whether TLS/SSL is enabled or not',
    type: 'boolean',
    default: false,
  },
  TLS_PRIVATE_KEY: {
    description: 'Base64 Private Key of TSL/SSL certificate',
    type: 'string',
    validate: validator.base64(),
    sensitive: true,
  },
  TLS_PUBLIC_KEY: {
    description: 'Base64 Public Key of TSL/SSL certificate',
    type: 'string',
    validate: validator.base64(),
    sensitive: false,
  },
  TLS_PASSPHRASE: {
    description: 'Password to be used to generate an encryption key',
    type: 'string',
    default: '',
    sensitive: true,
  },
  TLS_CA: {
    description: 'CA certificate to use for authenticating client certificates',
    type: 'string',
    sensitive: true,
  },
  MAX_HTTP_REQUEST_QUEUE_LENGTH: {
    description:
      'The maximum amount of queued requests for Http transports before new ones push oldest ones out of the queue',
    type: 'number',
    default: 200,
    validate: validator.integer({ min: 1, max: 2000 }),
  },
  BACKGROUND_EXECUTE_MS_SSE: {
    description: "Time in milliseconds to sleep between SSE transports' background execute calls",
    type: 'number',
    default: 1000,
    validate: validator.integer({ min: 1, max: 10000 }),
  },
  BACKGROUND_EXECUTE_MS_WS: {
    description: "Time in milliseconds to sleep between WS transports' background execute calls",
    type: 'number',
    default: 1000,
    validate: validator.integer({ min: 1, max: 10000 }),
  },
  BACKGROUND_EXECUTE_MS_HTTP: {
    description:
      "Time in milliseconds to sleep between HTTP transports' background execute calls, when there are no requests to send",
    type: 'number',
    default: 1000,
    validate: validator.integer({ min: 1, max: 10000 }),
  },
  BACKGROUND_EXECUTE_TIMEOUT: {
    description:
      'The maximum amount of time in milliseconds to wait for a background execute to finish',
    type: 'number',
    default: 90_000,
    validate: validator.integer({ min: 1000, max: 10 * 60 * 1000 }), // Max 10 minutes
  },
  RATE_LIMITING_STRATEGY: {
    description: 'The rate limiting strategy to use for outbound requests',
    type: 'enum',
    options: ['burst', 'fixed-interval'],
    default: 'fixed-interval',
  },
  REQUESTER_SLEEP_BEFORE_REQUEUEING_MS: {
    type: 'number',
    description: 'Time to sleep after a failed HTTP request before re-queueing the request (in ms)',
    default: 0,
    validate: validator.integer({ min: 0, max: 120000 }),
  },
  DEBUG_ENDPOINTS: {
    type: 'boolean',
    description:
      'Whether to enable debug enpoints (/debug/*) for this adapter. Enabling them might consume more resources.',
    default: false,
  },
  NORMALIZE_CASE_INPUTS: {
    type: 'boolean',
    description:
      'When true, normalizes base and quote input parameters to uppercase before cache key computation and subscription registration. Set to false for adapters that require case-sensitive asset identifiers.',
    default: true,
  },
} as const satisfies SettingsDefinitionMap

export const buildAdapterSettings = <
  CustomSettings extends CustomSettingsDefinition<CustomSettings> = EmptySettingsDefinitionMap,
>({
  overrides = {} as Partial<BaseAdapterSettings>,
  customSettings = {} as SettingsDefinitionMap,
  envVarsPrefix = '' as string,
}): AdapterSettings<CustomSettings> => {
  const vars = {} as Record<
    string,
    SettingValueType | undefined | Getter<SettingValueType | undefined>
  >

  // Iterate base adapter env vars
  for (const [key, config] of Object.entries(BaseSettingsDefinition) as Array<
    [keyof BaseAdapterSettings, SettingDefinition]
  >) {
    const value = getEnv(key as string, config, envVarsPrefix) ?? overrides?.[key] ?? config.default
    vars[key] = value
  }

  // Iterate custom vars
  for (const [key, config] of Object.entries(customSettings) as Array<
    [string, SettingDefinition]
  >) {
    if ((BaseSettingsDefinition as Record<string, unknown>)[key as string]) {
      throw new Error(
        `Custom env var "${key}" declared, but a base framework env var with that name already exists.`,
      )
    }
    const value = getEnvOrEnvGetter(key as string, config, envVarsPrefix)
    vars[key] = value
  }

  return vars as AdapterSettings<CustomSettings>
}

const validateSetting = (
  key: string,
  value: SettingValueType | undefined,
  settingsDefinition: SettingDefinition,
  validationErrors: string[],
) => {
  // Check if a required setting has been provided
  if (settingsDefinition.required && (value === null || value === undefined)) {
    validationErrors.push(`${key}: Value is required, but none was provided`)
  } else if (value && settingsDefinition.validate) {
    // Cast validate to unknown because TS can't select one of multiple variants of the validate function signature
    const validationRes = (
      settingsDefinition.validate.fn as unknown as (
        value?: SettingValueType,
      ) => ValidationErrorMessage
    )(value)
    if (validationRes) {
      validationErrors.push(`${key}: ${validationRes}`)
    }
  }
}

const getEnvName = (name: string, prefix = ''): string => {
  const envName = prefix ? `${prefix}_${name}` : name
  if (!isEnvNameValid(envName)) {
    throw new Error(
      `Invalid environment var name: ${envName}. Only '/^[_a-z0-9]+$/i' is supported.`,
    )
  }
  return envName
}

const isEnvNameValid = (name: string) => /^[_a-z0-9]+$/i.test(name)

export const getEnvOrEnvGetter = (
  name: string,
  settingsDefinition: SettingDefinition,
  prefix = '',
): SettingValueType | undefined | Getter<SettingValueType | undefined> => {
  if (settingsDefinition.variablePlaceholder === undefined) {
    return getEnv(name, settingsDefinition, prefix) ?? settingsDefinition.default
  }
  return new EnvGetter(name, settingsDefinition, prefix)
}

export const getEnv = (
  name: string,
  settingsDefinition: SettingDefinition,
  prefix = '',
): SettingValueType | null => {
  const value = process.env[getEnvName(name, prefix)]
  return parseEnv(value, name, settingsDefinition)
}

export const parseEnv = (
  value: string | undefined,
  name: string,
  settingsDefinition: SettingDefinition,
): SettingValueType | null => {
  if (!value || value === '' || value === '""') {
    return null
  }

  switch (settingsDefinition.type) {
    case 'string':
      return value
    case 'number':
      return Number(value)
    case 'boolean':
      return value === 'true'
    case 'enum':
      if (!settingsDefinition.options?.includes(value)) {
        throw new Error(
          `Env var "${name}" has value "${value}" which is not included in the valid options (${settingsDefinition.options})`,
        )
      }
      return value
  }
}

type VariableEnvVarEntry<T extends ValidSettingValue> = {
  // The name used in the settings definition. E.g., 'NETWORK_RPC_URL'
  settingKey: string
  // The variable part for a specific instance. E.g., 'ETHEREUM'
  variable: string
  // The setting key with the variable part replaced. E.g., 'ETHEREUM_RPC_URL'
  settingName: string
  // The actual name in the environment. E.g., 'PREFIX_ETHEREUM_RPC_URL'
  envVarName: string
  // The parsed value. E.g., some URL.
  value: T
}

export interface Getter<T extends SettingValueType | undefined> {
  get(variable: string): T
  entries(): VariableEnvVarEntry<Exclude<T, undefined>>[]
}

export class EnvGetter<
  T extends SettingDefinition & IsVariable = Extract<SettingDefinition, IsVariable>,
> {
  private name: string
  private settingsDefinition: T
  private prefix: string
  private variableMap: Record<string, VariableEnvVarEntry<SettingTypeWhenPresent<T>>> = {}

  constructor(name: string, settingsDefinition: T, prefix: string) {
    this.name = name
    this.settingsDefinition = settingsDefinition
    this.prefix = prefix

    const namePattern = this.getNamePattern(name, settingsDefinition.variablePlaceholder, prefix)
    for (const [envVarName, value] of Object.entries(process.env)) {
      const match = envVarName.match(namePattern)
      if (!match) {
        continue
      }
      const variablePart = match[1]
      const settingName = name.replace(settingsDefinition.variablePlaceholder, variablePart)
      const parsed = parseEnv(value, settingName, settingsDefinition)
      if (parsed !== null) {
        this.variableMap[variablePart] = {
          settingKey: name,
          variable: variablePart,
          settingName,
          envVarName,
          value: parsed as SettingTypeWhenPresent<T>,
        }
      }
    }
  }

  // If the setting name is 'NETWORK_RPC_URL' and `variablePlaceholder` is
  // 'NETWORK', then `namePattern` will be /([A-Z0-9_]+)_RPC_URL/ to match
  // all relevant environment variables and extract the variable part.
  getNamePattern(name: string, placeholder: string, prefix: string) {
    if (!name.includes(placeholder)) {
      throw new Error(`Placeholder '${placeholder}' must occur in setting name '${name}'.`)
    }

    let nameForPattern = name
    let placeholderForPattern = placeholder
    if ((prefix ?? '').includes(placeholder)) {
      // Use a placeholder that's definitely not part of the prefix.
      placeholderForPattern = `___${prefix}___`
      nameForPattern = name.replace(placeholder, placeholderForPattern)
    }

    // We can't inject the regexp before calling getEnvName because getEnvName
    // checks for valid characters. So we made sure we use a placeholder that
    // doesn't interfere with the prefix.
    return new RegExp(
      `^${getEnvName(nameForPattern, prefix).replace(placeholderForPattern, '([A-Z0-9_]+)')}$`,
    )
  }

  get(variable: string): SettingType<T> {
    const canonicalVariable = variable.replace(/\W/g, '_').toUpperCase()
    if (canonicalVariable in this.variableMap) {
      return this.variableMap[canonicalVariable].value as SettingType<T>
    }
    if (this.settingsDefinition.default !== undefined) {
      return this.settingsDefinition.default as SettingType<T>
    }
    if (!this.settingsDefinition.required) {
      return undefined as SettingType<T>
    }
    const envName = getEnvName(
      this.name.replace(this.settingsDefinition.variablePlaceholder, canonicalVariable),
      this.prefix,
    )
    throw new Error(`Missing required environment variable: ${envName}`)
  }

  entries(): VariableEnvVarEntry<SettingTypeWhenPresent<T>>[] {
    return Object.values(this.variableMap)
  }

  validate(validationErrors: string[]) {
    for (const { settingName, value } of Object.values(this.variableMap)) {
      validateSetting(settingName, value, this.settingsDefinition, validationErrors)
    }
  }
}

type SettingValueType = string | number | boolean
type SettingTypeWhenPresent<C extends SettingDefinition> = C['type'] extends 'string'
  ? string
  : C['type'] extends 'number'
    ? number
    : C['type'] extends 'boolean'
      ? boolean
      : C['type'] extends 'enum'
        ? C['options'] extends readonly string[]
          ? C['options'][number]
          : never
        : never
type SettingType<C extends SettingDefinition> = C extends HasDefault | IsRequired
  ? SettingTypeWhenPresent<C>
  : SettingTypeWhenPresent<C> | undefined

export type BaseSettingsDefinitionType = typeof BaseSettingsDefinition

export type SettingDefinitionBase = {
  description: string
  sensitive?: boolean
  required?: boolean
} & ({ variablePlaceholder?: never } | { variablePlaceholder: string })

export type NonEnumSettingDefinition<TypeString, Type> = SettingDefinitionBase & {
  type: TypeString
  default?: Type
  validate?: Validator<Type>
  options?: never
}

export type EnumSettingDefinition = SettingDefinitionBase & {
  type: 'enum'
  default?: string
  validate?: Validator<string>
  options: readonly string[]
}

export type SettingDefinition =
  | NonEnumSettingDefinition<'string', string>
  | NonEnumSettingDefinition<'number', number>
  | NonEnumSettingDefinition<'boolean', boolean>
  | EnumSettingDefinition

type HasDefault = { default: SettingValueType }
type IsRequired = { required: true }

type IsOptional = {
  default?: never
  required?: false
  // With just `default` and `required` both optional, the type matches `{}`,
  // which means it's a weak type which gets treated differently by TypeScript.
  // So we add `description`, which is anyway guaranteed to be present.
  description: string
}

type IsVariable = { variablePlaceholder: string }
type IsFixed = {
  variablePlaceholder?: never
  // Add description for the same issue with weak types as in IsOptional.
  description: string
}

type VariableSettingKeys<T extends SettingsDefinitionMap> = {
  [K in keyof T]: T[K] extends IsVariable ? K : never
}[keyof T]

type FixedSettingKeys<T extends SettingsDefinitionMap> = {
  [K in keyof T]: T[K] extends IsFixed ? K : never
}[keyof T]

type NonOptionalSettingKeys<T extends SettingsDefinitionMap> = {
  [K in keyof T]: T[K] extends HasDefault | IsRequired ? K : never
}[keyof T]

type OptionalSettingKeys<T extends SettingsDefinitionMap> = {
  [K in keyof T]: T[K] extends IsOptional ? K : never
}[keyof T]

export type Settings<T extends SettingsDefinitionMap> = {
  -readonly [K in Extract<FixedSettingKeys<T>, OptionalSettingKeys<T>>]?:
    | SettingTypeWhenPresent<T[K]>
    | undefined
} & {
  -readonly [K in Extract<FixedSettingKeys<T>, NonOptionalSettingKeys<T>>]: SettingTypeWhenPresent<
    T[K]
  >
} & {
  -readonly [K in VariableSettingKeys<T>]: Getter<SettingType<T[K]>>
}

export type BaseAdapterSettings = Settings<BaseSettingsDefinitionType>
export type EmptyCustomSettings = BaseAdapterSettings
export type AdapterSettings<T extends CustomSettingsDefinition<T> = object> = Settings<T> &
  BaseAdapterSettings &
  SettingsObjectSpecifier

export type CustomSettingsDefinition<T = SettingsDefinitionMap> = Record<keyof T, SettingDefinition>
export type EmptySettingsDefinitionMap = Record<string, never>
export type SettingsDefinitionMap = Record<string, SettingDefinition>
export type ValidationErrorMessage = string | undefined
export type SettingsDefinitionFromConfig<T> =
  T extends AdapterConfig<infer Definition> ? Definition : never

export type SettingDefinitionDetails = {
  type: string
  description: string
  required: boolean
  sensitive: boolean
  default: unknown
  customSetting: boolean
  envDefaultOverride: unknown
}

/**
 * This class will hold the processed config type, and the basic settings.
 * The idea is that you can no longer use a straight object, but have to build a config,
 * then in the generics we can simply pass the type of this, and it will hopefully allow for simpler generics
 */
export class AdapterConfig<T extends SettingsDefinitionMap = SettingsDefinitionMap> {
  settings!: AdapterSettings<T>

  constructor(
    /** Map of setting definitions to validate and use to get setting values */
    private settingsDefinition: T,
    public options?: {
      /** Map of overrides to the default config values for an Adapter */
      envDefaultOverrides?: Partial<BaseAdapterSettings>

      /** Optional prefix that all adapter variables will be expected to have */
      envVarsPrefix?: string
    },
  ) {}

  /**
   * Performs some basic validation of the definition structure, and pull data from environment variables
   */
  initialize() {
    this.settings = buildAdapterSettings({
      customSettings: this.settingsDefinition,
      overrides: this.options?.envDefaultOverrides,
      envVarsPrefix: this.options?.envVarsPrefix,
    })
  }

  /**
   * Performs validation of each setting, checking to see that they match their definition
   */
  validate(): void {
    const validationErrors: string[] = []
    Object.entries(BaseSettingsDefinition as SettingsDefinitionMap)
      .concat(Object.entries(this.settingsDefinition || {}))
      .forEach(([name, setting]) => {
        if (setting.variablePlaceholder !== undefined) {
          const getter = (this.settings as unknown as Record<string, EnvGetter>)[name]
          getter.validate(validationErrors)
        } else {
          validateSetting(
            name,
            (this.settings as Record<string, ValidSettingValue>)[name],
            setting,
            validationErrors,
          )
        }
      })

    if (validationErrors.length > 0) {
      throw new Error(
        `Validation failed for the following variables:\n${validationErrors.join('\n')}`,
      )
    }
  }

  /**
   * Creates a list of key/value pairs that need to be censored in the logs
   * using the sensitive flag in the adapter config
   * RPC_URL are potentially sensitive given it may contain API keys in path
   */
  buildCensorList() {
    const alwaysCensored = ['RPC_URL', 'API_KEY']
    const censorList: CensorKeyValue[] = Object.entries(
      BaseSettingsDefinition as SettingsDefinitionMap,
    )
      .concat(Object.entries((this.settingsDefinition as SettingsDefinitionMap) || {}))
      .filter(
        ([name, setting]) =>
          setting &&
          setting.type === 'string' &&
          (setting.sensitive !== false ||
            alwaysCensored.some((pattern) => name.includes(pattern))) &&
          (this.settings as Record<string, ValidSettingValue>)[name],
      )
      .flatMap(([name]) => {
        const settings = this.settings as Record<
          string,
          ValidSettingValue | Getter<ValidSettingValue>
        >
        const settingValue = settings[name]
        if (settingValue instanceof EnvGetter) {
          return settingValue
            .entries()
            .map(
              ({ settingName, value }) =>
                [settingName, value] satisfies [string, ValidSettingValue],
            )
        }
        return [[name as string, settingValue]] as [string, ValidSettingValue][]
      })
      .map(([name, value]: [string, ValidSettingValue]) => ({
        key: name,
        value: new RegExp(
          (value! as string)
            // Escaping potential special characters in values before creating regex
            .replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
            // Escaping special case for new line characters. This is needed to properly match and censor private keys,
            // ssh keys, and other multi-line string values.
            .replace(/\n/g, '\\n'),
          'gi',
        ),
      }))
    CensorList.set(censorList)
  }

  getSettingDebugDetails(settingName: string): SettingDefinitionDetails {
    const settingDefinition =
      this.settingsDefinition[settingName] ||
      BaseSettingsDefinition[settingName as keyof BaseSettingsDefinitionType]

    const details = {
      type: settingDefinition.type,
      description: settingDefinition.description,
      required: settingDefinition.required || false,
      default: settingDefinition.default,
      sensitive: (settingDefinition as { sensitive: boolean }).sensitive,
      customSetting: !!this.settingsDefinition[settingName],
      envDefaultOverride:
        this.options?.envDefaultOverrides?.[settingName as keyof BaseAdapterSettings],
    }

    return details
  }
}

type SettingsObjectSpecifier = {
  __reserved_settings: never
}
export type ValidSettingValue = string | number | boolean
export type GenericConfigStructure = BaseAdapterSettings & SettingsObjectSpecifier
