import { TransportGenerics } from '../transports'
import { AdapterLWBAError } from '../validation/error'
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

export const validateLwbaResponse = (bid?: number, mid?: number, ask?: number): string => {
  if (!mid || !bid || !ask) {
    return `Invariant violation. LWBA response must contain mid, bid and ask prices. Got: (mid: ${mid}, bid: ${bid}, ask: ${ask})`
  }
  if (mid < bid || mid > ask) {
    return `Invariant violation. Mid price must be between bid and ask prices. Got: (mid: ${mid}, bid: ${bid}, ask: ${ask})`
  }
  return ''
}

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

    // All LWBA requests must have a mid, bid, and ask
    // Response validation ensures that we meet the invariant: bid <= mid <= ask
    params.customOutputValidation = (output) => {
      const data = output.data as LwbaResponseDataFields['Data']
      const error = validateLwbaResponse(data.bid, data.mid, data.ask)

      if (error) {
        throw new AdapterLWBAError({ statusCode: 500, message: error })
      }

      return undefined
    }
    super(params)
  }
}
