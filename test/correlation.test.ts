import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterResponse, sleep } from '../src/util'
import { asyncLocalStorage, Store } from '../src/util/logger'
import { NopTransport, NopTransportTypes } from './util'

const test = untypedTest as TestFn<{
  serverAddress: string
  adapterEndpoint: AdapterEndpoint<NopTransportTypes>
}>

const startAdapter = async (enabled: boolean) => {
  process.env['CORRELATION_ID_ENABLED'] = enabled.toString()

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
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

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  const serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
  return serverAddress
}

test.serial('uses the correct correlation id when it is passed in a header', async (t) => {
  const testId = 'test'
  const serverAddress = await startAdapter(true)
  const response = await axios.post(
    serverAddress,
    {
      base: 'asd',
    },
    {
      headers: {
        'x-correlation-id': testId,
      },
    },
  )
  t.is(response.data.result.correlationId, testId)
})

test.serial('sets a correlation id when it is enabled as an env var', async (t) => {
  const serverAddress = await startAdapter(true)
  const response = await axios.post(serverAddress, {
    base: 'asd',
  })
  t.is(typeof response.data.result.correlationId, 'string')
})

test.serial('correlation Id is not set when enabled is set to false', async (t) => {
  const serverAddress = await startAdapter(false)
  const response = await axios.post(serverAddress, {
    base: 'asd',
  })
  t.is(response.data.result, undefined)
})

test.serial('preserves concurrency through subsequent calls', async (t) => {
  const serverAddress = await startAdapter(true)
  const request1 = await axios.post(
    serverAddress,
    {
      base: 'asd',
    },
    {
      headers: {
        'x-correlation-id': '1',
      },
    },
  )
  // Send out second call normally

  // Check that each call has the correct correlation Id
  const request2 = axios.post(
    serverAddress,
    {
      base: 'asd',
    },
    {
      headers: {
        'x-correlation-id': '2',
      },
    },
  )
  const response2 = await request2
  const response1 = await request1
  t.is(response1.data.result.correlationId === '1', true)
  t.is(response2.data.result.correlationId === '2', true)
})
