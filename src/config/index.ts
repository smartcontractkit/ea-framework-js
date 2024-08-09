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
    validate: validator.integer({ min: 1000, max: 20 * 60 * 1000 }), // Max 20 minutes
  },
  CACHE_MAX_ITEMS: {
    type: 'number',
    description: 'The maximum number of items that remain in the cache',
    default: 10000,
    validate: validator.integer({ min: 1000, max: 10000 }),
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
  },
  EA_HOST: {
    description:
      'Host this EA will listen for REST requests on (if mode is set to "reader" or "reader-writer")',
    type: 'string',
    default: '::',
    validate: validator.host(),
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
  },
  TLS_PUBLIC_KEY: {
    description: 'Base64 Public Key of TSL/SSL certificate',
    type: 'string',
    validate: validator.base64(),
  },
  TLS_PASSPHRASE: {
    description: 'Password to be used to generate an encryption key',
    type: 'string',
    default: '',
  },
  TLS_CA: {
    description: 'CA certificate to use for authenticating client certificates',
    type: 'string',
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
    validate: validator.integer({ min: 1000, max: 180_000 }),
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
} as const satisfies SettingsDefinitionMap

export const buildAdapterSettings = <
  CustomSettings extends CustomSettingsDefinition<CustomSettings> = EmptySettingsDefinitionMap,
>({
  overrides = {} as Partial<BaseAdapterSettings>,
  customSettings = {} as SettingsDefinitionMap,
  envVarsPrefix = '' as string,
}): AdapterSettings<CustomSettings> => {
  const vars = {} as Record<string, SettingValueType | undefined>

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
    const value = getEnv(key as string, config, envVarsPrefix) ?? config.default
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

export const getEnv = (
  name: string,
  settingsDefinition: SettingDefinition,
  prefix = '',
): SettingValueType | null => {
  const value = process.env[getEnvName(name, prefix)]

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

type SettingValueType = string | number | boolean
type SettingType<C extends SettingDefinition> = C['type'] extends 'string'
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
export type BaseSettingsDefinitionType = typeof BaseSettingsDefinition
export type SettingDefinition =
  | {
      type: 'string'
      description: string
      options?: never
      default?: string
      validate?: Validator<string>
      required?: false
      sensitive?: boolean
    }
  | {
      type: 'string'
      description: string
      options?: never
      default?: string
      validate?: Validator<string>
      required: true
      sensitive?: boolean
    }
  | {
      type: 'number'
      description: string
      options?: never
      default?: number
      validate?: Validator<number>
      required?: false
    }
  | {
      type: 'number'
      description: string
      options?: never
      default?: number
      validate?: Validator<number>
      required: true
    }
  | {
      type: 'boolean'
      description: string
      options?: never
      default?: boolean
      validate?: Validator<boolean>
      required?: false
    }
  | {
      type: 'boolean'
      description: string
      options?: never
      default?: boolean
      validate?: Validator<boolean>
      required: true
    }
  | {
      type: 'enum'
      description: string
      default?: string
      options: readonly string[]
      validate?: Validator<string>
      required?: false
    }
  | {
      type: 'enum'
      description: string
      default?: string
      options: readonly string[]
      validate?: Validator<string>
      required: true
    }

export type Settings<T extends SettingsDefinitionMap> = {
  -readonly [K in keyof T as T[K] extends {
    default: SettingValueType
  }
    ? K
    : T[K]['required'] extends true
    ? K
    : never]: SettingType<T[K]>
} & {
  -readonly [K in keyof T as T[K] extends {
    default: SettingValueType
  }
    ? never
    : T[K]['required'] extends true
    ? never
    : K]?: SettingType<T[K]> | undefined
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
export type SettingsDefinitionFromConfig<T> = T extends AdapterConfig<infer Definition>
  ? Definition
  : never

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
        validateSetting(
          name,
          (this.settings as Record<string, ValidSettingValue>)[name],
          setting,
          validationErrors,
        )
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
   */
  buildCensorList() {
    const censorList: CensorKeyValue[] = Object.entries(
      BaseSettingsDefinition as SettingsDefinitionMap,
    )
      .concat(Object.entries((this.settingsDefinition as SettingsDefinitionMap) || {}))
      .filter(
        ([name, setting]) =>
          setting &&
          setting.type === 'string' &&
          setting.sensitive &&
          (this.settings as Record<string, ValidSettingValue>)[name],
      )
      .map(([name]) => ({
        key: name,
        // Escaping potential special characters in values before creating regex
        value: new RegExp(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ((this.settings as Record<string, ValidSettingValue>)[name]! as string).replace(
            /[-[\]{}()*+?.,\\^$|#\s]/g,
            '\\$&',
          ),
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
type ValidSettingValue = string | number | boolean
export type GenericConfigStructure = BaseAdapterSettings & SettingsObjectSpecifier
