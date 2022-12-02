import test from 'ava'
import axios, { AxiosError } from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterResponse } from '../src/util'
import {
  AdapterConnectionError,
  AdapterCustomError,
  AdapterDataProviderError,
  AdapterError,
  AdapterInputError,
  AdapterRateLimitError,
  AdapterTimeoutError,
} from '../src/validation/error'
import { assertEqualResponses, NopTransport, NopTransportTypes } from './util'

const makeAdapter = async (endpoint: AdapterEndpoint<NopTransportTypes>): Promise<string> => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [endpoint],
  })

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  return `http://localhost:${(api.server.address() as AddressInfo).port}`
}

test('Non AdapterError exception returns 500', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    inputParameters: {},
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new Error('Test error')
      }
    })(),
  })

  const address = await makeAdapter(endpoint)

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(address, {
      data: {},
      endpoint: 'test',
    }),
  )

  t.is(error?.response?.status, 500)
  t.is(error?.response?.data, 'Test error')
})

test('Non AdapterError exception returns 500 with default message', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    inputParameters: {},
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new Error()
      }
    })(),
  })

  const address = await makeAdapter(endpoint)

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(address, {
      data: {},
      endpoint: 'test',
    }),
  )

  t.is(error?.response?.status, 500)
  t.is(error?.response?.data, 'There was an unexpected error in the adapter.')
})

test('Adapter error returns default status of 500', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    inputParameters: {},
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new AdapterError({ message: 'Expected error, returning 500' })
      }
    })(),
  })

  const address = await makeAdapter(endpoint)

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(address, {
      data: {},
      endpoint: 'test',
    }),
  )

  t.is(error?.response?.status, 500)
  t.deepEqual(error?.response?.data, {
    error: {
      message: 'Expected error, returning 500',
      name: 'AdapterError',
    },
    status: 'errored',
    statusCode: 500,
  })
})

test('Adapter error returns specified 200, with accompanying provider status code', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    inputParameters: {},
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new AdapterError({
          message: 'Expected error, returning 200',
          providerStatusCode: 504,
          statusCode: 200,
          feedID: 'asd',
          url: 'asd.com',
        })
      }
    })(),
  })

  const address = await makeAdapter(endpoint)

  const response = await axios.post(address, {
    data: {},
    endpoint: 'test',
  })

  t.is(response.status, 200)
  t.deepEqual(response.data, {
    error: {
      message: 'Expected error, returning 200',
      name: 'AdapterError',
      feedID: 'asd',
      url: 'asd.com',
    },
    status: 'errored',
    statusCode: 200,
    providerStatusCode: 504,
  })
})

// Just dumb coverage, but hey 🤷
test('Special adapter errors have status 500', async (t) => {
  const errors = [
    new AdapterInputError({}),
    new AdapterRateLimitError({}),
    new AdapterTimeoutError({}),
    new AdapterDataProviderError({}),
    new AdapterConnectionError({}),
    new AdapterCustomError({}),
  ]

  for (const err of errors) {
    t.is(err.statusCode, 500)
  }
})

test('Adapter returns error when transport returns response with error message', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    inputParameters: {},
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        const response: AdapterResponse<NopTransportTypes['Response']> = {
          statusCode: 502,
          errorMessage: 'test error message',
          timestamps: {
            providerDataReceived: 0,
            providerDataRequested: 0,
            providerIndicatedTime: undefined,
          },
        }

        return response
      }
    })(),
  })

  const address = await makeAdapter(endpoint)

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(address, {
      data: {},
      endpoint: 'test',
    }),
  )

  t.is(error?.response?.status, 502)
  assertEqualResponses(t, error?.response?.data as AdapterResponse, {
    statusCode: 502,
    errorMessage: 'test error message',
  })
})
