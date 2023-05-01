# Tests

Define tests in the `/test` folder. Separate folder can be created for `integration`, `unit`, and `e2e` tests within.

### Integration Tests

Integration tests can be setup with the following structure.

```
test
├─ integration
│  ├─ __snapshots__
|  |  ├─ adapter.test.ts.snap // Contains snapshot for all test responses
│  ├─ adapter.test.ts // Contains the integration tests
|  ├─ fixture.ts // Contains the nocks for DP APIs
|  └─ setup.ts // Contains the setup helpers
```

Use nock for DP API mocks, and run tests with Jest where you compare outputs with snapshots.

You should be running integration tests without metrics, and the tests should support the EA running on any arbitrary port.

#### HTTP

The following is an example of setup helpers for HTTP transport integration tests

```typescript
import request, { SuperTest, Test } from 'supertest'
import { AddressInfo } from 'net'
import * as process from 'process'
import * as nock from 'nock'
import { ServerInstance } from '@chainlink/external-adapter-framework'

export type SuiteContext = {
  req: SuperTest<Test> | null
  server: () => Promise<ServerInstance>
  fastify?: ServerInstance
}

export type EnvVariables = { [key: string]: string }

export type TestOptions = { cleanNock?: boolean; fastify?: boolean }

export const setupExternalAdapterTest = (
  envVariables: NodeJS.ProcessEnv,
  context: SuiteContext,
  options: TestOptions = { cleanNock: true, fastify: false },
): void => {
  let fastify: ServerInstance

  beforeAll(async () => {
    process.env['METRICS_ENABLED'] = 'false'
    for (const key in envVariables) {
      process.env[key] = envVariables[key]
    }

    if (process.env['RECORD']) {
      nock.recorder.rec()
    }
    fastify = await context.server()

    context.req = request(`localhost:${(fastify.server.address() as AddressInfo).port}`)

    // Only for edge cases when someone needs to use the fastify instance outside this function
    if (options.fastify) {
      context.fastify = fastify
    }
  })

  afterAll(async () => {
    if (process.env['RECORD']) {
      nock.recorder.play()
    }

    await fastify.close()
  })
}
```

You can then use this in your tests:

```typescript
import { SuperTest, Test } from 'supertest'
import { setupExternalAdapterTest, SuiteContext } from './setup'
import { ServerInstance } from '@chainlink/external-adapter-framework'
import { mockRateResponseSuccess } from './fixtures'

describe('execute', () => {
  const id = '1'
  let spy: jest.SpyInstance
  beforeAll(async () => {
    const mockDate = new Date('2022-01-01T11:11:11.111Z')
    spy = jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime())
  })

  afterAll((done) => {
    spy.mockRestore()
    done()
  })

  const context: SuiteContext = {
    req: null,
    server: async () => {
      process.env['RATE_LIMIT_CAPACITY_SECOND'] = '6'
      process.env['METRICS_ENABLED'] = 'false'
      process.env['API_KEY'] = 'fake-api-key'
      const server = (await import('../../src')).server
      return server() as Promise<ServerInstance>
    },
  }

  const envVariables = {
    CACHE_ENABLED: 'false',
  }

  setupExternalAdapterTest(envVariables, context)

  describe('test endpoint', () => {
    const data = {
      // Adapter request
    }

    it('should return success', async () => {
      mockRateResponseSuccess()

      const response = await (context.req as SuperTest<Test>)
        .post('/')
        .send(data)
        .set('Accept', '*/*')
        .set('Content-Type', 'application/json')
        .expect('Content-Type', /json/)
        .expect(200)
      expect(response.body).toMatchSnapshot()
    })
  })
})
```

#### Websocket

The following can be used as a setup helper for an adapter with a websocket transport:

