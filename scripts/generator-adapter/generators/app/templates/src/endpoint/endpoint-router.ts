import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { InputParameters } from '@chainlink/external-adapter-framework/validation'
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'
import { TransportRoutes } from '@chainlink/external-adapter-framework/transports'
import { config } from '../config'
import overrides from '../config/overrides.json'
<% for(let i=0; i<transports.length; i++) {%>
import { <%= transports[i].name %> } from '../transport/<%= endpointName %>-<%= transports[i].type %>' <% }
%>

<%- include ./base.ts %>

export const endpoint = new AdapterEndpoint({
  name: '<%= endpointName %>',
  aliases: <%- endpointAliases %>,
  transportRoutes: new TransportRoutes<BaseEndpointTypes>()
<% for(let i=0; i<transports.length; i++) {%>
  .register('<%- transports[i].type === "http" ? `rest` : transports[i].type %>', <%- transports[i].name %>)<%}%>,
  inputParameters,
  overrides: overrides['<%= adapterName %>']
})
