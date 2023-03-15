# HTTP Transport

HttpTransport is used to fetch data from a Provider using HTTP(S) protocol. In order to use HttpTransport you need to provide two methods `prepareRequests` and `parseResponse` that will be used to build requests and parse responses respectively. 

Example usage of HttpTransport
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
**prepareRequests**  method  takes the list of currently active input parameters in the subscription set and adapter config and should return one or multiple request configs (_ProviderRequestConfig_) depending if Data Provider supports request batching or not.

#### Request config structure
*ProviderRequestConfig* is a object that contains two keys `params` and `request` . `params` is the input parameters for a request and whatever  is provided will be available in the **parseResponse** method. `request` is the *axios* request configuration where request url, request method, query or body params, headers and etc can be specified.

#### Send batch request to Data Provider
The example above assumes that Data Provider doesn't support batching and each active input parameter will initiate request to Data Provider. Bellow is the example of batch version of prepareRequests
```typescript  
  prepareRequests: (params, config) => {  
    return {  
        params: params,
		request: {  
          baseURL: config.API_ENDPOINT,  
          url: '/price',
          params: {
	          symbols: [...new Set(params.map((p) => p.symbol.toLowerCase()))].join(',')
          }  
        },  
      } 
  }
```
The difference is that instead of returning array of request config objects, only one object is returned where information about input parameters is passed to Data Provider as one query parameter.

###  Parsing and storing the response or errors
**parseResponse**  method  takes the incoming response from the Data Provider, params from request config, adapter config, and should build and return a list of response objects (*ProviderResult*) that will be stored in the response cache for an endpoint.

#### Successful response structure
*ProviderResult* is an object that contains two keys `params` and `response` . `params` is the set of parameters that uniquely relate to the response . `response` is the value that will be returned as response from External Adapter. `response` should contain `data` and `result` properties.

Example response structure
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
It is also possible to store and return errors as well, in case Data Provider has not returned information that was expected.  In case of error, instead of `data` and `result`, the `resonse` object should contain `statusCode` for the errored response and `errorMessage` that will be sent back from the adapter.

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
				   statusCode: 502
			   }
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
 Request: {  
	Params: CryptoRequestParams // type of input parameters
  }  
 Response: SingleNumberResultResponse // type of External Adapte response. `SingleNumberResultResponse` is built in type that indicates that both `data` and `result` are numbers
 Settings: BaseAdapterSettings  // type of adapter config
 Provider: {  
  RequestBody: never  // type of request body in case of POST requests. `never` for GET requests
  ResponseBody: ProviderResponseBody  // interface of raw response body from Data Provider 
  }  
}
```

 