```typescript
import * as process from 'process'
import { ServerInstance } from '@chainlink/external-adapter-framework'
import { SuperTest, Test } from 'supertest'
import { WebSocketClassProvider } from '@chainlink/external-adapter-framework/transports'
import { Server, WebSocket } from 'mock-socket'
import { PriceAdapter } from '@chainlink/external-adapter-framework/adapter'
import { endpoint } from '../../src/endpoint/price'
import { SettingsMap } from '@chainlink/external-adapter-framework/config'
import { customSettings } from '../../src/config'

export type SuiteContext = {
  req: SuperTest<Test> | null
  server: () => Promise<ServerInstance>
  fastify?: ServerInstance
}

export type EnvVariables = { [key: string]: string }

export type TestOptions = { cleanNock?: boolean; fastify?: boolean }

export const mockWebSocketProvider = (provider: typeof WebSocketClassProvider): void => {
  // Extend mock WebSocket class to bypass protocol headers error
  class MockWebSocket extends WebSocket {
    constructor(url: string, protocol: string | string[] | Record<string, string> | undefined) {
      super(url, protocol instanceof Object ? undefined : protocol)
    }
    removeAllListeners() {
      for (const eventType in this.listeners) {
        if (!eventType.startsWith('server')) {
          delete this.listeners[eventType]
        }
      }
    }
    // Mock WebSocket does not come with built on function which adapter handlers could be using for ws
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    on(_: Event) {
      return
    }
  }

  // Need to disable typing, the mock-socket impl does not implement the ws interface fully
  provider.set(MockWebSocket as any) // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const mockWebSocketServer = (URL: string) => {
  const mockWsServer = new Server(URL, { mock: false })
  mockWsServer.on('connection', (socket) => {
    socket.on('message', () => {
      socket.send(
        JSON.stringify({
          // Mock websocket message
        }),
      )
    })
  })
  return mockWsServer
}

export const createAdapter = (): PriceAdapter<SettingsMap> => {
  return new PriceAdapter({
    name: 'test',
    defaultEndpoint: 'price',
    endpoints: [endpoint],
    customSettings,
  })
}

export function setEnvVariables(envVariables: NodeJS.ProcessEnv): void {
  for (const key in envVariables) {
    process.env[key] = envVariables[key]
  }
}
```

You can then use this in your tests:

```typescript
import * as process from 'process'
import { AddressInfo } from 'net'
import {
  mockWebSocketProvider,
  mockCryptoWebSocketServer,
  createAdapter,
  setEnvVariables,
  mockForexWebSocketServer,
} from './setup'
import request, { SuperTest, Test } from 'supertest'
import { Server } from 'mock-socket'
import { expose, ServerInstance } from '@chainlink/external-adapter-framework'
import { AdapterRequestBody, sleep } from '@chainlink/external-adapter-framework/util'
import { WebSocketClassProvider } from '@chainlink/external-adapter-framework/transports'

describe('Crypto Endpoint', () => {
  let fastify: ServerInstance | undefined
  let req: SuperTest<Test>
  let mockCryptoWsServer: Server | undefined
  let spy: jest.SpyInstance
  const wsCryptoEndpoint = 'ws://localhost:9090'

  jest.setTimeout(10000)

  const data: AdapterRequestBody = {
    // Adapter request
  }

  let oldEnv: NodeJS.ProcessEnv

  beforeAll(async () => {
    oldEnv = JSON.parse(JSON.stringify(process.env))
    process.env['WS_SUBSCRIPTION_TTL'] = '5000'
    process.env['CACHE_MAX_AGE'] = '5000'
    process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
    process.env['METRICS_ENABLED'] = 'false'
    process.env['WS_API_ENDPOINT'] = wsCryptoEndpoint
    process.env['RATE_LIMIT_CAPACITY_SECOND'] = '2'
    const mockDate = new Date('2022-08-01T07:14:54.909Z')
    spy = jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime())

    mockWebSocketProvider(WebSocketClassProvider)
    mockCryptoWsServer = mockCryptoWebSocketServer(wsCryptoEndpoint)

    fastify = await expose(createAdapter())
    req = request(`http://localhost:${(fastify?.server.address() as AddressInfo).port}`)

    // Send initial request to start background execute
    await req.post('/').send(data)
    await sleep(5000)
  })

  afterAll((done) => {
    spy.mockRestore()
    setEnvVariables(oldEnv)
    mockCryptoWsServer?.close()
    fastify?.close(done())
  })
  it('should return success', async () => {
    const makeRequest = () =>
      req
        .post('/')
        .send(data)
        .set('Accept', '*/*')
        .set('Content-Type', 'application/json')
        .expect('Content-Type', /json/)

    const response = await makeRequest()
    expect(response.body).toMatchSnapshot()
  }, 30000)
})
```
