import untypedTest, { ExecutionContext, TestFn } from 'ava'
import { ReplyError as RedisError } from 'ioredis'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterResponse, ResponseTimestamps } from '../src/util'
import {
  AdapterConnectionError,
  AdapterCustomError,
  AdapterDataProviderError,
  AdapterError,
  AdapterInputError,
  AdapterRateLimitError,
  AdapterTimeoutError,
} from '../src/validation/error'
import { NopTransport, NopTransportTypes, TestAdapter, assertEqualResponses } from './util'

type TestContext = {
  testAdapter: TestAdapter
  adapterEndpoint: AdapterEndpoint<NopTransportTypes>
}
const test = untypedTest as TestFn<TestContext>

const makeAdapter = async (
  endpoint: AdapterEndpoint<NopTransportTypes>,
  context: ExecutionContext<TestContext>['context'],
) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [endpoint],
  })

  context.testAdapter = await TestAdapter.start(adapter, context)
  return context.testAdapter
}

test('Non AdapterError exception returns 500', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new Error('Test error')
      }
    })(),
  })

  const testAdapter = await makeAdapter(endpoint, t.context)
  const error = await testAdapter.request({})
  t.is(error.statusCode, 500)
  t.is(error.body, 'Test error')
})

test('Non AdapterError exception returns 500 with default message', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new Error()
      }
    })(),
  })

  const testAdapter = await makeAdapter(endpoint, t.context)
  const error = await testAdapter.request({})
  t.is(error.statusCode, 500)
  t.is(error.body, 'There was an unexpected error in the adapter.')
})

test('Adapter error returns default status of 500', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new AdapterError({ message: 'Expected error, returning 500' })
      }
    })(),
  })

  const testAdapter = await makeAdapter(endpoint, t.context)
  const error = await testAdapter.request({})
  t.is(error.statusCode, 500)
  t.deepEqual(error.json(), {
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

  const testAdapter = await makeAdapter(endpoint, t.context)
  const error = await testAdapter.request({})
  t.is(error.statusCode, 200)
  t.deepEqual(error.json(), {
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
    new AdapterDataProviderError({}, {} as ResponseTimestamps),
    new AdapterConnectionError({}, {} as ResponseTimestamps),
    new AdapterCustomError({}),
  ]

  for (const err of errors) {
    t.is(err.statusCode, 500)
  }
})

test('Adapter returns error when transport returns response with error message', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        const response: AdapterResponse<NopTransportTypes['Response']> = {
          statusCode: 502,
          errorMessage: 'test error message',
          timestamps: {
            providerDataReceivedUnixMs: 0,
            providerDataRequestedUnixMs: 0,
            providerIndicatedTimeUnixMs: undefined,
          },
        }

        return response
      }
    })(),
  })

  const testAdapter = await makeAdapter(endpoint, t.context)
  const error = await testAdapter.request({})
  t.is(error.statusCode, 502)
  assertEqualResponses(t, error.json(), {
    statusCode: 502,
    errorMessage: 'test error message',
  })
})

test('RedisError returns 500', async (t) => {
  const endpoint = new AdapterEndpoint<NopTransportTypes>({
    name: 'TEST',
    transport: new (class extends NopTransport {
      override async foregroundExecute() {
        throw new RedisError('Error reply from redis')
      }
    })(),
  })

  const testAdapter = await makeAdapter(endpoint, t.context)
  const error = await testAdapter.request({})
  t.is(error.statusCode, 500)
  t.is(error.body, 'Error reply from redis')
})
