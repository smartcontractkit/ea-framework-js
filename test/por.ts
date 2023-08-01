import { NopTransport, TestAdapter } from '../src/util/testing-utils'
import untypedTest, { TestFn } from 'ava'
import { PoRAdapter, PoRBalanceEndpoint } from '../src/adapter/por'
import { AdapterConfig } from '../src/config'

type TestContext = {
  testAdapter: TestAdapter
}
const test = untypedTest as TestFn<TestContext>

test('PoRAdapter has BACKGROUND_EXECUTE_TIMEOUT setting set to highest value', async (t) => {
  const adapter = new PoRAdapter({
    name: 'TEST',
    config: new AdapterConfig({
      test: { description: 'test', type: 'string' }
    }),
    endpoints: [
      new PoRBalanceEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })
  t.is(adapter.config.settings.BACKGROUND_EXECUTE_TIMEOUT, 180_000)
})

