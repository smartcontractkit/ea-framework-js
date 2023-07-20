import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { InputParameters } from '@chainlink/external-adapter-framework/validation'
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'
import { config } from '../config'
import overrides from '../config/overrides.json'
import { <%= inputTransports[0].name %> } from '../transport/<%= inputEndpointName %>'

<%- include ./base.ts %>

export const endpoint = new AdapterEndpoint({
<% if (includeComments) { -%>
  // Endpoint name
<% } -%><%= ' ' %> name: '<%= inputEndpointName %>',
<% if (includeComments) { -%>
  // Alternative endpoint names for this endpoint
<% } -%><%= ' ' %> aliases: <%- endpointAliases.length ? JSON.stringify(endpointAliases) : JSON.stringify([]) -%>,
<% if (includeComments) { -%>
  // Transport handles incoming requests, data processing and communication for this endpoint
<% } -%><%= ' ' %> transport: <%= inputTransports[0].name %>,
<% if (includeComments) { -%>
  // Supported input parameters for this endpoint
<% } -%><%= ' ' %> inputParameters,
<% if (includeComments) { -%>
  // Overrides are defined in the `/config/overrides.json` file. They allow input parameters to be overriden from a generic symbol to something more specific for the data provider such as an ID.
<% } -%><%= ' ' %> overrides: overrides['<%= adapterName %>']
})
