import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'
import { AdapterEndpointParams, PriceEndpointInputParametersDefinition } from './index'

/**
 * Type for the base input parameter config that any [[LwbaEndpoint]] must extend
 */
export type LwbaEndpointInputParametersDefinition = PriceEndpointInputParametersDefinition

/**
 * Base input parameter config that any [[LwbaEndpoint]] must extend
 */
export const lwbaEndpointInputParametersDefinition = {
  base: {
    aliases: ['from', 'coin'],
    type: 'string',
    description: 'The symbol of symbols of the currency to query',
    required: true,
  },
  quote: {
    aliases: ['to', 'market'],
    type: 'string',
    description: 'The symbol of the currency to convert to',
    required: true,
  },
} as const satisfies LwbaEndpointInputParametersDefinition

export type LwbaResponseDataFields = {
  Result: null
  Data: {
    mid: number
    bid: number
    ask: number
  }
}

/**
 * Helper type structure that contains the different types passed to the generic parameters of a PriceEndpoint
 */
export type LwbaEndpointGenerics = TransportGenerics & {
  Parameters: LwbaEndpointInputParametersDefinition
  Response: LwbaResponseDataFields
}

export const DEFAULT_LWBA_ALIASES = ['crypto-lwba', 'crypto_lwba', 'cryptolwba']

/**
 * An LwbaEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * LWBA (lightweight bid/ask) Data Feeds, its InputParameters must extend the basic ones (base/quote).
 */
export class LwbaEndpoint<T extends LwbaEndpointGenerics> extends AdapterEndpoint<T> {
  constructor(params: AdapterEndpointParams<T>) {
    if (!params.aliases) {
      params.aliases = []
    }
    for (const alias of DEFAULT_LWBA_ALIASES) {
      if (params.name !== alias && !params.aliases.includes(alias)) {
        params.aliases.push(alias)
      }
    }

    super(params)
  }
}

