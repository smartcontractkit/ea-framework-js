# Endpoints

Endpoints are defined for the different types of data points an adapter needs to provide. There are no restrictions as to how many data provider endpoints a particular adapter endpoint has to use. To reach a particular adapter endpoint, the `endpoint` parameter can be specified in the request using either its name or any of its aliases.

If the endpoint field is omitted, the adapter will use the default endpoint in the `Adapter` parameters, if set. If the field is explicitly set and does not match any endpoints or their aliases, the request will fail.

Define each endpoint in its own file in the `/endpoints` folder. Name the file the endpoint's name such as `crypto.ts`. Use the parameters described in the sections below to create endpoints that fit the need of your particular adapter.

## Endpoint Types

Endpoints contain a type parameter that allows specifying all relevant types in a single structure. The developer can specify types for the adapter request, adapter response, provider request, provider response, and settings. An example is shown below.

```typescript
import { customSettings } from './config'

interface RequestParams {
  base: string
  quote: string
}

interface ResponseSchema {
  base: string
  quote: string
  price: number
}

interface RequestBody {
  symbol: string
  convert: string
}

interface ProviderMessage {
  from: string
  to: string
  result: number
}

type EndpointTypes = {
  // Expected adapter request structure received by this endpoint
  Request: {
    Params: RequestParams
  }
  // Expected adapter response structure returned by the endpoint
  Response: {
    Data: ResponseSchema
    Result: number
  }
  // The adapter configs including the custom settings
  // Set to 'SettingsMap' (provided by the framework) if the adapter does not have custom settings
  CustomSettings: typeof customSettings
  // Expected data provider request and response structures. Options for REST and Websocket
  Provider: {
    RequestBody: RequestBody // Used for HTTP transports. Set to "never" if API solely uses query parameters.
    ResponseBody: ResponseSchema // Used for HTTP transports
    WsMessage: ProviderMessage // Used for Websocket transports
  }
}
```

## Input Parameters

Input parameters define the structure of the request expected by the endpoint. The framework provides helpful fields to customize input parameters along with validations to ensure each request conforms to the structure.

```typescript
const inputParameters = {
  param1: {
    aliases: ['param-one'],
    required: true,
    type: 'string',
    description: 'The symbol of the currency to query',
    options: ['option1', 'option2'], // Enumerated options
    default: 'option1',
    dependsOn: ['param2'], // Other inputs this one depends on
    exclusive: ['param3'], // Other inputs that cannot be present with this one
  },
  param2: {
    required: false,
    type: 'string',
    description: 'Required by param1',
  },
  param3: {
    required: false,
    type: 'string',
    description: 'Exclusive from param1',
  },
} as const
```

## Cache Key Generator

**Only use if absolutely necessary**

The Cache Key Generator method allows the developer to provide custom logic used to generate a unique cache key for each request. The framework's default behavior is to concat the endpoint name with the stringified input parameters such as `test-{"base":"ETH","quote": "USD"}`.

A potential scenario of where a custom cache key generator would be needed is if an input parameter is an array or an object. To ensure that a request generates the same unique key every time, the array or object would need to be sorted. An example of this code is shown below.

```typescript
function cacheKeyGenerator(data) {
  data.base = (data.base as unknown as string[]).sort()
  return `test-${JSON.stringify(data)}`
}
```

To understand where the cache key generator is applied, please refer to the [Request Validation & Transformation Diagram](./adapter.md/#request-validation--transformation)

## Custom input validation

**Only use if absolutely necessary**

The custom input validation method allows the developer to specify custom logic to validate input on top of the built-in validations the framework provides. It returns an `AdapterError` on failure, otherwise `undefined` on success. An example is shown below.

```typescript
function customInputValidation(
  req: RequestParams,
  config: AdapterConfig<typeof customSettings>,
): AdapterError | undefined {
  if (req.value && (req.value < 0 || req.value > 100)) {
    return new AdapterInputError({
      statusCode: 400,
      message: 'Value is less than 0 or greater than 100',
    })
  }
  return
}
```

To understand where these validations are applied, please refer to the [Request Validation & Transformation Diagram](./adapter.md/#request-validation--transformation)

## Price Endpoint

As mentioned in the [Adapter Guide](./adapter.md), `PriceAdapter` requires that one of its endpoints is a `PriceEndpoint`. To help standardize the format of a price feed endpoint, the framework provides helpful built-in types. This would alter some of the examples shown in the previous sections like below.

```typescript
import {
  PriceEndpoint,
  priceEndpointInputParameters,
  PriceEndpointParams,
} from '@chainlink/external-adapter-framework/adapter'
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'

type EndpointTypes = {
  // The PriceEndpointInputParameters type is the most common request params for a price endpoint. {base: string, quote: string}
  Request: {
    Params: PriceEndpointParams,
  },
  ...
  // The SingleNumberResultResponse type is the most common response format for price endpoints. {result: number, data: { result: number }}
  Response: SingleNumberResultResponse,
  ...
}

export const endpoint = new PriceEndpoint<EndpointTypes>({
  ...
  inputParameters: priceEndpointInputParameters,
  ...
})
```
