# Websocket Transport

The `WebSocketTransport` is used to fetch data from a Provider using Websocket protocol. In order to use it you need to provide a `url` function to provide the address where the WS connection should be established, and a handler for any `message` events received from the Websocket connection. Additionally, you can also provide options for the connection, a handler for Websocket `open` events (e.g. for authentication flows), and builders to customize subscribe and unsubscribe messages.

Example usage of WebSocketTransport:

```typescript
export const wsTransport = new WebSocketTransport<EndpointTypes>({
  // Function to provide the URL for the Data Provider WS connection
  url: (context, desiredSubs) => context.adapterSettings.WS_API_ENDPOINT,
  // Handlers for different events in the connection lifecycle
  handlers: {
    // Function called on each Data Provider message sent through the connection
    message(message) {
      return [
        {
          params: {
            base: message.data.base,
            quote: message.data.quote,
          },
          response: {
            result: message.data.price,
            data: {
              result: message.data.price,
            },
            timestamps: {
              providerIndicatedTimeUnixMs: message.data.ts,
            },
          },
        },
      ]
    },
  },
  builders: {
    // It is possible to send custom JSON or string messages to Data Provider
    // Objects will be automatically stringified into JSON.
    subscribeMessage: (params) => ({
      action: 'subscribe',
      symbols: [`${params.base}.${params.quote}`],
    }),
    unsubscribeMessage: (params) => `UNSUBSCRIBE:${params.base}.${params.quote}`,
  },
})
```

### Connecting to the Data Provider

The **url** method takes the adapter context and the desired subscriptions and should return connection url as a string or a Promise of string.
Some Data Providers support subscribing to feeds directly using url, without a separate subscription message. In that case, the second argument of the method can be used to construct the connection/subscription url.

**⚠️ Caution**: this function is called on each iteration of the background execute loop that maintains the WS connection. If the URL changes, the established connection will be closed and a new one will be opened. Therefore, be careful when things like a list of symbols is present in the address, as random sortings could cause unnecessary reconnections.

```typescript
url: (context, desiredSubs) => {
  const params = desiredSubs
    .map((sub) => `${sub.base}-${sub.quote}`)
    .sort() // Remember to sort to avoid unnecessary reconnections
    .join(',')
  return `${context.adapterSettings.WS_API_ENDPOINT}/${params}`
}
```

In some cases it is necessary to pass headers as well (e.g. authentication). The `options` method can be used to pass additional information for the WS connection.

```typescript
      url: (context) => context.adapterSettings.WS_API_ENDPOINT,
      options: async (context) => ({
        headers: {
          'x-auth-token': context.adapterSettings.API_KEY
        },
      })
```

### Handling opened connection (optional)

The `open` method of the `handlers` object is executed once the websocket connection is successfully opened. In some scenarios it is necessary to perform logic when connecting to websocket, but before sending subscription messages. It accepts a raw websocket connection and adapter context as arguments and should return a Promise that either resolves or rejects with error message.

```typescript
handlers: {
  open: (connection, context) => {
    return new Promise((resolve, reject) => {
      // Wait for the first message from the Data Provider
      connection.on('message', (data: WebSocketRawData) => {
        const parsed = JSON.parse(data.toString())
        // If the response contains user_id, it means the connection is ready
        if (parsed.user_id) {
          logger.info('Got logged in response, connection is ready')
          resolve()
          // Otherwise reject the promise
        } else {
          reject(new Error('Failed to make WS connection'))
        }
      })
      const options = {
        jsonrpc: '2.0',
        method: 'login',
        params: { api_key: context.adapterSettings.API_KEY },
      }
      // Send authentication message to Data Provider
      connection.send(JSON.stringify(options))
    })
  }
}
```

In the example above, after the connection is established a custom authentication message is sent to the server and if the response contains user\*id, meaning it's successful, the **open** handler resolves so the framework will proceed sending subscription messages. In cases where no logic is needed after connecting but before subscribing to feeds, the **open** handler can be skipped.

### Sending messages

As shown in the first example, **builders** object contains two methods, **subscribeMessage** and **unsubscribeMessage**. These methods can be provided for the WS transport to use to send subscription/unsubscription messages to Data Provider. Both accept _params_ which is the current input parameters of the request and should return object or string as payload that will be sent to Data Provider. If the payload is object it will be automatically stringified to JSON.

### Heartbeat messages

Some WebSocket providers require periodic heartbeat messages to keep the connection alive. The `WebSocketTransport` supports sending heartbeat messages automatically at a configurable interval.

To enable heartbeat functionality, provide a `heartbeat` handler in the `handlers` object. The heartbeat will automatically start when the connection is opened and stop when the connection is closed.

The `heartbeat` handler receives the WebSocket connection and adapter context, allowing you to implement any heartbeat logic you need. You can use WebSocket protocol-level ping, send custom messages, or perform any other heartbeat-related operations.

**Using WebSocket protocol-level ping:**

```typescript
handlers: {
  heartbeat: (connection) => {
    connection.ping()
  },
}
```

**Using custom heartbeat message:**

