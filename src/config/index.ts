import { validator } from '../validation/utils'

export const BaseSettings = {
  // V2 compat
  // ADAPTER_URL: {
  //   description: 'The URL of another adapter from which data needs to be retrieved',
  //   type: 'string',
  // },
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
  CACHE_MAX_AGE: {
    description: 'Maximum amount of time (in ms) that a response will stay cached',
    type: 'number',
    default: 90000,
    validate: validator.integer({ min: 1000, max: 180000 }),
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
  // CACHE_REDIS_MAX_QUEUED_ITEMS: {
  //   description: 'Maximum length of the client internal command queue',
  //   type: 'number',
  //   default: 500,
  // },
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
  CORRELATION_ID_ENABLED: {
    description: 'Flag to enable correlation IDs for sent requests in logging',
    type: 'boolean',
    default: true,
  },
  // DATA_PROVIDER_URL: {
  //   description: 'Legacy variable that has the same functionality as ADAPTER_URL',
  //   type: 'string',
  // },
  DEBUG: {
    description: 'Toggles debug mode',
    type: 'boolean',
    default: false,
  },
  // DEFAULT_WS_HEARTBEAT_INTERVAL: {
  //   description: 'Interval between WS heartbeat pings (ms)',
  //   type: 'number',
  //   default: 30000,
  // },
  EA_PORT: {
    description:
      'Port through which the EA will listen for REST requests (if mode is set to "reader" or "reader-writer")',
    type: 'number',
    default: 8080,
    validate: validator.port(),
  },
  // ERROR_CAPACITY: {
  //   type: 'number',
  // },
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
    validate: validator.integer({ min: 1, max: 10 }),
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
      'The maximum acceptable time (in milliseconds) since the last message received on a WebSocket connection before it is considered unresponsive, causing the adapter to close and attempt to reopen it.',
    type: 'number',
    default: 120000,
    validate: validator.integer({ min: 1000, max: 180000 }),
  },
  // WS_TIME_UNTIL_HANDLE_NEXT_MESSAGE_OVERRIDE: {
  //   description: 'Time to wait until adapter should handle next WS message',
  //   type: 'number',
  // },

  // V3
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
  SMOKE_TEST_PAYLOAD_FILE_NAME: {
    description: 'Name of the test payload file used for the smoke endpoint',
    type: 'string',
  },
  MTLS_ENABLED: {
    description: 'Flag to specify whether mutual TLS/SSL is enabled or not',
    type: 'boolean',
    default: false,
  },
  TLS_PRIVATE_KEY: {
    description: 'Base64 Private Key of TSL/SSL certificate',
    type: 'string',
  },
  TLS_PUBLIC_KEY: {
    description: 'Base64 Public Key of TSL/SSL certificate',
    type: 'string',
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
} as const satisfies SettingsMap

export const buildAdapterConfig = <
  CustomSettings extends CustomSettingsType<CustomSettings> = EmptySettings,
>({
  overrides = {} as Partial<BaseAdapterConfig>,
  customSettings = {} as SettingsMap,
  envVarsPrefix = '' as string,
}): AdapterConfig<CustomSettings> => {
  const vars = {} as Record<string, SettingValueType | undefined>

  // Iterate base adapter env vars
  for (const [key, config] of Object.entries(BaseSettings) as Array<
    [keyof BaseAdapterConfig, Setting]
  >) {
    const value = getEnv(key as string, config, envVarsPrefix) ?? overrides?.[key] ?? config.default
    vars[key] = value
  }

  // Iterate custom vars
  for (const [key, config] of Object.entries(customSettings) as Array<[string, Setting]>) {
    if ((BaseSettings as Record<string, unknown>)[key as string]) {
      throw new Error(
        `Custom env var "${key}" declared, but a base framework env var with that name already exists.`,
      )
    }
    const value = getEnv(key as string, config, envVarsPrefix) ?? config.default
    vars[key] = value
  }

  return vars as AdapterConfig<CustomSettings>
}

export const validateAdapterConfig = <
  CustomSettings extends CustomSettingsType<CustomSettings> = EmptySettings,
>(
  adapterConfig: AdapterConfig<CustomSettings>,
  customSettings = {} as SettingsMap,
): void => {
  const validationErrors: string[] = []
  Object.entries(BaseSettings as SettingsMap)
    .concat(Object.entries((customSettings as SettingsMap) || {}))
    .forEach(([name, setting]) => {
      validateSetting(name, (adapterConfig as AdapterConfig)[name], setting, validationErrors)
    })

  if (validationErrors.length > 0) {
    throw new Error(
      `Validation failed for the following variables:\n ${validationErrors.join('\n')}`,
    )
  }
}

const validateSetting = (
  key: string,
  value: SettingValueType | undefined,
  config: Setting,
  validationErrors: string[],
) => {
  // Check if a required setting has been provided
  if (config.required && (value === null || value === undefined)) {
    validationErrors.push(`${key}: Value is required, but none was provided`)
  } else if (value && config.validate) {
    // Cast validate to unknown because TS can't select one of multiple variants of the validate function signature
    const validationRes = (
      config.validate as unknown as (value?: SettingValueType) => ValidationErrorMessage
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

export const getEnv = (name: string, config: Setting, prefix = ''): SettingValueType | null => {
  const value = process.env[getEnvName(name, prefix)]

  if (!value || value === '' || value === '""') {
    return null
  }

  switch (config.type) {
    case 'string':
      return value
    case 'number':
      return Number(value)
    case 'boolean':
      return value === 'true'
    case 'enum':
      if (!config.options?.includes(value)) {
        throw new Error(
          `Env var "${name}" has value "${value}" which is not included in the valid options (${config.options})`,
        )
      }
      return value
  }
}

type SettingValueType = string | number | boolean
type SettingType<C extends Setting> = C['type'] extends 'string'
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
type BaseSettingsType = typeof BaseSettings
export type Setting =
  | {
      type: 'string'
      description: string
      options?: never
      default?: string
      validate?: (value?: string) => ValidationErrorMessage
      required?: false
      sensitive?: boolean
    }
  | {
      type: 'string'
      description: string
      options?: never
      default?: string
      validate?: (value: string) => ValidationErrorMessage
      required: true
      sensitive?: boolean
    }
  | {
      type: 'number'
      description: string
      options?: never
      default?: number
      validate?: (value?: number) => ValidationErrorMessage
      required?: false
    }
  | {
      type: 'number'
      description: string
      options?: never
      default?: number
      validate?: (value: number) => ValidationErrorMessage
      required: true
    }
  | {
      type: 'boolean'
      description: string
      options?: never
      default?: boolean
      validate?: (value?: boolean) => ValidationErrorMessage
      required?: false
    }
  | {
      type: 'boolean'
      description: string
      options?: never
      default?: boolean
      validate?: (value: boolean) => ValidationErrorMessage
      required: true
    }
  | {
      type: 'enum'
      description: string
      default?: string
      options: readonly string[]
      validate?: (value?: string) => ValidationErrorMessage
      required?: false
    }
  | {
      type: 'enum'
      description: string
      default?: string
      options: readonly string[]
      validate?: (value: string) => ValidationErrorMessage
      required: true
    }

export type AdapterConfigFromSettings<T extends SettingsMap> = {
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

export type BaseAdapterConfig = AdapterConfigFromSettings<BaseSettingsType>
export type AdapterConfig<T extends CustomSettingsType<T> = SettingsMap> =
  AdapterConfigFromSettings<T> & BaseAdapterConfig

export type CustomSettingsType<T = SettingsMap> = Record<keyof T, Setting>
export type EmptySettings = Record<string, never>
export type SettingsMap = Record<string, Setting>
export type ValidationErrorMessage = string | undefined
