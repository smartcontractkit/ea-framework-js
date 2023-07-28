import { InputParametersDefinition } from '../validation/input-params'
import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'

export type Balance = Record<string, unknown> & {
  balance: string
}

export type BalanceResponse = {
  Result: null
  Data: {
    result: Balance[]
  }
}

/**
 * Type for the base input parameter config that any [[BalanceEndpoint]] must extend
 */
export type BalanceEndpointInputParametersDefinition = InputParametersDefinition & {
  addresses: {
    aliases: readonly ['result', ...string[]]
    required: boolean
    array: boolean
    description: 'An array of addresses to get the balances of (as an object with string `address` as an attribute)'
    type: {
      address: {
        type: 'string'
        description: 'an address to get the balance of'
        required: true
      }
    }
  }
}

/**
 * Base input parameter config that any [[BalanceEndpoint]] must extend
 */
export const balanceEndpointInputParametersDefinition = {
  addresses: {
    aliases: ['result'],
    array: true,
    type: {
      address: {
        type: 'string',
        description: 'an address to get the balance of',
        required: true,
      },
    },
    description:
      'An array of addresses to get the balances of (as an object with string `address` as an attribute)',
    required: true,
  },
} as const satisfies BalanceEndpointInputParametersDefinition

/**
 * Helper type structure that contains the different types passed to the generic parameters of a BalanceEndpoint
 */
export type BalanceEndpointGenerics = TransportGenerics & {
  Parameters: BalanceEndpointInputParametersDefinition
  Response: BalanceResponse
}

/**
 * A BalanceEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (addresses) and the response type must be `BalanceResponse`.
 */
export class BalanceEndpoint<T extends BalanceEndpointGenerics> extends AdapterEndpoint<T> {}

/**
 * Helper type structure that contains the different types passed to the generic parameters of TotalBalanceEndpoint
 */
export type TotalBalanceEndpointGenerics = BalanceEndpointGenerics & {
  Response: {
    Result: string
    Data: {
      result: string
    }
  }
}

/**
 * A TotalBalanceEndpoint is a specific type of BalanceEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (addresses) and the response type must be numeric string.
 */
export class TotalBalanceEndpoint<
  T extends TotalBalanceEndpointGenerics,
> extends BalanceEndpoint<T> {}
