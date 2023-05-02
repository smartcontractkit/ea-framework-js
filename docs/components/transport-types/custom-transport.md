#  Custom Transport

Transport defines the way in which an AdapterEndpoint will process incoming requests to fetch data from a Provider. The framework provides built-in transports to fetch data from a Provider using several protocols, including `http`, `websocket`,  and `sse`.  In rare  cases, such as when a Provider uses a different protocol, or when you need custom functionality, that is not provided by the built-in transports, you may need to define custom transport to fetch data from a Provider. This guide will walk you through the process of defining a custom transport.

A simple use case for custom transport can be a fetching from a Provider where data is not ordinarily paginated. Imagine a Data Provider returning the following response for an arbitrary API endpoint.

```json
{
  "data": {
    "value": 42
  },
  "next_page_token": "TOKEN"
}
```

The response contains `next_page_token` which should be used to fetch the next page from the Provider, which has the same response structure but different `next_page_token` and `data`.  The goal is to fetch all the available pages and sum all the values from all pages and return it as a final result. Currently, it is not possible to do this with existing transports, so custom transport should be used.

To define a custom transport, you must implement the `Transport` interface.

Example implementation of CustomTransport

```typescript  
export class CustomTransport<T extends EndpointTypes> implements Transport<T> {
  // name of the transport, used for logging
  name!: string
  // cache instance for caching responses from provider
  responseCache!: ResponseCache<T>
  // instance of Requester to be used to data fetching
  requester!: Requester

  async initialize(dependencies: TransportDependencies<T>, _adapterSettings: EndpointTypes['Settings'], _endpointName: string, transportName: string): Promise<void> {
    this.responseCache = dependencies.responseCache
    this.requester = dependencies.requester
    this.name = transportName
  }

  async foregroundExecute(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    settings: typeof config.settings,
  ): Promise<AdapterResponse<EndpointTypes['Response']>> {
    let sumValue = 0

    let lastPage = false
    const input = req.requestContext.data

    const requestConfig = this.prepareRequest(input, settings)

    const providerDataRequestedUnixMs = Date.now()
    while (!lastPage) {
      const result = await this.requester.request<ResponseSchema>(
        calculateHttpRequestKey({
          context: {
            adapterSettings: settings,
            inputParameters: INPUT_PARAMETERS_FOR_ENDPOINT,
            endpointName: ENPDOINT_NAME,
          },
          data: requestConfig.params,
          transportName: this.name,
        }),
        requestConfig,
      )

      const { data } = result.response.data

      sumValue += data.value

      const nextPageToken = result.response.data.next_page_token
      requestConfig.params.next_page_token = nextPageToken

      if (!nextPageToken) {
        lastPage = true
      }
    }

    const providerDataReceivedUnixMs = Date.now()

    const result = sumValue

    const response = {
      data: {
        result: result,
      },
      statusCode: 200,
      result: result,
      timestamps: {
        providerDataRequestedUnixMs,
        providerDataReceivedUnixMs,
      },
    }
    await this.responseCache.write(this.name, [
      {
        params: req.requestContext.data,
        response,
      },
    ])

    return response
  }

  prepareRequest(
    params: RequestParams,
    settings: typeof config.settings,
  ): AxiosRequestConfig {
    const { API_ENDPOINT, API_KEY } = settings
    return {
      baseURL: API_ENDPOINT,
      url: '/data',
      params: {
        api_key: API_KEY,
        start_time: params.startTime,
        end_time: params.endTime,
        // There is no next_page_token for initial request. For fetching next pages next_page_token is inserted dynamically from response
      },
    }
  }


}
```

Let's break down the CustomTransport class.
It implements two methods from `Transport` interface, `initialize` and `foregroundExecute` and uses some internal helper methods.

`initialize` is required method for transport. When transport gets initialized by the framework,  `initialize`  method of the transport will be called with transport dependencies, adapter settings, endpoint name, and transport name as arguments. The method is responsible for initializing transport state, for example, setting cache variables, rate limit variables and transport name.
In the example above `initialize` is used to assign `name`, `requester` and `responseCache` dependencies to a transport variable.

The second method from `Transport` interface that is used is `foregroundExecute` which performs a synchronous fetch/processing of information within the lifecycle of an incoming request.
When request is made to adapter, `foregroundExecute` will be invoked with *AdapterRequest* and adapter settings as arguments and should return *AdapterResponse*.

### Handling custom request

`foreGroundExecute` registers local variables to store summed values and last page state, assigns normalized input parameters from a request to local variable and calls internal helper function `prepareRequest` which takes the request input data and adapter settings and returns *axios* request configuration.

```typescript
let sumValue =  0
let lastPage =  false  
const input = req.requestContext.data 
const requestConfig =  this.prepareRequest(input, settings)
```

The next step is to send the request to Data Provider. *While* loop is used to loop and repeat the request to the Provider until the last page is reached (no more `next_page_token` in the response).

```typescript
while (!lastPage) {
  const result = await this.requester.request<ResponseSchema>(
    calculateHttpRequestKey({
      context: {
        adapterSettings: settings,
        inputParameters: INPUT_PARAMETERS_FOR_ENDPOINT,
        endpointName: ENPDOINT_NAME,
      },
      data: requestConfig.params,
      transportName: this.name,
    }),
    requestConfig,
  )

  const { data } = result.response.data

  sumValue += data.value

  const nextPageToken = result.response.data.next_page_token
  requestConfig.params.next_page_token = nextPageToken

  if (!nextPageToken) {
    lastPage = true
  }
}
```

For each request iteration `next_page_token` from current response will be used for the next request.  `Requester` class provided by the framework is used to make requests to Data Provider. It is also responsible for rate-limiting requests, handling error and timeouts. 

Once all the pages are fetched (no more `next_page_token` in the response, `lastPage = true`) the response object is constructed, saved in the cache and returned.

```typescript
const result = sumValue

const response = {
  data: {
    result: result,
  },
  statusCode: 200,
  result: result,
  timestamps: {
    providerDataRequestedUnixMs,
    providerDataReceivedUnixMs,
  },
}
await this.responseCache.write(this.name, [
  {
    params: req.requestContext.data,
    response,
  },
])

return response
```

The example showed custom transport implementation that makes a request to Data Provider multiple times, fetches multiple values, accumulates them and returns a single response. 

### Type params of the transport

`Transport` accepts one type param that describes the request and response types for the endpoint and the transport. It is used to ensure that the transport and endpoint are compatible.

```typescript
export class CustomTransport<T extends EndpointTypes> implements Transport<T>
```

Example structure of `EndpointTypes`

```typescript
export type EndpointTypes = {
 Parameters: typeof inputParameters.definition // type for the EA endpoint input parameters
 Settings: typeof config.settings // type of adapter config   
 Response: SingleNumberResultResponse // type of External Adapte response. `SingleNumberResultResponse` is built in type that indicates that both `data` and `result` are numbers
 Provider: {  
  RequestBody: never  // type of request body in the case of POST requests. This is usually `never` for GET requests, and is *not* the same as query params
  ResponseBody: ProviderResponseBody  // interface of raw response body from Data Provider 
  }  
}
```


