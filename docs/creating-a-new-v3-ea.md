# Creating a new v3 EA

The v3 framework currently only supports development of source adapters. This guide will assume the adapter is being created in [External Adapters Monorepo](https://github.com/smartcontractkit/external-adapters-js) under packages/sources/

## Structure

The most basic structure of a v3 adapter is below. Depending on the requirements for the EA, some components may look a little different but all of these customizations will be covered in the later sections.

```
adapter
├─ config
│  ├─ index.ts // Custom config vars (optional)
│  ├─ overrides.json // Overrides file (optional)
|  └─ includes.json // Includes file (e.x. inverses) (optional)
├─ endpoints
│  ├─ crypto // Data provider endpoints the adapter uses
|  └─ forex // Data provider endpoints the adapter uses
├─ index.ts // Adapter defined here with references to endpoints, rate limit tiers, custom settings, etc.
├─ test
├─ package.json
├─ CHANGELOG.md
├─ README.md
├─ test-payload.json
├─ tsconfig.json
└─ tsconfig.test.json
```

## Adapter

The adapter is initialized in the root-level `index.ts` file. Most of the parameters shown below for the Adapter are optional and only needed in particular cases. The parameters that are not self-explanatory are covered in their own sub-sections below.

For EA's specific to retrieving price data, the framework provides a `PriceAdapter` class that has standardized formats for certain types and has the added feature of `includes` (covered in later sub-section). A criteria to use the `PriceAdapter` class is that at least one of the endpoints needs to be a `PriceEndpoint` (covered in the [endpoints](#endpoints) section).

```typescript
import { expose } from '@chainlink/external-adapter-framework'
import { PriceAdapter } from '@chainlink/external-adapter-framework/adapter'
import { endpoint } from './endpoint'
import { defaultEndpoint } from './config'
import overrides from './config/overrides.json'
import includes from './config/includes.json'
import { customSettings } from './config'

export const adapter = new Adapter({
  name: 'ADAPTER_NAME', // The EA name, in uppercase without any spaces
  defaultEndpoint: 'endpoint', // The default endpoint to use
  endpoints: [endpoint], // An array of all endpoints available. Defined in the endpoints folder
  rateLimiting: {
    // If applicable, the provider rate limit tiers
    tiers: {
      free: {
        rateLimit1s: 10,
        rateLimit1m: 100,
        rateLimit1h: 123.45,
        note: 'Free tier',
      },
      professional: {
        rateLimit1s: 20,
        rateLimit1m: 200,
        rateLimit1h: 456.78,
      },
    },
  },
  customSettings, // If applicable, any custom settings
  overrides: overrides['adapterName'], // If applicable, reference the overrides config.
  envDefaultOverrides: { API_TIMEOUT: 10000 }, // If applicable, set overrides for env vars defaults. Primarily useful for framework level env vars.
  requestTransforms, // If applicable, an array of
  envVarsPrefix: 'TEST', // If applicable, a prefix appended to the front of the default env var names to retrieve the config
  bootstrap: async (adapter: Adapter<typeof customSettings>) => {}, // If applicable, a custom function that will execute at startup of the adapter
})

// Expose the server to start the EA
export const server = () => expose(adapter)
```

### Rate Limiting Tiers

Rate limits tiers specific to the data provider can be specified under the `rateLimiting` parameter. It can be defined by second (`rateLimit1s`), minute (`rateLimit1m`), and/or hour (`rateLimit1h`). The tiers would then be selected using the `RATE_LIMIT_API_TIER` env var by setting it to the name of the tier such as `professional`.

### Custom Settings

The v3 framework allows developers to specify env vars that are relevant to their specific EA. They would be specified in the format below in the `config/index.ts` file.

If the EA does not require any custom env vars, this file can be ignored. Instead using the type `SettingsMap` from `@chainlink/external-adapter-framework/config`, where applicable, would be sufficient.

```typescript
export const customSettings = {
  API_KEY: {
    // Env var name
    description: '', // Description of the env var
    type: 'string', // What type should the value be
    options: ['foo', 'bar'], // If applicable, a list of valid options this env var could be set to
    default: 'foo', // If applicable, a default value
    validate: (value?: string) => {}, // If applicable, a function to validate the env var value. Return an error message for a failed validation, or undefined if it passes.
    required: true, // If the env var should be required. Default = false
    sensitive: true, // Set to true to censor this env var from logs. Default = false
  },
} as const
```

### Overrides

Overrides are defined in the `/config/overrides.json` file. They allow input parameters to be overriden from a generic symbol to something more specific for the data provider such as an ID. An example of the format is below.

```json
{
  "adapterName": {
    "ETH": "1234"
  }
}
```

### Includes

The includes list, defined in the `/config/includes.json` file, is a parameter only for the `PriceAdapter`. In the v3 framework's current implementation, it is only used to define inverses. This feature allows data to be retrieved for inverted pairs that a data provider does not support.

The most common example of this is for foreign exchange. Data providers will only support pairs in one direction such as USD/JPY but not JPY/USD. To solve this issue for requests that are JPY/USD, we can add an entry for this pair in the includes list like below. This will allow the adapter to retrieve data for USD/JPY instead and return 1 / result.

```json
[
  {
    "from": "JPY",
    "to": "USD",
    "includes": [
      {
        "from": "USD",
        "to": "JPY",
        "inverse": true
      }
    ]
  }
]
```

### Request Transforms

Request transforms is an array of functions that allow the transformation of input parameters. The functions are provided with the incoming `AdapterRequest` object that can be altered and passed on to the next function or the rest of the adapter's logic.

Below is an example of a request transform function that uses the incoming request and transforms it by replacing `base` and `quote` with a new `hash` field.

Note: Overrides and inverses should not be done using this component.

```typescript
export const requestTransform = (req: AdapterRequest<RequestParams>): void => {
  const base = req.requestContext.data.base
  const quote = req.requestContext.data.quote
  if (base && quote) {
    req.requestContext.data.hash = hash(`${base}${quote}`)
    delete req.requestContext.data.base
    delete req.requestContext.data.quote
  }
}

export const adapter = new Adapter({
  ...
  requestTransforms: [requestTransform],
  ...
})
```

### Bootstrap Function

The bootstrap function is custom logic a developer can specify to run at the startup of the adapter.

One use case, shown below, is to perform validations on combinations of env vars. An error is thrown on failure to halt the adapter startup.

```typescript
export const adapter = new Adapter({
  ...
  bootstrap: async (adapter: Adapter<typeof customSettings>) => {
    if (adapter.config.WS_ENABLED && !adapter.config.WS_API_KEY) {
      throw 'WS_API_KEY is required when WS_ENABLED is set to true'
    }
  },
  ...
})
```

## Endpoints

Endpoints allow developers to retrieve data from a variety of API endpoints from a data provider. To reach a particular endpoint in the adapter, the `endpoint` parameter can be specified in the request using either the endpoint name or any of its aliases.

If the endpoint field is omitted, the adapter will use the default endpoint in the `Adapter` parameters. If the endpoint that does not match any endpoints or their aliases, the request will fail.

Define each endpoint in its own file in the `/endpoints` folder. Name the file the endpoints name such as `test.ts`. Below is an example of an `AdapterEndpoint` with all of the parameters that can be specified.

```typescript
import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'

export const endpoint = new AdapterEndpoint<EndpointTypes>({
  name: 'test', // Required. The name of this endpoint. { "endpoint": "test" }
  aliases: ['test-alias'], // Aliases for the endpoint. { "endpoint": "test-alias" }
  transport: httpTransport, // Required. The transport this endpoint is referencing
  inputParameters, // Required. Input parameters sent to this endpoint
  rateLimiting: { allocationPercentage: 50 }, // If applicable, specifiy percentage of rate limit to allocate to this endpoint
  cacheKeyGenerator, // If applicable, specify a custom cache key generator
  customInputValidation, // If applicable, specify custom input validation
})
```

### Endpoint Types

Endpoints contain a type parameter that allows specifying all relevant types needed in a single `EndpointTypes` structure. It allows the developer to specify types for the expected adapter request, adapter response, provider request, provider response, and settings structures. An example is shown below.

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
    RequestBody: RequestBody // Used for HTTP transports
    ResponseBody: ResponseSchema // Used for HTTP transports
    WsMessage: ProviderMessage // Used for Websocket transports
  }
}
```

### Input Parameters

Input parameters define the structure of the request expected by the endpoint. The framework provides helpful fields to customize input parameters along with validations to ensure requests conform to the structure.

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

### Cache Key Generator

The `cacheKeyGenerator` method allows the developer to provide custom logic used to generate a unique cache key for each request. The framework's default behavior is to concat the endpoint name with the stringified input parameters such as `test-{"base":"ETH","quote": "USD"}`.

A potential scenario of where a custom cache key generator would be used is if an input parameter is an array or an object. To ensure that a request generates the same unique key every time, the array or object would need to be sorted. An example of this code is shown below.

```typescript
export const endpoint = new AdapterEndpoint<EndpointTypes>({
  ...
  cacheKeyGenerator: (data) => {
    data.base = (data.base as unknown as string[]).sort()
    return `test-${JSON.stringify(data)}`
  },
  ...
})
```

### Custom input validation

The custom input validation method allows the developer to specify custom logic to validate input on top of the built-in validations the framework provides. It returns an `AdapterError` on validation failure, otherwise `undefined` on success. An example is shown below.

```typescript
export const endpoint = new AdapterEndpoint<EndpointTypes>({
  ...
  customInputValidation(req: RequestParams, config: AdapterConfig<typeof customSettings>): AdapterError | undefined => {
    if (req.value && (req.value < 0 || req.value > 100)) {
      return new AdapterInputError({
        statusCode: 400,
        message: 'Value is less than 0 or greater than 100',
      })
    }
    return
  },
  ...
})
```

### Price Endpoint

As mentioned in the [Adapter Section](#adapter), `PriceAdapter` requires that one of its endpoints is a `PriceEndpoint`. To help standardize the format of a price feed endpoint, the framework provides helpful built-in types. This would alter some of the examples shown in the previous sub-sections like below.

```typescript
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'

