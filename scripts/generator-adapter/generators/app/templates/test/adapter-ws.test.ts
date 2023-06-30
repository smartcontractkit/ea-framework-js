import { WebSocketClassProvider } from '@chainlink/external-adapter-framework/transports'
import {
  TestAdapter,
  setEnvVariables,
  mockWebSocketProvider,
  MockWebsocketServer,
} from '@chainlink/external-adapter-framework/util/testing-utils'
import FakeTimers from '@sinonjs/fake-timers'
import { mockWebsocketServer } from './fixtures'


describe('websocket', () => {
  let mockWsServer: MockWebsocketServer | undefined
  let testAdapter: TestAdapter
  const wsEndpoint = 'ws://localhost:9090'
  let oldEnv: NodeJS.ProcessEnv
<% for(let i=0; i<wsEndpoints.length; i++) {%>
  const data<%- wsEndpoints[i].normalizedEndpointNameCap %> = {
    base: 'ETH',
    quote: 'USD',
    endpoint: '<%- wsEndpoints[i].endpointName %>',
    transport: 'ws'
  }
<% } %>
  beforeAll(async () => {
    oldEnv = JSON.parse(JSON.stringify(process.env))
    process.env['WS_API_ENDPOINT'] = wsEndpoint
    process.env['API_KEY'] = 'fake-api-key'
    mockWebSocketProvider(WebSocketClassProvider)
    mockWsServer = mockWebsocketServer(wsEndpoint)

    const adapter = (await import('./../../src')).adapter
    testAdapter = await TestAdapter.startWithMockedCache(adapter, {
      clock: FakeTimers.install(),
      testAdapter: {} as TestAdapter<never>,
    })

    // Send initial request to start background execute and wait for cache to be filled with results
<% for(var i=0; i<wsEndpoints.length; i++) {%>
    await testAdapter.request(data<%- wsEndpoints[i].normalizedEndpointNameCap %>) <% } %>
    await testAdapter.waitForCache(<%- wsEndpoints.length %>)
  })

  afterAll(async () => {
    setEnvVariables(oldEnv)
    mockWsServer?.close()
    testAdapter.clock?.uninstall()
    await testAdapter.api.close()
  })
<% for(var i=0; i<wsEndpoints.length; i++) {%>
  describe('<%= wsEndpoints[i].endpointName %> endpoint', () => {
    it('should return success', async () => {
      const response = await testAdapter.request(data<%- wsEndpoints[i].normalizedEndpointNameCap %>)
      expect(response.json()).toMatchSnapshot()
    })
  })
<% } %>
})
