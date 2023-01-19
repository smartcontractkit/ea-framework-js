import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../src'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../src/adapter'
import { ResponseCache } from '../src/cache/response'
import { Transport, TransportGenerics } from '../src/transports'
import { AdapterRequest } from '../src/util'

const test = untypedTest as TestFn<{
  serverAddress: string
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

type Pair = {
  base: string
  quote: string
}

type TestTransportGenerics = TransportGenerics & {
  Request: {
    Params: Pair
  }
  Response: {
    Data: Pair
  }
}

class OverrideTestTransport implements Transport<TestTransportGenerics> {
  responseCache!: ResponseCache<{
    Request: TestTransportGenerics['Request']
    Response: TestTransportGenerics['Response']
  }>
  async initialize() {
    return
  }
  async foregroundExecute(req: AdapterRequest<TestTransportGenerics['Request']>) {
    return {
      data: {
        base: req.requestContext.data.base,
        quote: req.requestContext.data.quote,
      },
      statusCode: 200,
      result: null,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    }
  }
}

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {
          base: {
            type: 'string',
            required: true,
          },
          quote: {
            type: 'string',
            required: true,
          },
        },
        transport: new OverrideTestTransport(),
      }),
    ],
    overrides: {
      OVER1: 'overriden_1',
    },
  })

  t.context.adapterEndpoint = adapter.endpoints[0]
  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

test('adapter hardcoded overrides are respected', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'OVER1',
      quote: 'USD',
    },
  })

  t.deepEqual(response.data.data, {
    base: 'overriden_1',
    quote: 'USD',
  })
})

test('request overrides are respected', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'OVER2',
      quote: 'USD',
      overrides: {
        test: {
          OVER2: 'qweqwe',
        },
      },
    },
  })

  t.deepEqual(response.data.data, {
    base: 'qweqwe',
    quote: 'USD',
  })
})

test('not overriden field is kept as is', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'NO-OVER',
      quote: 'USD',
      overrides: {
        test: {
          OVER2: 'qweqwe',
        },
      },
    },
  })

  t.deepEqual(response.data.data, {
    base: 'NO-OVER',
    quote: 'USD',
  })
})

test('request overrides take precedence over adapter hardcoded ones', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'OVER1',
      quote: 'USD',
      overrides: {
        test: {
          OVER1: 'priority',
        },
      },
    },
  })

  t.deepEqual(response.data.data, {
    base: 'priority',
    quote: 'USD',
  })
})

test('request overrides that resolve field to overridable symbol are not overriden from adapter overrides', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'OVER2',
      quote: 'USD',
      overrides: {
        test: {
          OVER2: 'OVER1',
        },
      },
    },
  })

  t.deepEqual(response.data.data, {
    base: 'OVER1', // Want to check that it's not been overriden twice, which would be 'overriden_1'
    quote: 'USD',
  })
})

test('adapter overrides that resolve field to overridable symbol are not overriden from request overrides', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'OVER1',
      quote: 'USD',
      overrides: {
        test: {
          overriden_1: 'twice',
        },
      },
    },
  })

  t.deepEqual(response.data.data, {
    base: 'overriden_1', // Want to check that it's not been overriden twice, which would be 'twice'
    quote: 'USD',
  })
})
