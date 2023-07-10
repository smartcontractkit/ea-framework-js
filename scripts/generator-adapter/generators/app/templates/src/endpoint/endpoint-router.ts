import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { InputParameters } from '@chainlink/external-adapter-framework/validation'
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'
import { TransportRoutes } from '@chainlink/external-adapter-framework/transports'
import { config } from '../config'
import overrides from '../config/overrides.json'
<% for(let i=0; i<inputTransports.length; i++) {%>
import { <%= inputTransports[i].name %> } from '../transport/<%= inputEndpointName %>-<%= inputTransports[i].type %>' <% }
%>

<%- include ./base.ts %>
<%/* [THIS WILL NOT BE RENDERED]. Indeed, below is a very unpleasant code, but the main purpose of it is to have everything nicely formatted, otherwise EJS puts unwanted new-lines for every 'if' placeholder */%>
export const endpoint = new AdapterEndpoint({
<% if (includeComments) { -%>
  // Endpoint name
<% } -%><%= ' ' %> name: '<%= inputEndpointName %>',
<% if (includeComments) { -%>
  // Alternative endpoint names for this endpoint
<% } -%><%= ' ' %> aliases: <%- endpointAliases.length ? JSON.stringify(endpointAliases) : JSON.stringify([]) -%>,
<% if (includeComments) { -%>
  // Transport handles incoming requests, data processing and communication for this endpoint.
  // In case endpoint supports multiple transports (i.e. http and websocket) TransportRoutes is used to register all supported transports.
  // To use specific transport, provide `transport: [transportName]` in the request
<% } -%><%= ' ' %> transportRoutes: new TransportRoutes<BaseEndpointTypes>()
<% for(let i=0; i<inputTransports.length; i++) {-%>
  .register('<%- inputTransports[i].type === "http" ? `rest` : inputTransports[i].type %>', <%- inputTransports[i].name %>)<%}%>,
<% if (includeComments) { -%>
  // Supported input parameters for this endpoint
<% } -%><%= ' ' %> inputParameters,
<% if (includeComments) { -%>
  // Overrides are defined in the `/config/overrides.json` file. They allow input parameters to be overriden from a generic symbol to something more specific for the data provider such as an ID.
<% } -%><%= ' ' %> overrides: overrides['<%= adapterName %>']
})
