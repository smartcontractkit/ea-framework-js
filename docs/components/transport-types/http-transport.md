# HTTP Transport

HttpTransport is used to fetch data from a Provider using HTTP requests. It does this by doing the following:

1. All incoming requests to the adapter for this endpoint and transport are stored in a cached set (`SubscriptionSet`).
1. Periodically, the background execute loop of the adapter will read this entire set and call the `prepareRequests` method of the transport. This transforms the inbound EA requests into the corresponding requests to make to the Data Provider.
1. Those requests are scheduled to be sent in the centralized `Requester` instance, that will fire them off as soon as the rate limits allow.
1. As responses come in, they are passed to the `parseResponse` method of the transport, which transforms the response into the corresponding EA response.
1. Finally, those responses are stored in the cache to be ready for the next inbound EA request, or any pending request that was waiting for it.

## How to use the HttpTransport

### Example usage of HttpTransport

```typescript
const transport = new HttpTransport<EndpointTypes>({
  prepareRequests: (params, config) => {
    return params.map((param) => {
      const symbol = param.symbol.toLowerCase()
      const url = `/price/${symbol}`

      return {
        params: param
		request: {
          baseURL: config.API_ENDPOINT,
          url,
        },
      }
    })
  },
  parseResponse: (params, res, config) => {
    return res.data.map((result) => {
      return {
        params: { symbol: result.symbol},
        response: {
          data: {
            result: result.price,
          },
          result: result.price,
        },
      }
    })
  },
})
```

### Building requests

Requests that will be sent to the Provider are built using the **prepareRequests** function provided to the `HttpTransport` constructor. The arguments provided to the function are the list of currently active input parameters in the subscription set and the adapter config. The function should return an array of request config objects. The number of requests is arbitrary: if the provider supports batching for example, a single request config with all parameters can be returned. If on the other hand the provider does not support batching, the array could contain one request config per EA request parameters object.

#### Request config structure

_ProviderRequestConfig_ is an object with two keys: `params` and `request`. `params` is the list of currently active input parameters in the subscription set, and will also be available in the **parseResponse** method. `request` is the _axios_ request configuration where parameters such as the request URL, request method, query or body params, and headers can be specified.

```typescript
// Example 1: Data Provider does not support batching
prepareRequests: (params, config) => {
  // We map the input parameters to the request config objects 1:1
  return params.map((param) => {
    const symbol = param.symbol.toLowerCase()
    const url = `/price/${symbol}`

    return {
      params: param // Single EA input parameters object
      request: {
        baseURL: config.API_ENDPOINT,
        url,
      },
    }
  })
}

// Example 2: Data Provider supports batching
prepareRequests: (params, config) => {
  // We return a single request config object with all input parameters
  return {
    params: params, // All EA input parameters
    request: {
      baseURL: config.API_ENDPOINT,
      url: '/price',
      params: {
        symbols: [...new Set(params.map((p) => p.symbol.toLowerCase()))].join(','),
      },
    },
  }
}
```

### Parsing and storing the response or errors

The **parseResponse** method takes the incoming response from the Data Provider, params from request config, adapter config, and returns a list of response objects (_ProviderResult_) that will be stored in the response cache for an endpoint.

#### Successful response structure

_ProviderResult_ is an object with two keys: `params` and `response` . `params` is the set of EA input parameters that uniquely relate to the response . `response` is the value that will be returned as response from External Adapter. `response` should contain the `data` and `result` properties.

Example response structure:

```typescript
parseResponse: (params, response, config) => {
  return params.map((param) => {
    const value = response.data[param.symbol].price
    return {
      params: param, // Note that this should be single input parameter, not the params array above
      response: {
        data: {
          result: value,
        },
        result: value,
      },
    }
  })
}
```

#### Error response structure

It is also possible to store and return errors as well, in case Data Provider has not returned information that was expected. In case of error, instead of `data` and `result`, the `resonse` object should contain `statusCode` for the errored response and `errorMessage` that will be sent back from the adapter.

Refactored example that shows both error and success examples

```typescript
parseResponse: (params, response, config) => {
  return params.map((param) => {
    const value = response.data[param.symbol]?.price
    if (!value) {
      // no value provided from DP. Sending error response back
      return {
        params: param,
        response: {
          errorMessage: `Could not retrieve valid data from Data Provider for symbol ${param.symbol}`,
          statusCode: 502,
        },
      }
    }
    // if everything is ok we send success response
    return {
      params: param, // Note that this should be single input parameter, not the params array above
      response: {
        data: {
          result: value,
        },
        result: value,
      },
    }
  })
}
```

### Type params of the transport

`HttpTransport` accepts one type param that describes the request and response types for the endpoint and the transport. It is used to ensure that the transport and endpoint are compatible.

```typescript
const transport = new HttpTransport<EndpointTypes>({
```

Example structure of `EndpointTypes`

```typescript
export type EndpointTypes = {
  Parameters: typeof inputParameters.definition // type for the EA endpoint input parameters
  Settings: typeof config.settings // type of adapter config
  Response: SingleNumberResultResponse // type of External Adapter response. `SingleNumberResultResponse` is a built in type that indicates that both `data` and `result` are numbers
  Provider: {
    RequestBody: never // type of request body in the case of POST requests. This is usually `never` for GET requests, and is *not* the same as query params
    ResponseBody: ProviderResponseBody // interface of raw response body from Data Provider
  }
}
```
