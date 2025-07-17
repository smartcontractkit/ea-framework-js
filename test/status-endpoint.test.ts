import test from 'ava'
import { start } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterConfig } from '../src/config'
import { StatusResponse } from '../src/status/router'
import { TransportRoutes } from '../src/transports'
import { NopTransport } from '../src/util/testing-utils'

test.serial('status endpoint returns expected values', async (t) => {
  process.env['API_KEY'] = '12312341234'

  const config = new AdapterConfig({
    API_KEY: {
      description: 'Api key',
      type: 'string',
      sensitive: true,
      required: true,
    },
  })

  // Create transport routes for the first endpoint
  const testTransports = new TransportRoutes()
    .register('http', new NopTransport())
    .register('websocket', new NopTransport())

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        aliases: ['alias1', 'alias2'],
        transportRoutes: testTransports,
        defaultTransport: 'http',
      }),
      new AdapterEndpoint({
        name: 'another',
        transportRoutes: new TransportRoutes().register('websocket', new NopTransport()),
        defaultTransport: 'websocket',
      }),
    ],
    config,
  })

  const { api } = await start(adapter)
  const statusResponse = await api?.inject({ path: '/status' })

  if (!statusResponse?.body) {
    t.fail()
    return
  }

  const parsedResponse = statusResponse?.json() as StatusResponse

  // Create expected response with all static values
  const expectedResponse: StatusResponse = {
    adapter: {
      name: 'TEST',
      version: parsedResponse.adapter.version,
      uptimeSeconds: parsedResponse.adapter.uptimeSeconds,
    },
    endpoints: [
      {
        name: 'test',
        aliases: ['alias1', 'alias2'],
        transports: ['http', 'websocket'],
      },
      {
        name: 'another',
        aliases: [],
        transports: ['websocket'],
      },
    ],
    defaultEndpoint: '', // No default endpoint set
    configuration: parsedResponse.configuration,
    runtime: {
      nodeVersion: parsedResponse.runtime.nodeVersion,
      platform: parsedResponse.runtime.platform,
      architecture: parsedResponse.runtime.architecture,
      hostname: parsedResponse.runtime.hostname,
    },
    metrics: {
      enabled: false,
    },
  }

  // Test the complete structure with deep equal
  t.deepEqual(parsedResponse, expectedResponse)

  // Test dynamic fields separately to ensure they have correct types/constraints
  t.is(typeof parsedResponse.adapter.uptimeSeconds, 'number')
  t.true(parsedResponse.adapter.uptimeSeconds >= 0)
  t.is(typeof parsedResponse.runtime.nodeVersion, 'string')
  t.true(parsedResponse.runtime.nodeVersion.length > 0)
  t.is(typeof parsedResponse.runtime.platform, 'string')
  t.true(parsedResponse.runtime.platform.length > 0)
  t.is(typeof parsedResponse.runtime.architecture, 'string')
  t.true(parsedResponse.runtime.architecture.length > 0)
  t.is(typeof parsedResponse.runtime.hostname, 'string')
  t.true(parsedResponse.runtime.hostname.length > 0)

  t.is(typeof parsedResponse.metrics.enabled, 'boolean')

  // Test specific configuration entries we know about
  const apiKeySetting = parsedResponse.configuration.find((s) => s.name === 'API_KEY')
  t.truthy(apiKeySetting)
  t.is(apiKeySetting?.value, '[API_KEY REDACTED]')
  t.is(apiKeySetting?.type, 'string')
  t.is(apiKeySetting?.required, true)
  t.is(apiKeySetting?.customSetting, true)
  t.is(apiKeySetting?.description, 'Api key')

  await api?.close()
})

test.serial('status endpoint redacts sensitive configuration values', async (t) => {
  // Set up sensitive environment variables that the framework uses
  process.env['API_KEY'] = '12312341234'
  process.env['CACHE_REDIS_PASSWORD'] = 'super-secret-redis-password'

  const config = new AdapterConfig({
    API_KEY: {
      description: 'Api key',
      type: 'string',
      sensitive: true,
      required: true,
    },
  })

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transportRoutes: new TransportRoutes().register('http', new NopTransport()),
        defaultTransport: 'http',
      }),
    ],
    config,
  })

  const { api } = await start(adapter)
  const statusResponse = await api?.inject({ path: '/status' })

  if (!statusResponse?.body) {
    t.fail()
    return
  }

  const parsedResponse = statusResponse?.json() as StatusResponse

  // Test that our custom API_KEY setting is redacted
  const apiKeySetting = parsedResponse.configuration.find((s) => s.name === 'API_KEY')
  t.truthy(apiKeySetting)
  t.is(apiKeySetting?.value, '[API_KEY REDACTED]')
  t.is(apiKeySetting?.type, 'string')
  t.is(apiKeySetting?.required, true)
  t.is(apiKeySetting?.customSetting, true)

  // Test that our custom CACHE_REDIS_PASSWORD setting is redacted
  const redisPasswordSetting = parsedResponse.configuration.find(
    (s) => s.name === 'CACHE_REDIS_PASSWORD',
  )
  t.truthy(redisPasswordSetting)
  t.is(redisPasswordSetting?.value, '[CACHE_REDIS_PASSWORD REDACTED]')

  await api?.close()
})
