# Websocket Transport

WebSocketTransport is used to fetch data from a Provider using Websocket protocol. In order to use WebSocketTransport you need to provide a `url` for the WS connection, and a handler for any `message` events received from the Websocket connection. Additionally, you can also provide options for the connection, a handler for Websocket `open` events, and builders to customize subscribe and unsubscribe messages.

Example usage of WebSocketTransport

```typescript
 export const wsTransport = new WebSocketTransport<EndpointTypes>({
  url: (context, desiredSubs) => context.adapterConfig.WS_API_ENDPOINT,
  handlers: {
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
    subscribeMessage: (params) => ({
      action: 'subscribe',
      symbols: [`${params.base}.${params.quote}`],
    }),
    unsubscribeMessage: (params) => ({
      action: 'unsubscribe',
      symbols: [`${params.base}.${params.quote}`],
    }),
  },
})
```

### Connecting to Data Provider

**url**  method takes the adapter context and the desired subscriptions and should return connection url as a string or a Promise of string.
Some Data Providers support subscribing to feeds directly using url, without a separate subscription message. In that case, the second argument of the method can be used to construct the connection/subscription url.

```typescript
    url: (context, desiredSubs) => {
        const params = desiredSubs.map((sub) => `${sub.base}-${sub.quote}`).join(',')
        return `${context.adapterConfig.WS_API_ENDPOINT}/${params}`
      }
```

In some cases it is necessary to pass headers as well (e.g. authentication). The `options` method can be used to pass additional information for the WS connection.

```typescript
      url: (context) => context.adapterConfig.WS_API_ENDPOINT,
      options: async (context) => ({
        headers: {
          'x-auth-token': context.adapterConfig.API_KEY
        },
      })
```

### Handling opened connection (optional)

The **open** method of the **handlers** object is executed once the websocket connection is successfully opened. In some scenarios it is necessary to perform logic when connecting to websocket, but before sending subscription messages. It accepts a raw websocket connection and adapter context as arguments and should return a Promise that either resolves (*return Promise.resolve()*) or rejects with error message.

```typescript
handlers: {
  open: (connection, context) => {
    return new Promise((resolve, reject) => {
      connection.on('message', (data: WebSocketRawData) => {
        const parsed = JSON.parse(data.toString())
        if (parsed.user_id) {
          logger.info('Got logged in response, connection is ready')
          resolve()
        } else {
          reject(new Error('Failed to make WS connection'))
        }
      })
      const options = {
        jsonrpc: '2.0',
        method: 'login',
        params: { api_key: context.adapterConfig.API_KEY },
      }
      connection.send(JSON.stringify(options))
    })
  }
}
```

In the example above, after the connection is established a custom authentication message is sent to the server and if the response contains user_id, meaning it's successful, the **open** handler resolves so the framework will proceed sending subscription messages. In cases where no logic is needed after connecting but before subscribing to feeds, **open** handler can be skipped or *Promise.resolve()* can be returned.

### Sending messages

As shown in the first example, **builders** object contains two methods, **subscribeMessage** and **unsubscribeMessage**. Those methods can be used to send subscription/unsubscription messages to Data Provider. Both accept *params* which is the current input parameters of the request.

### Retrieving and storing the response or errors

As shown in the first example, **handlers** object contains method called **message** which will be executed when Data Provider sends a message back. **message** takes the received message from Data Provider as first argument and adapter context as second argument and should  build and return a list of response objects (*ProviderResult*) that will be stored in the response cache for an endpoint.

#### Successful response structure

*ProviderResult* is an object that contains two keys `params` and `response` . `params` is the set of parameters that uniquely relate to the response . `response` is the value that will be returned as response from External Adapter. `response` should contain `data` and `result` properties. Optionally `timestamps` object can be provided to manually specify the timestamps for the received message.

Example response structure

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

It is also possible to store and return errors as well, in case Data Provider has not returned information that was expected.  In case of error, instead of `data` and `result`, the `resonse` object should contain `statusCode` for the errored response and `errorMessage` that will be sent back from the adapter.

Refactored example that shows both error and success examples

```typescript
message(message, context) {
  // HANDLING ERRORS. If there is no information about params in the message, an empty array can be returned. 
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

**message** handler accepts two arguments, raw message that was received from Data Provider and adapter context. Because of asynchronous nature of WebSocketTransport, input parameters of the request are not available in the **message** handler. This might be issue when Data Provider sends a message where information about request params is hard to translate to input params.

Consider an example where the adapter sends a request with following information

```typescript
    subscribeMessage: (params) => ({
              action: 'subscribe',
              symbols: [`${params.base}${params.quote}`], // ETHUSD
    })
```
and Data Provider responds with the message

```typescript
{price: 150, symbol: 'ETHUSD'}
```

Instead of  trying to split the Data Provider symbol string based on length or other delimiter, we can use **WebsocketReverseMappingTransport** which extends WebSocketTransport and has helper methods to set and get input params.

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

Example structure of `EndpointTypes`

```typescript
export type EndpointTypes = {  
 Request: {  
	Params: CryptoRequestParams // type for the EA endpoint input parameters
 }  
 Response: SingleNumberResultResponse // type of External Adapter response. `SingleNumberResultResponse` is a built in type that indicates that both `data` and `result` are numbers
 Settings: BaseAdapterSettings  // type of adapter config
 Provider: {  
  WsMessage: WsMessage  // type of message that will come through the websocket connection
 }  
}
```

 