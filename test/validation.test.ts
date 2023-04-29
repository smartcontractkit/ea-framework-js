import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint, CustomInputValidator, EndpointGenerics } from '../src/adapter'
import { BaseAdapterSettings } from '../src/config'
import { AdapterRequest, AdapterResponse } from '../src/util'
import { InputParameters } from '../src/validation'
import { AdapterInputError } from '../src/validation/error'
import { EmptyInputParameters } from '../src/validation/input-params'
import { validator } from '../src/validation/utils'
import { NopTransport, NopTransportTypes, TestAdapter } from './util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
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
  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

/**
 * NOTE: The tests here are run serially, because to avoid setting up and tearing down the adapter
 * for each one, we're just modifying the inputParameters and sending a new request every time
 */
test.serial('any content-type other than application/json throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({})

  const error = await t.context.testAdapter.api.inject({
    url: '/',
    method: 'post',
    payload: 'test string',
    headers: {
      'content-type': 'text/plain',
    },
  })
  t.is(error.statusCode, 400)
})

test.serial('no body in request throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({})

  const error = await t.context.testAdapter.api.inject({
    url: '/',
    method: 'post',
    payload: '',
    headers: {
      'content-type': 'application/json',
    },
  })
  t.is(error.statusCode, 400)
})

test.serial('invalid endpoint name throws 404', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({})

  const error = await t.context.testAdapter.request({ endpoint: 'random' })
  t.is(error.statusCode, 404)
})

test.serial('no endpoint without default throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({})

  const error = await t.context.testAdapter.request({})
  t.is(error.statusCode, 400)
})

test.serial('no params returns 200', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({})

  const response = await t.context.testAdapter.request({ endpoint: 'test' })
  t.is(response.statusCode, 200)
})

test.serial('missing required param throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      required: true,
    },
  })

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
  })
  t.is(error.statusCode, 400)
})

test.serial('wrongly typed string throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      required: true,
    },
  })

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 123,
  })
  t.is(error.statusCode, 400)
})

test.serial('wrongly typed number throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'number',
      description: 'stuff',
      required: true,
    },
  })

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: '123',
  })
  t.is(error.statusCode, 400)
})

test.serial('wrongly typed boolean throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'boolean',
      description: 'stuff',
      required: true,
    },
  })

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: '123',
  })
  t.is(error.statusCode, 400)
})

test.serial('wrongly typed array throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      array: true,
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: '123',
  })
  t.is(error.statusCode, 400)
})

test.serial('wrongly typed object throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: {
        test: {
          type: 'string',
          description: 'stuff',
          array: true,
        },
      },
      description: 'stuff',
      required: true,
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: '123',
  })
  t.is(error.statusCode, 400)
})

test.serial('wrongly typed optional param throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 123,
  })
  t.is(error.statusCode, 400)
})

test.serial('param not in options throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      required: true,
      options: ['ETH', 'BTC'],
    },
  })

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'LINK',
  })
  t.is(error.statusCode, 400)
})

test.serial('missing dependent params throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      dependsOn: ['quote'],
    },
    quote: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'ETH',
  })
  t.is(error.statusCode, 400)
})

test.serial('presented exclusive params throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      exclusive: ['quote'],
    },
    quote: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'ETH',
    quote: 'USD',
  })
  t.is(error.statusCode, 400)
})

test.serial('invalid overrides object throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
    },
    quote: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'OVER2',
    quote: 'USD',
    overrides: 'test',
  })
  t.is(error.statusCode, 400)
})

test.serial('invalid overrides property throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
    },
    quote: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'OVER2',
    quote: 'USD',
    overrides: {
      test: 'test',
    },
  })
  t.is(error.statusCode, 400)
})

test.serial('valid overrides property succeeds', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
    },
    quote: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const response = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'OVER2',
    quote: 'USD',
    overrides: {
      test: {
        asd: 'qwe',
      },
    },
  })
  t.is(response.statusCode, 200)
})

test.serial('duplicate param (name + alias) throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      aliases: ['from'],
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'asd',
    from: 'qwe',
  })
  t.is(error.statusCode, 400)
})

test.serial('invalid overrides key throws 400', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
    },
    quote: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const error = await t.context.testAdapter.request({
    endpoint: 'test',
    base: 'OVER2',
    quote: 'USD',
    overrides: {
      test: {
        OVER2: {
          json: '123',
        },
      },
    },
  })
  t.is(error.statusCode, 400)
})

