import test from 'ava'
import { ProcessedConfig, SettingsMap } from '../src/config'
import { validator } from '../src/validation/utils'

test.afterEach(async () => {
  process.env = {}
})

test.serial('Test config validator', async (t) => {
  process.env['MAX_COMMON_KEY_SIZE'] = '1000'
  try {
    const config = new ProcessedConfig({})
    config.initialize()
    config.validate()
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test good enum config', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  const config = new ProcessedConfig({})
  config.initialize()
  config.validate()
  t.is(config.config.CACHE_TYPE, 'local')
})

test.serial('Test bad enum config', async (t) => {
  process.env['CACHE_TYPE'] = 'test'
  try {
    const config = new ProcessedConfig({})
    config.initialize()
    config.validate()
    t.fail()
  } catch (e: unknown) {
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
  } satisfies SettingsMap
  const config = new ProcessedConfig(customSettings)
  config.initialize()
  config.validate()
  t.is(config.config.CUSTOM_KEY, 'test')
})

test.serial('Test missing custom settings (required)', async (t) => {
  const customSettings: SettingsMap = {
    CUSTOM_KEY_1: {
      description: 'Test custom env var',
      type: 'string',
      required: true,
    },
  }
  try {
    const config = new ProcessedConfig(customSettings)
    config.initialize()
    config.validate()
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test custom settings (overlap base)', async (t) => {
  process.env['BASE_URL'] = 'test'
  const customSettings: SettingsMap = {
    BASE_URL: {
      description: 'Test custom env var overlapping base',
      type: 'string',
    },
  }
  try {
    const config = new ProcessedConfig(customSettings)
    config.initialize()
    config.validate()
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test prefix settings', async (t) => {
  process.env['TEST_PREFIX_BASE_URL'] = 'TEST_BASE_URL'
  const envVarsPrefix = 'TEST_PREFIX'
  const config = new ProcessedConfig({}, { envVarsPrefix })
  config.initialize()
  t.is(config.config['BASE_URL'], 'TEST_BASE_URL')
})

test.serial('Test validate function (out of bounds)', async (t) => {
  process.env['CUSTOM_KEY'] = '11'
  const customSettings: SettingsMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'number',
      validate: validator.integer({ min: 1, max: 10 }),
    },
  }
  const config = new ProcessedConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.fail()
  } catch (e) {
    t.pass()
  }
})

test.serial('Test validate function (decimal)', async (t) => {
  process.env['CUSTOM_KEY'] = '5.1'
  const customSettings: SettingsMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'number',
      validate: validator.integer({ min: 1, max: 10 }),
    },
  }
  const config = new ProcessedConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.fail()
  } catch (e) {
    t.pass()
  }
})

test.serial('Test validate function (scientific notation)', async (t) => {
  process.env['CUSTOM_KEY'] = '3.5e+6'
  const customSettings: SettingsMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'number',
      validate: validator.integer({ min: 2_000_000, max: 5_000_000 }),
    },
  }
  const config = new ProcessedConfig(customSettings)
  config.initialize()
  try {
    config.validate()
    t.pass()
  } catch (e) {
    t.fail()
  }
})
