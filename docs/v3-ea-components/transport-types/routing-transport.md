# Routing Transport

Each EA endpoint only accepts a single transport. However, there are scenarios where a data provider will have multiple ways to access the same data. For example, a data provider could offer crypto data through REST API and Websockets which would require two different transports. The `RoutingTransport` allows an endpoint to have access to both.

The `RoutingTransport` is used to direct requests to different transports based on request parameters and/or adapter configs. In the scenario described above, the requests would need to be directed to either an HTTP or Websocket transport. An example of what the code would look like for this is below.

```typescript
import { httpTransport } from './endpoint-http'
import { wsTransport } from './endpoint-ws'

export const routingTransport = new RoutingTransport<EndpointTypes>({
  ws: wsTransport,
  rest: httpTransport,
})
```

> **Warning**
> Be aware that for backwards compatibility, a default transport will likely be desired. This can be achieved by setting a default in the inputParameters.

By default, the RoutingTransport expects a `transport` input parameter, that will be matched (case insensitive) to the keys of the transport map passed to the `RoutingTransport`'s constructor. You can optionally specify a custom router function that allows to implement different logic:

```typescript
import { httpTransport } from './endpoint-http'
import { wsTransport } from './endpoint-ws'

export const routingTransport = new RoutingTransport<EndpointTypes>(
  {
    ws: wsTransport,
    rest: httpTransport,
  },
  (req, adapterConfig) => {
    // This code is not really a realistic use case, but does show the available context within the custom router
    if (adapterConfig.SETTING === req.requestContext.data.base) {
      return 'ws'
    } else {
      return 'rest'
    }
  },
)
```
