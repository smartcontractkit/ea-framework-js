<% if (includeComments) { %>// Input parameters define the structure of the request expected by the endpoint.<% } %>
export const inputParameters = new InputParameters({
  base: {
    aliases: ['from', 'coin', 'symbol', 'market'],
    required: true,
    type: 'string',
    description: 'The symbol of symbols of the currency to query',
  },
  quote: {
    aliases: ['to', 'convert'],
    required: true,
    type: 'string',
    description: 'The symbol of the currency to convert to',
  },
})
<% if (includeComments) { %>// Endpoints contain a type parameter that allows specifying relevant types of an endpoint, for example, request payload type, Adapter response type and Adapter configuration (environment variables) type<% } %>
export type BaseEndpointTypes = {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: typeof config.settings
}