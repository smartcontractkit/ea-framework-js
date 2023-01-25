# Transports

To learn more about what transports are and what they do, please refer to the [EA Basics Doc](../basics.md)

As seen in the [Endpoints Guide](endpoints.md), every endpoint requires one and only one transport. Define this transport in the same file as its associated endpoint.

### Choosing Transports

The v3 framework provides transports for the common protocols a DP endpoint could use. Please refer to the guides listed below for the relevant transports your adapter endpoints need.

In certain cases, the same data can be retrieved through different protocols. For these cases, please refer to the [Routing Transport Section](#routing-transport).

If you find that the built-in features of a transport do not meet your endpoint's requirements, you can define a custom transport extending one of the existing ones to include the custom functionality yourself.

- [HTTP Transport](./v3-ea-components/http-transport.md)
- [Websocket Transport](./v3-ea-components/websocket-transport.md)
- [SSE Transport](./v3-ea-components/sse-transport.md)
- [Custom Transport](./v3-ea-components/custom-transport.md)

### Routing Transport

As mentioned above, each endpoint only accepts a single transport. However, there are scenarios where a data provider will have multiple ways to access the same data. For example, a data provider could offer crypto data through REST API and Websockets which would require two different transports. The `RoutingTransport` allows an endpoint to have access to both.

The `RoutingTransport` is used to direct requests to different transports based on request parameters and/or adapter configs. In the scenario described above, the requests would need to be directed to either an HTTP or Websocket transport. An example of what the code would look like for this is below. The code assumes that requests are directed based on a request field, `transport`.

```typescript
import { httpTransport } from './endpoint-http'
import { wsTransport } from './endpoint-ws'

export const routingTransport = new RoutingTransport<EndpointTypes>(
  {
    WS: wsTransport,
    REST: httpTransport,
  },
  (req, adapterConfig) => (req.requestContext.data.transport === 'websocket' ? 'WS' : 'REST'),
)
```
