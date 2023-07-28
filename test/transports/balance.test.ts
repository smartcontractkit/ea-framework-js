import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Adapter } from '../../src/adapter'
import { AdapterConfig, CustomSettingsDefinition, EmptyCustomSettings } from '../../src/config'
import { InputParameters } from '../../src/validation'
import { TestAdapter } from '../../src/util/testing-utils'
import {
  BalanceTransport,
  balanceTransportInputParametersDefinition,
} from '../../src/transports/balance'
import { BalanceEndpoint, BalanceResponse } from '../../src/adapter/balance'

const URL = 'http://test-url.com'
const axiosMock = new MockAdapter(axios)
const mockAddresses = ['3KmdCC8H7PWAggYeeBk8qTPb5BnmVjGcDi', '35hK24tcLEWcgNA4JxpvbkNkoAcDGqQPsP']

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter
}>

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach(async (t) => {
  t.context.clock.uninstall()
  await t.context.testAdapter?.api.close()
})

export const inputParameters = new InputParameters(balanceTransportInputParametersDefinition)

export type BalanceTransportTypes = {
  Parameters: typeof inputParameters.definition
  Settings: EmptyCustomSettings
  Response: BalanceResponse
  Provider: {
    RequestBody: never
    ResponseBody: {
      balance: number
    }
  }
}

export const balanceTransport = new BalanceTransport<BalanceTransportTypes>({
  getBalance: (address) => {
    return {
      request: {
        baseURL: URL,
        url: `/address/${address.address}`,
      },
      onResponse: (res) => {
        return { ...address, balance: String(res.data.balance) }
      },
    }
  },
})

export const balanceEndpoint = new BalanceEndpoint({
  name: 'test',
  transport: balanceTransport,
  inputParameters,
})

axiosMock
  .onGet(`${URL}/address/${mockAddresses[0]}`)
  .reply(200, {
    balance: 123,
  })
  .onGet(`${URL}/address/${mockAddresses[1]}`)
  .reply(200, {
    balance: 456,
  })

test.serial('gets balances of addresses from DP', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    config: new AdapterConfig<CustomSettingsDefinition>({}),
    defaultEndpoint: 'test',
    endpoints: [balanceEndpoint],
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  const res = await testAdapter.request({
    addresses: mockAddresses.map((addr) => ({ address: addr })),
  })
  const response = res.json()

  t.is(typeof response.timestamps.providerDataReceivedUnixMs, 'number')
  t.is(
    typeof (
      response.timestamps.providerDataReceivedUnixMs ??
      response.timestamps.providerDataStreamEstablishedUnixMs
    ),
    'number',
  )

  delete response.timestamps

  t.deepEqual(response, {
    data: {
      result: [
        { address: mockAddresses[0], balance: '123', chain: 'mainnet', coin: 'btc' },
        { address: mockAddresses[1], balance: '456', chain: 'mainnet', coin: 'btc' },
      ],
    },
    result: null,
    statusCode: 200,
  })
})
