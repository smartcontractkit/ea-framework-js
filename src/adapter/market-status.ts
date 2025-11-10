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
    options: ['regular', '24/5'],
    default: 'regular',
  },
} as const

export enum MarketStatus {
  UNKNOWN = 0,
  CLOSED = 1,
  OPEN = 2,
}

export enum TwentyfourFiveMarketStatus {
  UNKNOWN = 0,
  PRE_MARKET = 1,
  REGULAR = 2,
  POST_MARKET = 3,
  OVERNIGHT = 4,
  WEEKEND = 5,
}

type AggregatedMarketStatus = MarketStatus | TwentyfourFiveMarketStatus

export type MarketStatusResultResponse = {
  Result: AggregatedMarketStatus
  Data: {
    result: AggregatedMarketStatus
    statusString: string
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
