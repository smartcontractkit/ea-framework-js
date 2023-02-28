# Transports

To learn more about what transports are and what they do, please refer to the [EA Basics Doc](../basics.md)

As seen in the [Endpoints Guide](endpoints.md), every endpoint requires one and only one transport. Define this transport in the same file as its associated endpoint.

## Choosing Transports

### Basic Transports

The v3 framework provides transports to fetch data from a Provider using the common protocols they might use. Please refer to the guides listed below for the relevant transports your adapter endpoints need.

If you find that the built-in features of a transport do not meet your endpoint's requirements, you can define a custom transport extending one of the existing ones to include the custom functionality yourself.

- [HTTP Transport](./transport-types/http-transport.md)
- [Websocket Transport](./transport-types/websocket-transport.md)
- [SSE Transport](./transport-types/sse-transport.md)
- [Custom Transport](./transport-types/custom-transport.md)
