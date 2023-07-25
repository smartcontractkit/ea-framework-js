import { WebSocketTransport } from '@chainlink/external-adapter-framework/transports'
import { BaseEndpointTypes } from '../endpoint/<%= inputEndpointName %>'

export interface WSResponse {
  success: boolean
  price: number
  base: string
  quote: string
  time: number
}

<% if (includeComments) { -%>
// WsTransport extends base types from endpoint and adds additional, Provider-specific types like 'WsMessage', which is the type of
// websocket received message
<% } -%>
export type WsTransportTypes = BaseEndpointTypes & {
  Provider: {
    WsMessage: WSResponse
  }
}
<% if (includeComments) { -%>
// WebSocketTransport is used to fetch and process data from a Provider using Websocket protocol.
<% } -%>
export const wsTransport = new WebSocketTransport<WsTransportTypes>({
<% if (includeComments) { -%>
  // use `url` method to provide connection url. It accepts adapter context, so you have access to adapter config(environment variables) and
  // request payload if needed
<% } -%>
  url: (context) => context.adapterSettings.WS_API_ENDPOINT,
<% if (includeComments) { -%>
  // 'handler' contains two helpful methods. one of them is `message`. This method is called when there is a new websocket message.
  // The other one is 'open' method. It is called when the websocket connection is successfully opened. Use this method to execute some logic
  // when the connection is established (custom authentication, logging, ...)
<% } -%>
  handlers: {
<% if (includeComments) { -%>
    // 'message' handler receives a raw websocket message as first argument and adapter context as second and should return an array of
    // response objects. Use this method to construct a list of response objects, and the framework will save them in cache and return to user
<% } -%>
    message(message) {
<% if (includeComments) { -%>
      // in cases when error or unknown message is received, use 'return' to skip the iteration.
<% } -%>
      if (message.success === false) {
        return
      }

<% if (includeComments) { -%>
    // Response objects, whether successful or errors (if not skipped), contain two properties, 'params' and 'response'. 'response' is what
    // will be stored in the cache and returned as adapter response and 'params' determines the identifier so that the next request with
    // same 'params' will immediately return the response from the cache
<% } -%>
      return [
        {
          params: { base: message.base, quote: message.quote },
          response: {
            result: message.price,
            data: {
             result: message.price
            },
            timestamps: {
              providerIndicatedTimeUnixMs: message.time,
            },
          },
        },
      ]
    },
  },
<% if (includeComments) { -%>
  // `builders` are builder methods, that will be used to prepare specific WS messages to be sent to Data Provider
<% } -%>
  builders: {
<% if (includeComments) { -%>
    // `subscribeMessage` accepts request parameters and should construct and return a payload that will be sent to Data Provider
    // Use this method to subscribe to live feeds
<% } -%>
    subscribeMessage: (params) => {
      return {
        type: 'subscribe',
        symbols: `${params.base}/${params.quote}`.toUpperCase()
      }
    },
<% if (includeComments) { -%>
    // `unsubscribeMessage` accepts request parameters and should construct and return a payload that will be sent to Data Provider
    // Use this method to unsubscribe from live feeds
<% } -%>
    unsubscribeMessage: (params) => {
      return {
        type: 'unsubscribe',
        symbols: `${params.base}/${params.quote}`.toUpperCase()
      }
    },
  },
})
