import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../src'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../src/adapter'
import { AdapterResponse } from '../src/util'
import { AdapterInputError } from '../src/validation/error'
import { InputValidator } from '../src/validation/input-validator'
import { NopTransport, NopTransportTypes } from './util'

const test = untypedTest as TestFn<{
  serverAddress: string
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async foregroundExecute(): Promise<void | AdapterResponse<
            NopTransportTypes['Response']
          >> {
            return {
              data: null,
              statusCode: 200,
              result: null,
            } as AdapterResponse<NopTransportTypes['Response']>
          }
        })(),
      }),
    ],
  })

  t.context.adapterEndpoint = adapter.endpoints[0]
  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

/**
 * NOTE: The tests here are run serially, because to avoid setting up and tearing down the adapter
 * for each one, we're just modifying the inputParameters and sending a new request every time
 */
test.serial('any content-type other than application/json throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {}

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, 'test string', {
      headers: {
        'Content-Type': 'text/plain',
      },
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('no body in request throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {}

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, '', {
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('invalid endpoint name throws 404', async (t) => {
  t.context.adapterEndpoint.inputParameters = {}

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      endpoint: 'random',
    }),
  )
  t.is(error?.response?.status, 404)
})

test.serial('no endpoint without default throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {}

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {},
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('endpoint in data object', async (t) => {
  t.context.adapterEndpoint.inputParameters = {}

  const response = await axios.post(`${t.context.serverAddress}`, {
    data: { endpoint: 'test' },
  })
  t.is(response.status, 200)
})

test.serial('no params returns 200', async (t) => {
  t.context.adapterEndpoint.inputParameters = {}

  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {},
    endpoint: 'test',
  })
  t.is(response.status, 200)
})

test.serial('missing required param throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {},
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('wrongly typed string throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: 123,
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('wrongly typed number throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'number',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: '123',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('wrongly typed boolean throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'boolean',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: '123',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('wrongly typed array throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'array',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: '123',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('wrongly typed object throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'object',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: '123',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('wrongly typed optional param throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: false,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: 123,
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('param not in options throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: true,
      options: ['ETH', 'BTC'],
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: 'LINK',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('missing dependent params throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: false,
      dependsOn: ['quote'],
    },
    quote: {
      required: false,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: 'ETH',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('presented exclusive params throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: false,
      exclusive: ['quote'],
    },
    quote: {
      required: false,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: 'ETH',
        quote: 'BTC',
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 400)
})

test.serial('correctly typed param returns 200', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    string: {
      type: 'string',
      required: true,
    },
    array: {
      type: 'array',
      required: true,
    },
    object: {
      type: 'object',
      required: true,
    },
    boolean: {
      type: 'boolean',
      required: true,
    },
    number: {
      type: 'number',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      string: 'test',
      number: 2,
      boolean: false,
      array: [1, 'test'],
      object: { test: 'test' },
    },
    endpoint: 'test',
  })
  t.is(response.status, 200)
})

test.serial('omitted optional param returns 200', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: false,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {},
    endpoint: 'test',
  })
  t.is(response.status, 200)
})

test.serial('duplicate  params throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      required: true,
      aliases: ['base', 'quote'],
    },
  }
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.validator = new InputValidator(
      t.context.adapterEndpoint.inputParameters,
    )
  })

  t.is(error?.statusCode, 400)
  t.is(error?.message, 'Duplicate aliases')
})

test.serial('default value is used for optional param', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      required: false,
      default: 'ETH',
    },
  }

  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const data = t.context.adapterEndpoint.validator.validateInput({})

  t.is(data['base'], 'ETH')
})

test.serial('default value is used for required param (error)', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      required: true,
      default: 'ETH',
    },
  }

  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.validator = new InputValidator(
      t.context.adapterEndpoint.inputParameters,
    )
  })

  t.is(error?.statusCode, 400)
  t.is(error?.message, "base can't be required and have default value")
})

test.serial('missing input depends on param (error)', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      required: false,
      default: 'ETH',
      dependsOn: ['quote'],
    },
  }

  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.validator = new InputValidator(
      t.context.adapterEndpoint.inputParameters,
    )
  })

  t.is(error?.statusCode, 400)
  t.is(error?.message, "Input dependency/exclusive 'quote' is missing in input schema")
})

test.serial('limit size of input parameters', async (t) => {
  process.env['BODY_LIMIT_SIZE'] = '1'

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async foregroundExecute(): Promise<void | AdapterResponse<
            NopTransportTypes['Response']
          >> {
            return {
              data: null,
              statusCode: 413,
              result: null,
            } as AdapterResponse<NopTransportTypes['Response']>
          }
        })(),
      }),
    ],
  })

  t.context.adapterEndpoint = adapter.endpoints[0]

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`

  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    axios.post(`${t.context.serverAddress}`, {
      data: {
        base: 123,
      },
      endpoint: 'test',
    }),
  )
  t.is(error?.response?.status, 413)
  t.is(error?.response?.data, 'Request body is too large')
})
