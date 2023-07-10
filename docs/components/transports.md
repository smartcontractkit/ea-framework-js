# Transports

To learn more about what transports are and what they do, please refer to the [EA Basics Doc](../basics.md)

Define transport file in a seperate folder called `transport`. The name of the file is the same as its associated endpoint. In case endpoint supports multiple transports, transport file names can be suffixed with transport types. 

## Choosing Transports

### Basic Transports

The v3 framework provides transports to fetch data from a Provider using the common protocols they might use. Please refer to the guides listed below for the relevant transports your adapter endpoints need.

If you find that the built-in features of a transport do not meet your endpoint's requirements, you can define a custom transport extending one of the existing ones to include the custom functionality yourself.

- [HTTP Transport](./transport-types/http-transport.md)
- [Websocket Transport](./transport-types/websocket-transport.md)
- [SSE Transport](./transport-types/sse-transport.md)
- [Custom Transport](./transport-types/custom-transport.md)
