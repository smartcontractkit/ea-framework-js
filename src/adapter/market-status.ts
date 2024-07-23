import { TransportGenerics } from '../transports'
import { InputParametersDefinition } from '../validation/input-params'
import { AdapterEndpoint } from './endpoint'

/**
 * Type for the base input parameter config that any [[MarketStatusEndpoint]] must extend
 */
export type MarketStatusEndpointInputParametersDefinition = InputParametersDefinition & {
  market: {
    aliases: readonly [],
    type: 'string',
    description: 'The name of the market',
    required: boolean,
  },
}

/**
 * Base input parameter config that any [[MarketStatusEndpoint]] must extend
 */
export const marketStatusEndpointInputParametersDefinition = {
  market: {
    aliases: [],
    type: 'string',
    description: 'The name of the market',
    required: true,
  },
} as const satisfies MarketStatusEndpointInputParametersDefinition

export enum MarketStatus {
  UNKNOWN = 0,
  CLOSED = 1,
  OPEN = 2,
}

export type MarketStatusResultResponse = {
  Result: MarketStatus
  Data: {
    result: MarketStatus
  }
}

/**
 * Helper type structure that contains the different types passed to the generic parameters of a PriceEndpoint
 */
export type MarketStatusEndpointGenerics = TransportGenerics & {
  Parameters: MarketStatusEndpointInputParametersDefinition
  Response: MarketStatusResultResponse
}

/**
 * A MarketStatusEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (base).
 */
export class MarketStatusEndpoint<T extends MarketStatusEndpointGenerics> extends AdapterEndpoint<T> {}
