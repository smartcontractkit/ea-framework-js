import test from 'ava'
import { start } from '../src'
import { Adapter } from '../src/adapter'
import { AdapterConfig } from '../src/config'
import { DebugPageSetting } from '../src/debug/settings-page'

test.serial('debug endpoints return 404 if env var is omitted', async (t) => {
  process.env['DEBUG_ENDPOINTS'] = undefined

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [],
  })

  const { api } = await start(adapter)

  const expect404ForPath = async (path: string) => {
    const error = await api?.inject({ path })
    t.is(error?.statusCode, 404)
  }

  await expect404ForPath('/debug/settings')
  await expect404ForPath('/debug/settings/raw')
})

test.serial('debug endpoints return 404 if env var is false', async (t) => {
  process.env['DEBUG_ENDPOINTS'] = 'false'

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [],
  })

  const { api } = await start(adapter)

  const expect404ForPath = async (path: string) => {
    const error = await api?.inject({ path })
    t.is(error?.statusCode, 404)
  }

  await expect404ForPath('/debug/settings')
  await expect404ForPath('/debug/settings/raw')
})

test.serial('/debug/settings/raw endpoint returns expected values', async (t) => {
  process.env['DEBUG_ENDPOINTS'] = 'true'
  process.env['API_KEY'] = '12312341234'

  const config = new AdapterConfig(
    {
      API_KEY: {
        description: 'Api key',
        type: 'string',
        sensitive: true,
        required: true,
      },
    },
    {
      envDefaultOverrides: {
        REQUESTER_SLEEP_BEFORE_REQUEUEING_MS: 9999,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [],
    config,
  })

  const { api } = await start(adapter)
  const settingsResponse = await api?.inject({ path: '/debug/settings/raw' })
  if (!settingsResponse?.body) {
    t.fail()
    return
  }
  const parsedResponse = settingsResponse?.json() as DebugPageSetting[]

  // Test that framework setting is correctly set
  t.deepEqual(
    parsedResponse.find((s) => s.name === 'DEBUG_ENDPOINTS'),
    {
      type: 'boolean',
      description:
        'Whether to enable debug enpoints (/debug/*) for this adapter. Enabling them might consume more resources.',
      name: 'DEBUG_ENDPOINTS',
      required: false,
      default: false,
      customSetting: false,
      value: true,
    },
  )
  // Test that env override is correctly accounted for
  t.deepEqual(
    parsedResponse.find((s) => s.name === 'REQUESTER_SLEEP_BEFORE_REQUEUEING_MS'),
    {
      type: 'number',
      description:
        'Time to sleep after a failed HTTP request before re-queueing the request (in ms)',
      name: 'REQUESTER_SLEEP_BEFORE_REQUEUEING_MS',
      required: false,
      default: 0,
      customSetting: false,
      envDefaultOverride: 9999,
      value: 9999,
    },
  )
  // Test that custom adapter setting is correctly set and censored
  t.deepEqual(
    parsedResponse.find((s) => s.name === 'API_KEY'),
    {
      type: 'string',
      description: 'Api key',
      name: 'API_KEY',
      required: true,
      sensitive: true,
      customSetting: true,
      value: '[API_KEY REDACTED]',
    },
  )
  // Test that setting with default is assigned that value if not set in env vars
  t.deepEqual(
    parsedResponse.find((s) => s.name === 'API_TIMEOUT'),
    {
      type: 'number',
      default: 30000,
      description:
        'The number of milliseconds a request can be pending before returning a timeout error for data provider request',
      name: 'API_TIMEOUT',
      required: false,
      customSetting: false,
      value: 30000,
    },
  )
  // Test that setting with no default is correctly processed
  t.deepEqual(
    parsedResponse.find((s) => s.name === 'RATE_LIMIT_API_TIER'),
    {
      type: 'string',
      description:
        'Rate limiting tier to use from the available options for the adapter. If not present, the adapter will run using the first tier on the list.',
      name: 'RATE_LIMIT_API_TIER',
      required: false,
      customSetting: false,
    },
  )
})

test.serial('/debug/settings returns html response', async (t) => {
  process.env['DEBUG_ENDPOINTS'] = 'true'
  process.env['API_KEY'] = '12312341234'

  const config = new AdapterConfig(
    {
      API_KEY: {
        description: 'Api key',
        type: 'string',
        sensitive: true,
        required: true,
      },
    },
    {
      envDefaultOverrides: {
        REQUESTER_SLEEP_BEFORE_REQUEUEING_MS: 9999,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [],
    config,
  })

  const { api } = await start(adapter)
  const settingsResponse = await api?.inject({ path: '/debug/settings' })
  const text = settingsResponse?.payload.trim()
  t.is(settingsResponse?.headers['content-type'], 'text/html')
  t.true(text?.startsWith('<html>') && text?.endsWith('</html>'))
})
