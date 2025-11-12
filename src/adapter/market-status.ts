import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'
import { AdapterEndpointParams } from './types'
import { parseWeekendString } from '../validation/market-status'
import { AdapterInputError } from '../validation/error'

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
  weekend: {
    type: 'string',
    description:
      'DHH-DHH:TZ, 520-020:America/New_York means Fri 20:00 to Sun 20:00 Eastern Time Zone',
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
> extends AdapterEndpoint<T> {
  constructor(params: AdapterEndpointParams<T>) {
    params.customInputValidation = (req, _adapterSettings) => {
      const data = req.requestContext.data as Record<string, string>
      if (data['type'] === '24/5') {
        parseWeekendString(data['weekend'])
      }
      if (data['type'] === 'regular' && data['weekend']) {
        throw new AdapterInputError({
          statusCode: 400,
          message: '[Param: weekend] must be empty when [Param: type] is regular',
        })
      }
      return undefined
    }
    super(params)
  }
}
