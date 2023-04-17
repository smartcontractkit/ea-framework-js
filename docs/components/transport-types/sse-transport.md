# SSE Transport

SseTransport is used to fetch data from a Provider using SSE (Server-Sent Events) protocol. In order to use SseTransport you need to provide a `prepareSSEConnectionConfig` method for connection, `prepareSubscriptionRequest` and `prepareUnsubscriptionRequest` methods for sending data to the Provider and `eventListeners` array of listeners for handling and storing the responses. Optionally you can provide `prepareKeepAliveRequest` method to send a request to the Provider to keep the connection alive.

Example usage of SseTransport

```typescript  
export const sseTransport = new SseTransport<EndpointTypes>({
  prepareSSEConnectionConfig: (params, context) => {
    return { url: context.adapterSettings.API_ENDPOINT }
  },
  prepareKeepAliveRequest: () => {
    const axiosRequestConfig = {
      method: 'POST',
      url: `${context.adapterSettings.API_ENDPOINT}/ping`,
    }
    return axiosRequestConfig
  },
  prepareSubscriptionRequest: () => {
    const axiosConfig = {
      method: 'POST',
      url: `${context.adapterSettings.API_ENDPOINT}/sub`,
    }
    return axiosConfig
  },
  prepareUnsubscriptionRequest: () => {
    const axiosConfig = {
      method: 'POST',
      url: `${context.adapterSettings.API_ENDPOINT}/unsub`,
    }
    return axiosConfig
  },
  eventListeners: [
    {
      type: 'price',
      parseResponse: (evt) => {
        return [
          {
            params: { base: evt.data.base, quote: evt.data.quote },
            response: {
              data: {
                result: evt.data.price,
              },
              result: evt.data.price,
            },
          },
        ]
      },
    },
  ],
})
```

### Connecting to Data Provider

**prepareSSEConnectionConfig**  method takes  the desired subscriptions and the adapter context and should return a connection configuration.
Connection configuration is an object that should at least contain `url` property. Additional connection options can be provided using `eventSourceInitDict` property.
```typescript
prepareSSEConnectionConfig: (params, context) => {
  return {
    url: context.adapterSettings.API_ENDPOINT,
    eventSourceInitDict: { withCredentials: true },
  }
}
```

### Sending messages

**prepareSubscriptionRequest**  and **prepareUnsubscriptionRequest** should be used to send a request to Data Provider for feed subscription/unsubscription. Both methods take the desired subscriptions and the adapter context as arguments and should return *axios* request configuration.

```typescript
prepareSubscriptionRequest: (params, context) => {
  const subs = params.map(params => `${params.base}/${params.quote}`).join(',')
  const axiosConfig = {
    method: 'POST',
    data: { subscriptions: subs },
    url: `${context.adapterSettings.API_ENDPOINT}/sub`,
  }
  return axiosConfig
}
```

Additionally, **prepareKeepAliveRequest** method can be used to send keepalive messages to Data Provider. The method takes the adapter context as argument and should return *axios* request configuration.

### Retrieving and storing the response or errors

To listen message events from the server **eventListeners** should be used . It is an array of listeners where each listener is an object with two properties `type` and `parseResponse`. `type` is the string event name and `parseResponse` is a function that will be executed  when Data Provider sends an event with a name specified in the `type`.
`parseResponse` has one argument, raw event from the server, and should  build and return a list of response objects (*ProviderResult*) that will be stored in the response cache for an endpoint.

#### Successful response structure

*ProviderResult* is an object that contains two keys `params` and `response` . `params` is the set of parameters that uniquely relate to the response . `response` is the value that will be returned as response from External Adapter. `response` should contain `data` and `result` properties.

Example response structure

```typescript  
eventListeners: [
  {
    type: 'price',
    parseResponse: (evt) => {
      return [
        {
          params: { base: evt.data.base, quote: evt.data.quote },
          response: {
            data: {
              result: evt.data.price,
            },
            result: evt.data.price,
          },
        },
      ]
    },
  },
]
```

#### Error response structure

It is also possible to store and return errors as well, in case Data Provider has not returned information that was expected.  In case of error, instead of `data` and `result`, the `resonse` object should contain `statusCode` for the errored response and `errorMessage` that will be sent back from the adapter.

Refactored example that shows both error and success examples

```typescript
eventListeners: [
  {
    type: 'price',
    parseResponse: (evt) => {
      if (!evt.data.price) {
        return [
          {
            params: { base: evt.data.base, quote: evt.data.quote },
            response: {
              errorMessage: 'No price in message',
              statusCode: 504,
            },
          },
        ]
      }
      return [
        {
          params: { base: evt.data.base, quote: evt.data.quote },
          response: {
            data: {
              result: evt.data.price,
            },
            result: evt.data.price,
          },
        },
      ]
    },
  },
]
```

### Type params of the transport

`SseTransport` accepts one type param that describes the request and response types for the endpoint and the transport. It is used to ensure that the transport and endpoint are compatible.

```typescript
const sseTransport = new SseTransport<EndpointTypes>({
```

Example structure of `EndpointTypes`

```typescript
export type EndpointTypes = {  
 Request: {  
	Params: CryptoRequestParams // type for the EA endpoint input parameters
  }  
 Response: SingleNumberResultResponse // type of External Adapte response. `SingleNumberResultResponse` is built in type that indicates that both `data` and `result` are numbers
 Settings: BaseAdapterSettings  // type of adapter config
 Provider: {  
  RequestBody: never  // type of request body (axiosconfig data)
  }  
}
```

 