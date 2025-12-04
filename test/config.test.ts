import test from 'ava'
import {
  AdapterConfig,
  BaseSettingsDefinition,
  getEnv,
  SettingDefinition,
  SettingsDefinitionMap,
} from '../src/config'
import { validator } from '../src/validation/utils'
import { Adapter } from "../src/adapter";
import { buildSettingsList } from "../src/util/settings";

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

test.serial('multiline sensitive configuration constants are properly redacted', async (t) => {
  // GIVEN
  process.env['PRIVATE_KEY'] = '-----BEGIN PRIVATE KEY-----\nthis\nis a fake\nprivate key\nused for testing only==\n-----END PRIVATE KEY-----'
  const customSettings: SettingsDefinitionMap = {
    PRIVATE_KEY: {
      description: 'Test custom env var',
      type: 'string',
      sensitive: true,
      validate: {
        meta: {
          details: 'placeholder validation',
        },
        fn: (value?: string) => {
          return ''
        }
      }
    },
  }
  const config = new AdapterConfig(customSettings)
  config.initialize()
  config.validate()
  config.buildCensorList()

  const adapter = new Adapter({
    name: "TEST_ADAPTER",
    endpoints: [],
    config: config,
  })

  const settingsList = buildSettingsList(adapter)

  const settingEntries = settingsList.filter((entry) => entry.name === 'PRIVATE_KEY')
  t.assert(settingEntries.length === 1)
  const settingEntry = settingEntries[0]
  t.assert(settingEntry.value === "[PRIVATE_KEY REDACTED]")
})