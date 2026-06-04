import untypedTest, { TestFn } from 'ava'
import { calculateFeedId } from '../../src/cache'
import { AdapterSettings, buildAdapterSettings } from '../../src/config'
import { LoggerFactoryProvider } from '../../src/util'
import { InputParameters } from '../../src/validation'
import { InputParametersDefinition } from '../../src/validation/input-params'

const test = untypedTest as TestFn<{
  inputParameters: InputParameters<InputParametersDefinition>
  endpointName: string
  adapterSettings: AdapterSettings
}>

test.before(() => {
  LoggerFactoryProvider.set()
})

test.beforeEach(async (t) => {
  t.context.endpointName = 'TEST'
  t.context.inputParameters = new InputParameters({})
  t.context.adapterSettings = buildAdapterSettings({})
})

test.serial('no parameters returns N/A', async (t) => {
  t.is(calculateFeedId(t.context, {}), 'N/A')
})

test.serial('no parameters returns empty JSON', async (t) => {
  t.context.adapterSettings.FEED_ID_JSON = true
  t.is(calculateFeedId(t.context, {}), JSON.stringify({}))
})

test.serial('long feed id returns JSON with hash', async (t) => {
  t.context.adapterSettings.FEED_ID_JSON = true
  t.context.adapterSettings.MAX_COMMON_KEY_SIZE = 1
  t.is(
    calculateFeedId(t.context, { test: 'test' }),
    JSON.stringify({ hash: 'SzkCEKs7NV6rxiz4/VbpzPnLKEM=' }),
  )
})

test.serial('builds feed ID correctly from input params', async (t) => {
  t.context.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'base',
      required: true,
    },
    quote: {
      type: 'string',
      description: 'quote',
      required: true,
    },
  })
  const data = { base: 'ETH', quote: 'BTC' }
  t.is(calculateFeedId(t.context, data), '{"base":"eth","quote":"btc"}')
})