test.serial('correctly typed params returns 200', async (t) => {
  const inputParameters = new InputParameters({
    string: {
      type: 'string',
      description: 'stuff',
      required: true,
    },
    array: {
      type: 'number',
      array: true,
      description: 'stuff',
    },
    object: {
      type: {
        test: {
          type: 'string',
          description: 'stuff',
        },
      },
      description: 'stuff',
      required: true,
    },
    boolean: {
      type: 'boolean',
      description: 'stuff',
      required: true,
    },
    number: {
      type: 'number',
      description: 'stuff',
      required: true,
    },
    stringOptions: {
      type: 'string',
      description: 'stuff[]',
      options: ['123', 'sdfoij'],
    },
    numberOptions: {
      type: 'number',
      description: 'stuff[]',
      options: [123, 234],
    },
    arrayOfObjects: {
      type: {
        address: {
          type: 'string',
          required: true,
          description: 'inner stuff',
        },
      },
      array: true,
      description: 'an array of address objects',
    },
  })

  // We declare it here to also test the types
  const testObject: typeof inputParameters.validated = {
    string: 'asd',
    array: [1, 2, 3],
    object: {
      test: 'asd',
    },
    boolean: false,
    number: 123,
    stringOptions: '123',
    numberOptions: 123,
    arrayOfObjects: [
      {
        address: 'qwe',
      },
    ],
  }

  t.context.adapterEndpoint.inputParameters =
    inputParameters as unknown as InputParameters<EmptyInputParameters>

  const response = await t.context.testAdapter.request({
    endpoint: 'test',
    ...testObject,
  })
  t.is(response.statusCode, 200)
})

test.serial('omitted optional param returns 200', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const response = await t.context.testAdapter.request({
    endpoint: 'test',
  })
  t.is(response.statusCode, 200)
})

test.serial('duplicate params in definition fails', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    new InputParameters({
      base: {
        type: 'string',
        required: true,
        description: 'stuff',
        aliases: ['base', 'quote'],
      },
    }) as unknown as InputParameters<EmptyInputParameters>
  })

  t.is(
    error?.message,
    '[Param: base] There are repeated aliases for input param base: base,base,quote',
  )
})

// TODO: rename tests (throws 400)

test.serial('default value is used for optional param', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      default: 'ETH',
    },
  })

  const data = t.context.adapterEndpoint.inputParameters.validateInput({})
  t.is(data['base'], 'ETH')
})

test.serial('non-required array param coerces null value to empty array', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    list: {
      type: 'string',
      description: 'stuff',
      array: true,
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const data = t.context.adapterEndpoint.inputParameters.validateInput({})
  t.deepEqual(data['list'] as unknown, [])
})

test.serial('non-required number allows default 0', async (t) => {
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    default0: {
      type: 'number',
      description: 'stuff',
      default: 0,
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const data = t.context.adapterEndpoint.inputParameters.validateInput({})
  t.deepEqual(data['default0'], 0)
})

test.serial('missing dependency fails validation', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        default: 'ETH',
        dependsOn: ['quote'],
      },
    })
  })

  t.is(error?.message, 'Param "base" depends on non-existent param "quote"')
})

test.serial('missing exclusion fails validation', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        default: 'ETH',
        exclusive: ['quote'],
      },
    })
  })

  t.is(error?.message, 'Param "base" excludes non-existent param "quote"')
})

test.serial('dependency on required param fails validation', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        default: 'ETH',
        dependsOn: ['quote'],
      },
      quote: {
        type: 'string',
        description: 'stuff',
        required: true,
      },
    })
  })

  t.is(
    error?.message,
    'Param "base" has an unnecessary dependency on "quote" (dependency is always required)',
  )
})

test.serial('exclusion of required param fails validation', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        default: 'ETH',
        exclusive: ['quote'],
      },
      quote: {
        type: 'string',
        description: 'stuff',
        required: true,
      },
    })
  })

  t.is(error?.message, 'Param "base" excludes required (i.e. always present) param "quote"')
})

test.serial('aliases of different properties with common values fail validation', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        aliases: ['asd', 'shared'],
      },
      quote: {
        type: 'string',
        description: 'stuff',
        aliases: ['shared', 'qwe'],
      },
    }) as InputParameters<EmptyInputParameters>
  })

  t.is(
    error?.message,
    'There are clashes in property names and aliases, check that they are all unique',
  )
})

test.serial('throws on empty options array', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        options: [],
      },
    }) as unknown as InputParameters<EmptyInputParameters>
  })

  t.is(error?.message, '[Param: base] The options array must contain at least one option')
})

test.serial('throws on repeated options', async (t) => {
  const error: AdapterInputError | undefined = t.throws(() => {
    t.context.adapterEndpoint.inputParameters = new InputParameters({
      base: {
        type: 'string',
        description: 'stuff',
        options: ['test', 'asd', 'test'],
      },
    }) as InputParameters<EmptyInputParameters>
  })

  t.is(error?.message, '[Param: base] There are duplicates in the specified options: test,asd,test')
})

