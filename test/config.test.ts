import test from 'ava'
import {
  AdapterConfig,
  BaseSettingsDefinition,
  getEnv,
  SettingDefinition,
  SettingsDefinitionMap,
} from '../src/config'
import { validator } from '../src/validation/utils'
import { Adapter } from '../src/adapter'
import { buildSettingsList } from '../src/util/settings'

test.afterEach(async () => {
  process.env = {}
})

test.serial('Test config validator', async (t) => {
  process.env['MAX_COMMON_KEY_SIZE'] = '1000'
  try {
    const config = new AdapterConfig({})
    config.initialize()
    config.validate()
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test good enum config', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  const config = new AdapterConfig({})
  config.initialize()
  config.validate()
  t.is(config.settings.CACHE_TYPE, 'local')
})

test.serial('Test bad enum config', async (t) => {
  process.env['CACHE_TYPE'] = 'test'
  try {
    const config = new AdapterConfig({})
    config.initialize()
    config.validate()
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test bad env name', async (t) => {
  try {
    getEnv('$#%', {} as SettingDefinition)
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test custom settings', async (t) => {
  process.env['CUSTOM_KEY'] = 'test'
  const customSettings = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'string',
    },
  } satisfies SettingsDefinitionMap
  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.CUSTOM_KEY, 'test')
})

test.serial('Test missing custom settings (required)', async (t) => {
  const customSettings: SettingsDefinitionMap = {
    CUSTOM_KEY_1: {
      description: 'Test custom env var',
      type: 'string',
      required: true,
    },
  }
  try {
    const config = new AdapterConfig(customSettings)
    config.initialize()
    config.validate()
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test custom settings (overlap base)', async (t) => {
  process.env['BASE_URL'] = 'test'
  const customSettings: SettingsDefinitionMap = {
    BASE_URL: {
      description: 'Test custom env var overlapping base',
      type: 'string',
    },
  }
  try {
    const config = new AdapterConfig(customSettings)
    config.initialize()
    config.validate()
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test prefix settings', async (t) => {
  process.env['TEST_PREFIX_BASE_URL'] = 'TEST_BASE_URL'
  const envVarsPrefix = 'TEST_PREFIX'
  const config = new AdapterConfig({}, { envVarsPrefix })
  config.initialize()
  t.is(config.settings['BASE_URL'], 'TEST_BASE_URL')
})

test.serial('Test validate function (out of bounds)', async (t) => {
  process.env['CUSTOM_KEY'] = '11'
  const customSettings: SettingsDefinitionMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'number',
      validate: validator.integer({ min: 1, max: 10 }),
    },
  }
  const config = new AdapterConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test validate function (decimal)', async (t) => {
  process.env['CUSTOM_KEY'] = '5.1'
  const customSettings: SettingsDefinitionMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'number',
      validate: validator.integer({ min: 1, max: 10 }),
    },
  }
  const config = new AdapterConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test.serial('Test validate function (scientific notation)', async (t) => {
  process.env['CUSTOM_KEY'] = '3.5e+6'
  const customSettings: SettingsDefinitionMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'number',
      validate: validator.integer({ min: 2_000_000, max: 5_000_000 }),
    },
  }
  const config = new AdapterConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.pass()
  } catch (_) {
    t.fail()
  }
})

test.serial('sensitive configuration constants are properly flagged', (t) => {
  // Extract all settings that are marked as sensitive
  const actualSensitiveSettings = Object.entries(BaseSettingsDefinition)
    .filter(([_, setting]) => (setting as { sensitive?: boolean }).sensitive === true)
    .map(([name]) => name)
    .sort()

  // Expected list of settings that should be marked as sensitive
  const expectedSensitiveSettings = [
    'CACHE_REDIS_PASSWORD',
    'CACHE_REDIS_URL',
    'TLS_CA',
    'TLS_PASSPHRASE',
    'TLS_PRIVATE_KEY',
  ].sort()

  // Deep equal comparison
  t.deepEqual(actualSensitiveSettings, expectedSensitiveSettings)
})

