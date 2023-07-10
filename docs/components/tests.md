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
|  └─ fixture.ts // Contains the nocks for DP APIs and mock WS server for WS tests
```

Use nock for DP API mocks, and run tests with Jest where you compare outputs with snapshots.

You should be running integration tests without metrics, and the tests should support the EA running on any arbitrary port.

#### HTTP

The following is an example of HTTP transport integration tests (adapter.test.ts)

```typescript
import {
  TestAdapter,
  setEnvVariables,
} from '@chainlink/external-adapter-framework/util/testing-utils'
import * as nock from 'nock'
import { mockResponseSuccess } from './fixtures'

describe('execute', () => {
  let spy: jest.SpyInstance
  let testAdapter: TestAdapter
  let oldEnv: NodeJS.ProcessEnv

  beforeAll(async () => {
    oldEnv = JSON.parse(JSON.stringify(process.env))
    const mockDate = new Date('2022-01-01T11:11:11.111Z')
    spy = jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime())

    const adapter = (await import('./../../src')).adapter
    adapter.rateLimiting = undefined
    testAdapter = await TestAdapter.startWithMockedCache(adapter, {
      testAdapter: {} as TestAdapter<never>,
    })
  })

  afterAll(async () => {
    setEnvVariables(oldEnv)
    await testAdapter.api.close()
    nock.restore()
    nock.cleanAll()
    spy.mockRestore()
  })

  describe('test endpont', () => {
    it('should return success', async () => {
      const data = {
        base: 'ETH',
        quote: 'USD',
      }
      mockResponseSuccess()
      const response = await testAdapter.request(data)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchSnapshot()
    })
  })
})
```

#### Websocket

The following is an example of Websocket transport integration tests (adapter-ws.test.ts)

```typescript
import { WebSocketClassProvider } from '@chainlink/external-adapter-framework/transports'
import {
  TestAdapter,
  setEnvVariables,
  mockWebSocketProvider,
  MockWebsocketServer,
} from '@chainlink/external-adapter-framework/util/testing-utils'
import FakeTimers from '@sinonjs/fake-timers'
import { Adapter } from '@chainlink/external-adapter-framework/adapter'

// Usually this function is inside fixtures.ts
const mockCryptoWebSocketServer = (URL: string): MockWebsocketServer => {
  const mockWsServer = new MockWebsocketServer(URL, { mock: false })
  mockWsServer.on('connection', (socket) => {
    socket.on('message', () => {
      socket.send(JSON.stringify(mockCryptoResponse))
    })
  })
  return mockWsServer
}

describe('websocket', () => {
  let mockWsServer: MockWebsocketServer | undefined
  let testAdapter: TestAdapter
  const wsEndpoint = 'ws://localhost:9090'
  let oldEnv: NodeJS.ProcessEnv
  const data = {
    // Adapter request data, i.e. {base: 'ETH', quote: 'USD'}
  }

  beforeAll(async () => {
    oldEnv = JSON.parse(JSON.stringify(process.env))
    process.env['METRICS_ENABLED'] = 'false'
    process.env['WS_API_ENDPOINT'] = wsEndpoint

    mockWebSocketProvider(WebSocketClassProvider)
    mockWsServer = mockCryptoWebSocketServer(wsEndpoint)

    const adapter = (await import('./../../src')).adapter
    testAdapter = await TestAdapter.startWithMockedCache(adapter, {
      clock: FakeTimers.install(),
      testAdapter: {} as TestAdapter<never>,
    })

    // Send initial request to start background execute and wait for cache to be filled with results
    await testAdapter.request(data)
    await testAdapter.waitForCache(1)
  })

  afterAll(async () => {
    setEnvVariables(oldEnv)
    mockWsServer?.close()
    testAdapter.clock?.uninstall()
    await testAdapter.api.close()
  })

  describe('crypto endpoint', () => {
    it('should return success', async () => {
      const response = await testAdapter.request(data)
      expect(response.json()).toMatchSnapshot()
    })
  })
})
```
