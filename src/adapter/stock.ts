import { InputParametersDefinition } from '../validation/input-params'
import { TransportGenerics } from '../transports'
import { SingleNumberResultResponse } from '../util'
import { AdapterEndpoint } from './endpoint'

/**
 * Type for the base input parameter config that any [[StockEndpoint]] must extend
 */
export type StockEndpointInputParametersDefinition = InputParametersDefinition & {
  base: {
    aliases: readonly ['from', 'symbol', 'asset', 'coin', 'ticker', ...string[]]
    type: 'string'
    description: 'The stock ticker to query'
    required: boolean
  }
}

/**
 * Base input parameter config that any [[StockEndpoint]] must extend
 */
export const stockEndpointInputParametersDefinition = {
  base: {
    aliases: ['from', 'symbol', 'asset', 'coin', 'ticker'],
    type: 'string',
    description: 'The stock ticker to query',
    required: true,
  },
} as const satisfies StockEndpointInputParametersDefinition

/**
 * Helper type structure that contains the different types passed to the generic parameters of a StockEndpoint
 */
export type StockEndpointGenerics = TransportGenerics & {
  Parameters: StockEndpointInputParametersDefinition
  Response: SingleNumberResultResponse
}

/**
 * A StockEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (base).
 */
export class StockEndpoint<T extends StockEndpointGenerics> extends AdapterEndpoint<T> {}
