import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'

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
  type: {
    type: 'string',
    description: 'Type of the market status',
    options: ['regular', '245'],
    default: 'regular',
  },
} as const

export enum MarketStatus {
  UNKNOWN = 0,
  CLOSED = 1,
  OPEN = 2,
}

// 24/5
export enum TwoFourFiveMarketStatus {
  UNKNOWN = 0,
  PRE_MARKET = 11,
  REGULAR = 12,
  POST_MARKET = 13,
  OVERNIGHT = 14,
  WEEKEND = 15,
}

type AggregatedMarketStatus = MarketStatus | TwoFourFiveMarketStatus

export type MarketStatusResultResponse = {
  Result: AggregatedMarketStatus
  Data: {
    result: AggregatedMarketStatus
  }
}

/**
 * Helper type structure that contains the different types passed to the generic parameters of a PriceEndpoint
 */
export type MarketStatusEndpointGenerics = TransportGenerics & {
  Parameters: typeof marketStatusEndpointInputParametersDefinition
  Response: MarketStatusResultResponse
}

/**
 * A MarketStatusEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (base).
 */
export class MarketStatusEndpoint<
  T extends MarketStatusEndpointGenerics,
> extends AdapterEndpoint<T> {}