test.serial('API_KEY prefix/suffix settings are always censored', (t) => {
  process.env['API_KEY_PRIMARY'] = 'prefixed-key'
  process.env['PRIMARY_API_KEY'] = 'suffixed-key'
  process.env['ETHEREUM_API_KEY'] = 'variable-env-var'
  process.env['NOT_SECRET'] = 'plain-value'
  const customSettings: SettingsDefinitionMap = {
    API_KEY_PRIMARY: {
      description: 'API key that is mistakenly marked as insensitive',
      type: 'string',
      sensitive: false,
    },
    PRIMARY_API_KEY: {
      description: 'API key suffix that is mistakenly marked as insensitive',
      type: 'string',
      sensitive: false,
    },
    NETWORK_API_KEY: {
      description: 'Variable API key that is mistakenly marked as insensitive',
      type: 'string',
      variablePlaceholder: 'NETWORK',
      sensitive: false,
    },
    NOT_SECRET: {
      description: 'Plain text that should not be censored',
      type: 'string',
      sensitive: false,
    },
  }
  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  config.buildCensorList()

  const adapter = new Adapter({
    name: 'TEST_ADAPTER',
    endpoints: [],
    config: config,
  })

  const settingsList = buildSettingsList(adapter)
  const apiKeyPrimary = settingsList.find((entry) => entry.name === 'API_KEY_PRIMARY')
  const primaryApiKey = settingsList.find((entry) => entry.name === 'PRIMARY_API_KEY')
  const ethereumApiKey = settingsList.find((entry) => entry.name === 'ETHEREUM_API_KEY')
  const notSecret = settingsList.find((entry) => entry.name === 'NOT_SECRET')

  t.is(apiKeyPrimary?.value, '[API_KEY_PRIMARY REDACTED]')
  t.is(primaryApiKey?.value, '[PRIMARY_API_KEY REDACTED]')
  t.is(ethereumApiKey?.value, '[ETHEREUM_API_KEY REDACTED]')
  t.is(notSecret?.value, 'plain-value')
})

test.serial('multiline sensitive configuration constants are properly redacted', async (t) => {
  // GIVEN
  process.env['PRIVATE_KEY'] =
    '-----BEGIN PRIVATE KEY-----\nthis\nis a fake\nprivate key\nused for testing only==\n-----END PRIVATE KEY-----'
  const customSettings: SettingsDefinitionMap = {
    PRIVATE_KEY: {
      description: 'Test custom env var',
      type: 'string',
      sensitive: true,
      validate: {
        meta: {
          details: 'placeholder validation',
        },
        fn: (_?: string) => {
          return ''
        },
      },
    },
  }
  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  config.buildCensorList()

  const adapter = new Adapter({
    name: 'TEST_ADAPTER',
    endpoints: [],
    config: config,
  })

  const settingsList = buildSettingsList(adapter)

  const settingEntries = settingsList.filter((entry) => entry.name === 'PRIVATE_KEY')
  t.assert(settingEntries.length === 1)
  const settingEntry = settingEntries[0]
  t.assert(settingEntry.value === '[PRIVATE_KEY REDACTED]')
})

