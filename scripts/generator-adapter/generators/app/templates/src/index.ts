import { expose, ServerInstance } from '@chainlink/external-adapter-framework'
import { Adapter } from '@chainlink/external-adapter-framework/adapter'
import { config } from './config'
import { <%= endpointNames %> } from './endpoint'

export const adapter = new Adapter({
  defaultEndpoint: <%= defaultEndpoint.normalizedEndpointName %>.name,
  name: '<%= adapterName.toUpperCase() %>',
  config,
  endpoints: [<%= endpointNames %>],
})

export const server = (): Promise<ServerInstance | undefined> => expose(adapter)
