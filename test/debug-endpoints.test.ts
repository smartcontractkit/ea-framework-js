import test from 'ava'
import { start } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterConfig } from '../src/config'
import { NopTransport } from '../src/util/testing-utils'

test('/debug/settings endpoint returns expected values', async (t) => {
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
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
    config,
  })

  const { api } = await start(adapter)
  const settingsResponse = await api?.inject({ path: '/debug/settings' })
  if (!settingsResponse?.body) {
    t.fail()
    return
  }
  const parsedResponse = settingsResponse?.json()
  console.log(parsedResponse)
  // Test that framework setting is correctly set
  t.deepEqual(parsedResponse['DEBUG_ENDPOINTS'], {
    type: 'boolean',
    description:
      'Whether to enable debug enpoints (/debug/*) for this adapter. Enabling them might consume more resources.',
    required: false,
    default: false,
    customSetting: false,
    value: true,
  })
  // Test that env override is correctly accounted for
  t.deepEqual(parsedResponse['REQUESTER_SLEEP_BEFORE_REQUEUEING_MS'], {
    type: 'number',
    description: 'Time to sleep after a failed HTTP request before re-queueing the request (in ms)',
    required: false,
    default: 0,
    customSetting: false,
    envDefaultOverride: 9999,
    value: 9999,
  })
  // Test that custom adapter setting is correctly set and censored
  t.deepEqual(parsedResponse['API_KEY'], {
    type: 'string',
    description: 'Api key',
    required: true,
    sensitive: true,
    customSetting: true,
    value: '[API_KEY REDACTED]',
  })
})
