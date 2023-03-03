import untypedTest, { TestFn } from 'ava'
import { calculateFeedId } from '../../src/cache'
import { AdapterSettings, buildAdapterSettings } from '../../src/config'
import { InputParameters } from '../../src/validation'

const feedIdTest = untypedTest as TestFn<{
  inputParameters: InputParameters
  endpointName: string
  adapterSettings: AdapterSettings
}>

feedIdTest.beforeEach(async (t) => {
  t.context.endpointName = 'TEST'
  t.context.inputParameters = {}
  t.context.adapterSettings = buildAdapterSettings({})
})

feedIdTest.serial('no parameters returns N/A', async (t) => {
  t.is(calculateFeedId(t.context, {}), 'N/A')
})

feedIdTest.serial('builds feed ID correctly from input params', async (t) => {
  t.context.inputParameters = {
    base: {
      type: 'string',
      required: true,
    },
    quote: {
      type: 'string',
      required: true,
    },
  }
  const data = { base: 'ETH', quote: 'BTC' }
  t.is(calculateFeedId(t.context, data), '{"base":"eth","quote":"btc"}')
})