test.serial('Test port validator', async (t) => {
  const portValidator = validator.port()
  let value = 8080
  let error = portValidator(value)
  t.is(error, undefined)
  value = 1000000
  error = portValidator(value)
  t.is(error, 'Maximum allowed value is 65535. Received 1000000')
})

test.serial('Test url validator', async (t) => {
  const urlValidator = validator.url()
  let value = 'redis://:authpassword@127.0.0.1:6380/4'
  let error = urlValidator(value)
  t.is(error, undefined)
  value = 'unknown_url'
  error = urlValidator(value)
  t.is(error, 'Value should be valid URL. Received unknown_url')
})

test.serial('Test host validator', async (t) => {
  const hostValidator = validator.host()
  let value = '127.0.0.1'
  let error = hostValidator(value)
  t.is(error, undefined)
  value = '23124.32.42.24'
  error = hostValidator(value)
  t.is(error, 'Value is not valid IP address. Received 23124.32.42.24')
})

test.serial('Test response timestamp validator', async (t) => {
  const timestampValidator = validator.responseTimestamp()
  let value = new Date().getTime()
  let error = timestampValidator(value)
  t.is(error, undefined)
  // Test reasonable limit over current timestamp
  error = timestampValidator(value + 30)
  t.is(error, undefined)
  // Test over maximum timestamp
  error = timestampValidator(value + 1000)
  t.is(error, `Maximum allowed value is ${value + 50}. Received ${value + 1000}`)
  // Test under minimum timestamp
  value = 0
  error = timestampValidator(value)
  t.is(error, 'Minimum allowed value is 1514764861000. Received 0')
})

test.serial('Test base64 validator', async (t) => {
  const base64Validator = validator.base64()
  // @ts-expect-error - testing invalid input
  let value: string = -1
  let error = base64Validator(value)
  t.is(error, 'Value is not valid base64 string.')
  // @ts-expect-error - testing invalid input
  value = undefined
  error = base64Validator(value)
  t.is(error, 'Value is not valid base64 string.')
  value = 'test'
  error = base64Validator(value)
  t.is(error, 'Value is not valid base64 string.')
  value = 'dGVzdA=='
  error = base64Validator(value)
  t.is(error, undefined)
})

test.serial('Test integer validator', async (t) => {
  const integerValidator = validator.integer({ min: 10, max: 20 })
  let value: string | number = 11
  let error = integerValidator(value)
  t.is(error, undefined)
  value = 3.141
  error = integerValidator(value)
  t.is(error, 'Value should be an integer (no floating point)., Received number 3.141')

  value = 4
  error = integerValidator(value)
  t.is(error, 'Minimum allowed value is 10. Received 4')

  value = 24
  error = integerValidator(value)
  t.is(error, 'Maximum allowed value is 20. Received 24')
})

test.serial('Test positive integer validator', async (t) => {
  const positiveIntegerValidator = validator.positiveInteger()
  let value = 11
  let error = positiveIntegerValidator(value)
  t.is(error, undefined)
  value = -2
  error = positiveIntegerValidator(value)
  t.is(error, 'Value should be positive number, Received -2')
})

test.serial('custom input validation', async (t) => {
  const inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'stuff',
      required: true,
    },
    quote: {
      type: 'string',
      description: 'stuff',
      required: true,
    },
  })
  t.context.adapterEndpoint.inputParameters = inputParameters
  const customInputValidation = (
    input: AdapterRequest<typeof inputParameters.definition>,
    _: BaseAdapterSettings,
  ) => {
    if (input.requestContext.data['base'] === input.requestContext.data['quote']) {
      return new AdapterInputError({ statusCode: 400 })
    }
  }

  t.context.adapterEndpoint.customInputValidation =
    customInputValidation as CustomInputValidator<EndpointGenerics>

  const response = await t.context.testAdapter.request({
    base: 'BTC',
    quote: 'USD',
    endpoint: 'test',
  })
  t.is(response.statusCode, 200)

  const error = await t.context.testAdapter.request({
    base: 'BTC',
    quote: 'BTC',
    endpoint: 'test',
  })
  t.is(error.statusCode, 400)
})

test.serial('limit size of input parameters', async (t) => {
  process.env['MAX_PAYLOAD_SIZE_LIMIT'] = '1048576'

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
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
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    addresses: {
      type: 'string',
      array: true,
      description: 'stuff',
    },
  }) as unknown as InputParameters<EmptyInputParameters>

  const request = {
    addresses: [
      '0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95',
    ],
  }

  for (let i = 0; i < 14; i++) {
    request.addresses = request.addresses.concat(request.addresses)
  }
  const error = await t.context.testAdapter.request(request)
  t.is(error.statusCode, 413)
  t.is(error.body, 'Request body is too large')
})
