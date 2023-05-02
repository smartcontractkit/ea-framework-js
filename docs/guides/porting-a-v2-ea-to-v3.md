# Porting a v2 EA to v3

Checklist when moving an EA from v2 to v3:

- [ ] Move all endpoints. You'll need to create `Transports` for them (see section below)
- [ ] Move rate limit tiers
- [ ] Add custom config, if applicable (e.g. using `API_KEY`)
- [ ] Move overrides, if applicable
- [ ] Move/add tests. Since a goal of v3 is backwards compatibility, integration tests should not include any fundamental changes to the verified payloads sent or received from the adapter.

# Transport

Each endpoint you port over will have its own Transport. Transports are what the EA uses to connect to the DP (you can read more about how they work [here](../basics.md#ea-v3-design)). In v2, it
was commonly Endpoints that connected to the DP, however in v3 this has been pushed one level down with the Endpoint
only being responsible to route to the transport. An EA that supports both WS and HTTP will have both an
**HttpTransport** and a **WebSocketTransport**.

**Select the right Transport to use:**

- **WebSocketTransport**
  Use for WS connections to the DP
- **HttpTransport**
  Use for sending HTTP requests to the DP

If a single endpoint supports multiple transports, these transports should be passed to the endpoint like so:

```typescript
const endpoint = new AdapterEndpoint<BaseEndpointTypes>({
  inputParameters,
  name: 'price', // /price
  transports: {
    rest: httpTransport,
    ws: wsTransport,
  },
  // The custom router is optional; by default the endpoint will attempt to use
  customRouter: (req, config) => { ... },
  // The default transport is also optional
  defaultTransport: 'rest'
})
```

The structure you end up with can look something like this:

```
adapter
├─ config
│  ├─ index.ts // Common config vars
│  ├─ overrides.json // Overrides file
|  └─ includes.json // Includes file (e.x. inverses)
├─ endpoints
│  ├─ crypto // Input: {"endpoint": "crypto"} or {"endpoint": "crypto-ws"} (if added as an alias)
│  │  ├─ HttpTransport
│  │  └─ WebSocketTransport
│  └─ volume // Input: {"endpoint": "volume"}
│     └─ HttpTransport
└─ index // References endpoints, rate limit tiers, custom settings, etc.
```

## Types

Each transport will need a type that defines a set of types. This will look something like this:

```typescript
export type EndpointTypes = {
  Parameters: typeof inputParameters.definition // Types of the custom input params. For no parameters, use EmptyInputParameters
  CustomSettings: typeof customSettings // Types of custom settings. For generic settings, use EmptyCustomSettings
  Response: SingleNumberResultResponse // Type of the response from the EA
  Provider: {
    ... // Provider specific details, these differ and are defined by each Transport implementation
  }
}
```

These types will also be shared with the Endpoint that’s referencing this transport.

## Building an HTTP Transport

Building an HTTP transport mainly consists of defining types (above), and defining how to build the request and parse the response
to and from the DP. An example that sends request to a non-batch endpoint:

```typescript
const httpTransport = new HttpTransport<EndpointTypes>({
  prepareRequests: (params, config) => {
    // The `params` param contains all the requests made to the EA that need data fetched from the DP.
    // Using this, return the request config to the DP.
    return params.map(req => ({
      params: req,
      request: {
        baseURL: config.API_ENDPOINT, // Default endpoint defined in configs
        url: '/price',
        method: 'GET',
        params: {
          from: req.base,
          to: req.quote,
        },
      }
    })
  },
  parseResponse: (params, res) => {
    // The `params` param contains the requests made to the EA that correspond to this DP response.
    // The `res` param contains the response from the DP.
    // Using this, parse the resulting value we want to return.
    const req = params[0] // Since this endpoint only covers one pair at a time
    return {
      data: res,
      // Assuming res = { [base]: { [quote]: { price: number } } }
      result: res[req.base][req.quote].price,
    }
  },
})
```

An example to a batch endpoint is not much different:

```typescript
const httpTransport = new HttpTransport<EndpointTypes>({
  prepareRequest: (params, config) => {
    // The `params` param contains an array of the request made to the EA.
    // Using this, return the request config to the DP.
    return {
      params,
      request: {
        baseURL: config.API_ENDPOINT, // Default endpoint defined in configs
        url: '/price',
        method: 'GET',
        params: {
          from: params.map((req) => req.base).join(','),
          to: params.map((req) => req.quote).join(','),
        },
      },
    }
  },
  parseResponse: (params, res) => {
    // The `params` param contains an array of the request made to the EA.
    // The `res` param contains the response from the DP.
    // Using this, return an array of each combination request-response combination:
    return params.map((req) => ({
      params: req,
      response: {
        data: res.data,
        result: res.data.price,
        timestamps: {
          providerIndicatedTimeUnixMs: res.data.ts,
        },
      },
    }))
  },
})
```

## Building a WebSocket Transport

A WebSocket transport is a bit different from the HttpTransport, but also boils down to two things: forming a
request to the DP and parsing messages to results to be stored in cache.

```typescript
export const wsTransport = new WebSocketTransport<EndpointTypes>({
  url: (context) => context.adapterConfig.WS_API_ENDPOINT || DEFAULT_WS_API_ENDPOINT, // The URL to connect to
  handlers: {
    open(connection) {
      // Called when the WS connection is opened. This can be used to send
      // a login message, or confirm that the connection has been successfully
      // opened. If everything is successful, simply return. For errors,
      // simply throw an error.
    },
    message(message): ProviderResult<EndpointTypes>[] | undefined {
      // Parse the message from the WS stream. If it's a price update, return
      // the request params and its result in an array:
      // return [
      //   {
      //     params: { base: 'ETH', quote: 'USD', endpoint: 'crypto-ws' },
      //     value: 123.45,
      //   },
      // ]
    },
  },
  builders: {
    subscribeMessage: (params) => {
      // Create a WS message to subscribe to the given EA request:
      return { action: 'subscribe', from: params.base, to: params.quote }
    },
    unsubscribeMessage: (params) => {
      // Create a WS message to unsubscribe to the given EA request:
      return { action: 'unsubscribe', from: params.base, to: params.quote }
    },
  },
})
```

# Endpoint

A v3 Endpoint is the same as a v2 Endpoint in that it routes based on the `endpoint` input parameter. The endpoint can take either a single transport, or a map of transports with an optional router function and default transport.

```typescript
export const endpoint = new PriceEndpoint<EndpointTypes>({
  name: 'crypto', // The name of this endpoint. { "endpoint": "crypto" }
  aliases: ['crypto-ws', 'price'], // Aliases for the endpoint
  transport: httpTransport, // The transport this endpoint is referencing
  inputParameters: endpointInputParams, // Input parameters used for this endpoint
})
```

There are multiple types of endpoints:

### PriceEndpoint

As name implies, this endpoint type is used for endpoints that return prices. This is used when the `base/from` and
`quote/to` input params must be supported. This also means that the `inputParameters` object needs to be of type
`PriceEndpointInputParameters` from `@chainlink/external-adapter-framework/adapter`. If you don’t need any special input
parameters, you can simply use the pre-configured `priceEndpointInputParameters` config from the same location.

### AdapterEndpoint

This endpoint type is more generic and puts no restrictions for which input parameters are required. Use this if your
endpoint does not use the `base/from` and `quote/to` input params.

# Config

In v2, EA-specific properties such as `API_ENDPOINT` and `API_KEY` were maintained in an adapter's `env.json`. When migrating to v3 these configs need to be moved to the individual EA's `customSettings` object. They are no longer part of the EA framework config.

For EAs that do not need a custom config, using the type `SettingsMap` from
`@chainlink/external-adapter-framework/config` when needed will be sufficient.

The config will be a map of `(ENV_VAR, Setting)` pairs:

```typescript
export const customSettings = {
  // Env var name
  API_KEY: {
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

This custom setting map can be used when initializing the Adapter. When needing the type, use `typeof customSettings`,
e.g. `AdapterConfig<typeof customSettings>`.

# Adapter

Similar to endpoints, there are multiple adapter types: **PriceAdapter** and **Adapter**. The only difference is that
**PriceAdapter** needs at least one **PriceEndpoint**.

```typescript
import { expose } from '@chainlink/external-adapter-framework'
import { PriceAdapter } from '@chainlink/external-adapter-framework/adapter'
import { SettingsMap } from '@chainlink/external-adapter-framework/config'
import { cryptoEndpoint } from './endpoint'
import { defaultEndpoint } from './config'
import overrides from './config/overrides.json'
import includes from './config/includes.json'

export const adapter = new PriceAdapter({
  name: 'ADAPTER_NAME', // The EA name, in uppercase without any spaces
  defaultEndpoint: 'crypto', // The default endpoint to use
  endpoints: [cryptoEndpoint], // An array of all endpoints available
  rateLimiting: {
    // If applicable, the provider rate limit tiers
    tiers: {
      free: {
        rateLimit1h: 123.45,
      },
      professional: {
        rateLimit1h: 456.78,
      },
    },
  },
  overrides: overrides['adapterName'], // If applicable, reference the overrides config
  includes, // If applicable, reference the includes config
  customSettings: CustomSettings, // If applicable, any custom settings
})

// Expose the server to start the EA
export const server = () => expose(adapter)
```

# Tests

Tests in v3 EAs are very similar to how they’re done in v2. Use nock for DP API mocks, and run tests with Jest where you
compare outputs with snapshots.

You should be running integration tests without metrics, and the tests should support the EA running on any arbitrary
port. The following can be used as a setup helper:

```typescript
import request, { SuperTest, Test } from 'supertest'
import { AddressInfo } from 'net'
import * as process from 'process'
import * as nock from 'nock'
import { ServerInstance } from '@chainlink/external-adapter-framework'

export type SuiteContext = {
  req: SuperTest<Test> | null
  server: () => Promise<ServerInstance>
  fastify?: ServerInstance
}

export type EnvVariables = { [key: string]: string }

export type TestOptions = { cleanNock?: boolean; fastify?: boolean }

export const setupExternalAdapterTest = (
  envVariables: NodeJS.ProcessEnv,
  context: SuiteContext,
  options: TestOptions = { cleanNock: true, fastify: false },
): void => {
  let fastify: ServerInstance

  beforeAll(async () => {
    process.env['METRICS_ENABLED'] = 'false'
    for (const key in envVariables) {
      process.env[key] = envVariables[key]
    }

    if (process.env['RECORD']) {
      nock.recorder.rec()
    }
    fastify = await context.server()

    // eslint-disable-next-line require-atomic-updates
    context.req = request(`localhost:${(fastify.server.address() as AddressInfo).port}`)

    // Only for edge cases when someone needs to use the fastify instance outside this function
    if (options.fastify) {
      // eslint-disable-next-line require-atomic-updates
      context.fastify = fastify
    }
  })

  afterAll(async () => {
    if (process.env['RECORD']) {
      nock.recorder.play()
    }

    await fastify.close()
  })
}
```

You can then use this in your tests:

```typescript
const context: SuiteContext = {
  req: null,
  server: async () => {
    process.env['RATE_LIMIT_CAPACITY_SECOND'] = '6'
    process.env['METRICS_ENABLED'] = 'false'
    const server = (await import('../../src')).server
    return server() as Promise<ServerInstance>
  },
}

const envVariables = {
  CACHE_ENABLED: 'false',
}

setupExternalAdapterTest(envVariables, context)
```
