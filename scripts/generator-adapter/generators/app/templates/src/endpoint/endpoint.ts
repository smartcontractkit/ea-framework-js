import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { InputParameters } from '@chainlink/external-adapter-framework/validation'
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'
import { config } from '../config'
import overrides from '../config/overrides.json'
import { <%= transports[0].name %> } from '../transport/<%= endpointName %>'

<%- include ./base.ts %>

export const endpoint = new AdapterEndpoint({
  name: '<%= endpointName %>',
  aliases: <%- endpointAliases %>,
  transport: <%= transports[0].name %>,
  inputParameters,
  overrides: overrides['<%= adapterName %>']
})