type EndpointTypes = {
  // The PriceEndpointInputParameters type is the most common request params for a price endpoint. {base: string, quote: string}
  Request: {
    Params: PriceEndpointInputParameters
  }
  ...
  // The SingleNumberResultResponse type is the most common response format for price endpoints. {result: number, data: { result: number }}
  Response: SingleNumberResultResponse,
  ...
}

export const endpoint = new PriceEndpoint<EndpointTypes>({
  ...
})
```

## Transports

A transport is the method in which the data is retrieved from a data provider for that particular endpoint. As seen in the [Endpoints](#endpoints) section, every endpoint requires one and only one transport. Define this transport in the same file as its associated endpoint. To learn more about specific transports, check the [Transport Types](#transport-types) section.

### Routing Transport

As mentioned above, each endpoint only accepts a single transport. However, there are scenarios where a data provider will have multiple ways to access the same data. For example, a data provider could offer crypto data through REST API and Websockets which would require two different transports. The `RoutingTransport` allows an endpoint to have access to both.

The `RoutingTransport` is used to direct requests to different transports based on request parameters and/or adapter configs. In the example above, the requests could be directed to either an HTTP or Websocket transport. An example of what the code would look like for this scenario is below. The code assumes that requests are directed based on an env var, `WS_ENABLED`.

```typescript
import { httpTransport } from './crypto-http'
import { wsTransport } from './crypto-ws'

export const routingTransport = new RoutingTransport<EndpointTypes>(
  {
    WS: wsTransport,
    REST: httpTransport,
  },
  (req, adapterConfig) => (adapterConfig.WS_ENABLED ? 'WS' : 'REST'),
)

export const endpoint = new AdapterEndpoint<EndpointTypes>({
  name: 'test',
  aliases: ['test-alias'],
  transport: routingTransport,
  inputParameters,
})
```

### Transport Types

[HTTP Transport]() (Guide coming soon)
[Websocket Transport]() (Guide coming soon)
[SSE Transport]() (Guide coming soon)
[Custom Transport]() (Guide coming soon)

## Tests
