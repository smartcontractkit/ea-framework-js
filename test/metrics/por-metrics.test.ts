import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { NopTransport, TestAdapter } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
import { PoRAdapter, PoRBalanceEndpoint, porBalanceEndpointInputParametersDefinition } from '../../src/adapter/por'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

const inputParameters = new InputParameters(porBalanceEndpointInputParametersDefinition)

test.before(async (t) => {
  process.env['METRICS_ENABLED'] = 'true'

  const adapter = new PoRAdapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new PoRBalanceEndpoint({
        name: 'test',
        inputParameters,
        transport: new NopTransport()
      }),
    ],
  })

  // Start the adapter
  t.context.clock = FakeTimers.install()
  t.context.testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
})

test.after((t) => {
  t.context.clock.uninstall()
})


test.serial('PoR adapter addresses metric', async (t) => {
  const error = await t.context.testAdapter.request({
    addresses: [
      {
        address: 'address1'
      },
      {
        address: 'address2'
      }
    ]
  })
  t.is(error.statusCode, 504)

  const metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'por_balance_address_length',
    labels: { feed_id: '{\'addresses\':[{\'address\':\'address1\'},{\'address\':\'address2\'}]}' },
    expectedValue: 2,
  })
})
