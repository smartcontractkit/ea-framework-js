import { expose, ServerInstance } from '@chainlink/external-adapter-framework'
import { Adapter } from '@chainlink/external-adapter-framework/adapter'
import { config } from './config'
import { <%= endpointNames %> } from './endpoint'

export const adapter = new Adapter({
<% if (includeComments) { -%>
  //Requests will direct to this endpoint if the `endpoint` input parameter is not specified.
<% } -%><%= ' ' %> defaultEndpoint: <%= defaultEndpoint.normalizedEndpointName %>.name,
<% if (includeComments) { -%>
  // Adapter name
<% } -%><%= ' ' %> name: '<%= adapterName.toUpperCase() %>',
<% if (includeComments) { -%>
  // Adapter configuration (environment variables)
<% } -%><%= ' ' %> config,
<% if (includeComments) { -%>
  // List of supported endpoints
<% } -%><%= ' ' %> endpoints: [<%= endpointNames %>],
})

export const server = (): Promise<ServerInstance | undefined> => expose(adapter)