```typescript
handlers: {
  heartbeat: (connection, context) => {
    connection.send(JSON.stringify({
      type: 'ping',
      timestamp: Date.now(),
    }))
  },
}
```

**Using ping with optional data:**

```typescript
handlers: {
  heartbeat: (connection) => {
    connection.ping('heartbeat-data')
  },
}
```

The heartbeat interval is controlled by the `WS_HEARTBEAT_INTERVAL_MS` adapter setting (default: 10000ms). The heartbeat will automatically stop if:

- The connection is closed
- The connection state is no longer `OPEN`
- A new heartbeat is started (replaces the previous one)

**Note:** The heartbeat only starts if the `heartbeat` handler is provided. If you don't need heartbeat functionality, simply omit the `heartbeat` handler.

### Retrieving and storing the response or errors

As shown in the first example, the **handlers** object accepts a function called **message** which will be executed when Data Provider sends a message through the WS connection. It takes this message as its first argument and the adapter context as the second, and should build and return a list of response objects (_ProviderResult_) that will be stored in the response cache for the endpoint.

#### Successful response structure

A _ProviderResult_ is an object that contains two keys `params` and `response`: the former is the set of parameters that uniquely relate to the response, and the latter is the value that will be returned as response from External Adapter. The `response` should contain `data` and `result` properties. Optionally, a `timestamps` object can be provided to manually specify the timestamps for the received message.

Example response structure:

```typescript
message(message) {
  return [
    {
      params: {
        base: message.data.base,
        quote: message.data.quote,
      },
      response: {
        result: message.data.price,
        data: {
          result: message.data.price,
        },
        timestamps: {
          providerIndicatedTimeUnixMs: message.data.ts,
        },
      },
    },
  ]
}
```

#### Error response structure

It is also possible to store and return errors as well, in case the Data Provider did not return information that was expected. In case of errors, instead of `data` and `result`, the `resonse` object should contain `statusCode` for the errored response and an `errorMessage` that will be sent back from the adapter.

Refactored example that shows both error and success examples:

```typescript
message(message, context) {
  // HANDLING ERRORS
  // If there is no information about params in the message, an empty array can be returned.
  if (!message.data.price) {
    return [
      {
        params: {
          base: message.data.base,
          quote: message.data.quote,
        },
        response: {
          errorMessage: 'No price in message',
          statusCode: 500,
        },
      }
    ]
  }
  // SENDING SUCCESSFUL RESPONSE
  return [
    {
      params: {
        base: message.data.base,
        quote: message.data.quote,
      },
      response: {
        result: message.data.price,
        data: {
          result: message.data.price,
        },
        timestamps: {
          providerIndicatedTimeUnixMs: message.data.ts,
        },
      },
    },
  ]
}
```

### Accessing params in the message handler

Because of the asynchronous nature of WebSocket connections, messages sent from the provider cannot be automatically linked to the EA requests they're meant to fulfill, hence the need for the user provided `message` handler. In some very rare cases, those messages also lack sufficient or clear enough information for that method to relate them either. For these, a subclass of the `WebSocketTransport` called `WebsocketReverseMappingTransport` is provided. **This transport should only be used when absolutely necessary**.

Consider an example where the adapter sends a request with following information:

```typescript
subscribeMessage: (params) => ({
  action: 'subscribe',
  symbols: [`${params.base}${params.quote}`], // ETHUSD
})
```

and the Data Provider responds with the message:

```typescript
{
  price: 150,
  symbol: 'ETHUSD'
}
```

If in this case we know the provider does not have a deterministic way of splitting the incoming symbol, we'll need to keep track of what we subscribed to. This is where the `WebsocketReverseMappingTransport` comes in. It allows us to set a mapping between the symbol and the params, and then retrieve the params when the message comes in.

```typescript
export  const wsTransport = new WebsocketReverseMappingTransport<EndpointTypes, string>({
// ....
  subscribeMessage: (params) => {
    const pair = `${params.base}${params.quote}` // ETHUSD
    wsTransport.setReverseMapping(pair, params)
    return {
      action: 'subscribe',
      symbols: [pair], // ETHUSD
    }
  }
// ....

  message: (message) => {
    const params = websocketTransport.getReverseMapping(message.symbol)
    if (!params) {
      return []
    }
    return [
      {
        params,
        response: {
          result: message.price,
          data: {
            result: message.price,
          },
        },
      },
    ]
  }

```

### Type params of the transport

`WebSocketTransport` accepts one type param that describes the request and response types for the endpoint and the transport. It is used to ensure that the transport and endpoint are compatible.

```typescript
const wsTransport = new WebSocketTransport<EndpointTypes>({
```

Example structure of `EndpointTypes`:

```typescript
export type EndpointTypes = {
  Parameters: typeof inputParameters.definition // type for the EA endpoint input parameters
  Settings: typeof config.settings // type of adapter config
  Response: SingleNumberResultResponse // type of External Adapter response. `SingleNumberResultResponse` is a built in type that indicates that both `data` and `result` are numbers
  Provider: {
    WsMessage: WsMessage // type of message that will come through the websocket connection
  }
}
```
