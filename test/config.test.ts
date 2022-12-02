import test from 'ava'
import { buildAdapterConfig, SettingsMap, validateAdapterConfig } from '../src/config'

test.afterEach(async (t) => {
  process.env = {}
})

test.serial('Test config validator', async (t) => {
  process.env['MAX_COMMON_KEY_SIZE'] = '1000'
  try {
    const config = buildAdapterConfig({})
    validateAdapterConfig(config)
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test good enum config', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  const config = buildAdapterConfig({})
  validateAdapterConfig(config)
  t.is(config.CACHE_TYPE, 'local')
})

test.serial('Test bad enum config', async (t) => {
  process.env['CACHE_TYPE'] = 'test'
  try {
    const config = buildAdapterConfig({})
    validateAdapterConfig(config)
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test custom settings', async (t) => {
  process.env['CUSTOM_KEY'] = 'test'
  const customSettings: SettingsMap = {
    CUSTOM_KEY: {
      description: 'Test custom env var',
      type: 'string',
    },
  }
  const config = buildAdapterConfig({ customSettings })
  validateAdapterConfig(config, customSettings)
  t.is(config['CUSTOM_KEY'], 'test')
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
    const config = buildAdapterConfig({ customSettings })
    validateAdapterConfig(config, customSettings)
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
    const config = buildAdapterConfig({ customSettings })
    validateAdapterConfig(config, customSettings)
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('Test prefix settings', async (t) => {
  process.env['TEST_PREFIX_BASE_URL'] = 'TEST_BASE_URL'
  const envVarsPrefix = 'TEST_PREFIX'
  const config = buildAdapterConfig({ envVarsPrefix })
  t.is(config['BASE_URL'], 'TEST_BASE_URL')
})