test.serial('Get optional variable env var', async (t) => {
  const url = 'https://ethereum.rpc.url'
  process.env['ETHEREUM_RPC_URL'] = url
  const customSettings = {
    NETWORK_RPC_URL: {
      description: 'RPC URL for the given network',
      type: 'string',
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.NETWORK_RPC_URL.get('ethereum'), url)
  t.is(config.settings.NETWORK_RPC_URL.get('arbitrum'), undefined)
})

test.serial('Get required variable env var', async (t) => {
  const url = 'https://ethereum.rpc.url'
  process.env['ETHEREUM_RPC_URL'] = url
  const customSettings = {
    NETWORK_RPC_URL: {
      description: 'RPC URL for the given network',
      type: 'string',
      required: true,
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.NETWORK_RPC_URL.get('ethereum'), url)
  try {
    config.settings.NETWORK_RPC_URL.get('arbitrum')
    t.fail()
  } catch (error) {
    t.is((error as Error).message, 'Missing required environment variable: ARBITRUM_RPC_URL')
  }
})

test.serial('Get variable env var with default', async (t) => {
  const url = 'https://ethereum.rpc.url'
  const defaultUrl = 'https://default.rpc.url'
  process.env['ETHEREUM_RPC_URL'] = url
  const customSettings = {
    NETWORK_RPC_URL: {
      description: 'RPC URL for the given network',
      type: 'string',
      default: defaultUrl,
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.NETWORK_RPC_URL.get('ethereum'), url)
  t.is(config.settings.NETWORK_RPC_URL.get('arbitrum'), defaultUrl)
})

test.serial('Get variable env var with non-word character', async (t) => {
  const url = 'https://ethereum.rpc.url'
  process.env['ETHEREUM_1_RPC_URL'] = url
  const customSettings = {
    NETWORK_RPC_URL: {
      description: 'RPC URL for the given network',
      type: 'string',
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.NETWORK_RPC_URL.get('ethereum-1'), url)
})

test.serial('Get number variable env var', async (t) => {
  process.env['ETHEREUM_RPC_CHAIN_ID'] = '1'
  process.env['ARBITRUM_RPC_CHAIN_ID'] = '42161'
  const customSettings = {
    NETWORK_RPC_CHAIN_ID: {
      description: 'Chain ID for the given network',
      type: 'number',
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.NETWORK_RPC_CHAIN_ID.get('ethereum'), 1)
  t.is(config.settings.NETWORK_RPC_CHAIN_ID.get('arbitrum'), 42161)
})

test.serial('Validate number variable env var', async (t) => {
  process.env['ETHEREUM_RPC_CHAIN_ID'] = '-1'
  const customSettings = {
    NETWORK_RPC_CHAIN_ID: {
      description: 'Chain ID for the given network',
      type: 'number',
      variablePlaceholder: 'NETWORK',
      validate: validator.integer({ min: 1, max: 10000000 }),
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.fail()
  } catch (error) {
    t.is(
      (error as Error).message,
      'Validation failed for the following variables:\nETHEREUM_RPC_CHAIN_ID: Minimum allowed value is 1. Received -1',
    )
  }
})

test.serial('Get enum variable env var', async (t) => {
  process.env['ETHEREUM_NETWORK_TYPE'] = 'mainnet'
  process.env['SEPOLIA_NETWORK_TYPE'] = 'testnet'
  const customSettings = {
    NETWORK_NETWORK_TYPE: {
      description: 'Network type for the given blockchain',
      type: 'enum',
      options: ['mainnet', 'testnet'],
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.settings.NETWORK_NETWORK_TYPE.get('ethereum'), 'mainnet')
  t.is(config.settings.NETWORK_NETWORK_TYPE.get('sepolia'), 'testnet')
})

test.serial('Validate enum variable env var', async (t) => {
  process.env['SEPOLIA_NETWORK_TYPE'] = 'not_a_valid_option'
  const customSettings = {
    NETWORK_NETWORK_TYPE: {
      description: 'Network type for the given blockchain',
      type: 'enum',
      options: ['mainnet', 'testnet'],
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings)
  try {
    config.initialize()
    t.fail()
  } catch (error) {
    t.is(
      (error as Error).message,
      'Env var "SEPOLIA_NETWORK_TYPE" has value "not_a_valid_option" which is not included in the valid options (mainnet,testnet)',
    )
  }
})

test.serial('Validate enum variable env var with prefix', async (t) => {
  process.env['PREFIX_ETHEREUM_NETWORK_TYPE'] = 'mainnet'
  process.env['PREFIX_SEPOLIA_NETWORK_TYPE'] = 'not-valid'
  const envVarsPrefix = 'PREFIX'
  const customSettings = {
    NETWORK_NETWORK_TYPE: {
      description: 'Network type for the given blockchain',
      type: 'enum',
      options: ['mainnet', 'testnet'],
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings, { envVarsPrefix })
  try {
    config.initialize()
    t.fail()
  } catch (error) {
    t.is(
      (error as Error).message,
      'Env var "SEPOLIA_NETWORK_TYPE" has value "not-valid" which is not included in the valid options (mainnet,testnet)',
    )
  }
})

test.serial('Validate enum env var with prefix', async (t) => {
  process.env['PREFIX_SEPOLIA_NETWORK_TYPE'] = 'not-valid'
  const envVarsPrefix = 'PREFIX'
  const customSettings = {
    SEPOLIA_NETWORK_TYPE: {
      description: 'Network type for sepolia',
      type: 'enum',
      options: ['mainnet', 'testnet'],
    },
  } as const

  const config = new AdapterConfig(customSettings, { envVarsPrefix })
  try {
    config.initialize()
    t.fail()
  } catch (error) {
    t.is(
      (error as Error).message,
      'Env var "SEPOLIA_NETWORK_TYPE" has value "not-valid" which is not included in the valid options (mainnet,testnet)',
    )
  }
})

test.serial('Get variable env var entries', async (t) => {
  process.env['PREFIX_ETHEREUM_NETWORK_TYPE'] = 'mainnet'
  process.env['PREFIX_SEPOLIA_NETWORK_TYPE'] = 'testnet'
  const envVarsPrefix = 'PREFIX'
  const customSettings = {
    NETWORK_NETWORK_TYPE: {
      description: 'Network type for the given blockchain',
      type: 'enum',
      options: ['mainnet', 'testnet'],
      variablePlaceholder: 'NETWORK',
    },
  } as const

  const config = new AdapterConfig(customSettings, { envVarsPrefix })
  config.initialize()
  config.validate()
  t.deepEqual(config.settings.NETWORK_NETWORK_TYPE.entries(), [
    {
      envVarName: 'PREFIX_ETHEREUM_NETWORK_TYPE',
      settingKey: 'NETWORK_NETWORK_TYPE',
      settingName: 'ETHEREUM_NETWORK_TYPE',
      value: 'mainnet',
      variable: 'ETHEREUM',
    },
    {
      envVarName: 'PREFIX_SEPOLIA_NETWORK_TYPE',
      settingKey: 'NETWORK_NETWORK_TYPE',
      settingName: 'SEPOLIA_NETWORK_TYPE',
      value: 'testnet',
      variable: 'SEPOLIA',
    },
  ])
})
