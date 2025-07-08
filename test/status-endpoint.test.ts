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

  // Debug: Print response except for configs
  const debugResponse = { ...parsedResponse }
  delete (debugResponse as Partial<StatusResponse>).configuration

  // Test adapter information
  t.is(parsedResponse.adapter.name, 'TEST')
  t.is(parsedResponse.adapter.version, '2.6.0')
  t.is(typeof parsedResponse.adapter.uptimeSeconds, 'number')

  // Test endpoints is an array
  t.is(Array.isArray(parsedResponse.endpoints), true)
  t.is(parsedResponse.endpoints.length, 2)
  t.is(parsedResponse.endpoints[0].name, 'test')
  t.deepEqual(parsedResponse.endpoints[0].aliases, ['alias1', 'alias2'])
  t.deepEqual(parsedResponse.endpoints[0].transports, ['http', 'websocket'])
  t.is(parsedResponse.endpoints[1].name, 'another')
  t.deepEqual(parsedResponse.endpoints[1].aliases, [])
  t.deepEqual(parsedResponse.endpoints[1].transports, ['websocket'])

  // Test configuration is not empty
  t.is(Array.isArray(parsedResponse.configuration), true)
  t.true(parsedResponse.configuration.length > 0)

  // Test runtime information
  t.is(typeof parsedResponse.runtime.nodeVersion, 'string')
  t.is(typeof parsedResponse.runtime.platform, 'string')
  t.is(typeof parsedResponse.runtime.architecture, 'string')
  t.is(typeof parsedResponse.runtime.hostname, 'string')

  // Test metrics configuration
  t.is(typeof parsedResponse.metrics.enabled, 'boolean')
  t.is(parsedResponse.metrics.port, undefined)
  t.is(parsedResponse.metrics.endpoint, undefined)

  await api?.close()
})

test.serial('status endpoint redacts sensitive configuration values', async (t) => {
  process.env['API_KEY'] = '12312341234'

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

  // Test that sensitive API_KEY setting is redacted
  const apiKeySetting = parsedResponse.configuration.find((s) => s.name === 'API_KEY')
  t.truthy(apiKeySetting)
  t.is(apiKeySetting?.value, '[API_KEY REDACTED]')
  t.is(apiKeySetting?.type, 'string')
  t.is(apiKeySetting?.required, true)
  t.is(apiKeySetting?.customSetting, true)

  await api?.close()
})
