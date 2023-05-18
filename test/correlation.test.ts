import untypedTest, { ExecutionContext, TestFn } from 'ava'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterResponse, sleep } from '../src/util'
import { Store, asyncLocalStorage } from '../src/util/logger'
import { NopTransport, NopTransportTypes, TestAdapter } from '../src/util/testing-utils'

type TestContext = {
  testAdapter: TestAdapter
  adapterEndpoint: AdapterEndpoint<NopTransportTypes>
}
const test = untypedTest as TestFn<TestContext>

const startAdapter = async (
  enabled: boolean,
  context: ExecutionContext<TestContext>['context'],
) => {
  process.env['CORRELATION_ID_ENABLED'] = enabled.toString()

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new (class extends NopTransport {
          override async foregroundExecute() {
            const store = asyncLocalStorage.getStore() as Store
            if (store !== undefined && store['correlationId'] === '1') {
              await sleep(100)
            }
            return {
              data: null,
              statusCode: 200,
              result: store as unknown as null,
            } as AdapterResponse<{
              Data: null
              Result: null
            }>
          }
        })(),
      }),
    ],
  })

  context.testAdapter = await TestAdapter.start(adapter, context)
  return context.testAdapter
}

test.serial('uses the correct correlation id when it is passed in a header', async (t) => {
  const testId = 'test'
  const testAdapter = await startAdapter(true, t.context)
  const response = await testAdapter.request({ base: 'asd' }, { 'x-correlation-id': testId })
  t.is(response.json().result.correlationId, testId)
})

test.serial('sets a correlation id when it is enabled as an env var', async (t) => {
  const testAdapter = await startAdapter(true, t.context)
  const response = await testAdapter.request({ base: 'asd' })
  t.is(typeof response.json().result.correlationId, 'string')
})

test.serial('correlation Id is not set when enabled is set to false', async (t) => {
  const testAdapter = await startAdapter(false, t.context)
  const response = await testAdapter.request({ base: 'asd' })
  t.is(response.json().result, undefined)
})

test.serial('preserves concurrency through subsequent calls', async (t) => {
  const testAdapter = await startAdapter(true, t.context)
  const request1 = testAdapter.request({ base: 'asd' }, { 'x-correlation-id': '1' })
  const request2 = testAdapter.request({ base: 'asd' }, { 'x-correlation-id': '2' })

  // Check that each call has the correct correlation Id
  const response2 = await request2
  const response1 = await request1
  t.is(response1.json().result.correlationId === '1', true)
  t.is(response2.json().result.correlationId === '2', true)
})
