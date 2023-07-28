import { Transport, TransportDependencies, TransportGenerics } from './'
import { Requester } from '../util/requester'
import { ResponseCache } from '../cache/response'
import { AdapterRequest, AdapterResponse } from '../util'
import { InputParameters, InputParametersDefinition, TypeFromDefinition } from '../validation/input-params'
import { AxiosRequestConfig, AxiosResponse } from 'axios'
import {
  Balance,
  BalanceResponse,
} from '../adapter/balance'
import { calculateHttpRequestKey } from '../cache'

export type BalanceTransportInputParametersDefinition = InputParametersDefinition & {
  addresses: {
    aliases: readonly ['result', ...string[]]
    required: boolean
    array: boolean
    description: 'An array of addresses to get the balances of (as an object with string `address` as an attribute)'
    type: {
      address: {
        type: 'string'
        description: 'an address to get the balance of'
        required: boolean
      }
      coin: {
        type: 'string'
        description: 'currency to query'
        required: boolean
        default: string
      }
      chain: {
        type: 'string'
        description: 'chain to query'
        required: boolean
        default: string
      }
    }
  },
  confirmations: {
    required: boolean
    description: 'The number of confirmations to query data from',
    default: number,
    type: 'number',
  }
}

export const balanceTransportInputParametersDefinition = {
  addresses: {
    aliases: ['result'],
    array: true,
    type: {
      address: {
        type: 'string',
        description: 'an address to get the balance of',
        required: true
      },
      coin: {
        required: false,
        type: 'string',
        description: 'currency to query',
        default: 'btc'
      },
      chain: {
        required: false,
        type: 'string',
        description: 'chain to query',
        default: 'mainnet',
      }
    },
    description: 'An array of addresses to get the balances of (as an object with string `address` as an attribute)',
    required: true,
  },
  confirmations: {
    required: false,
    type: 'number',
    description: 'The number of confirmations to query data from',
    default: 6,
  }
} as const satisfies BalanceTransportInputParametersDefinition

export type BalanceTransportGenerics = TransportGenerics & {
  /**
   * Type details about incoming Adapter requests to this Transport
   */
  Parameters: BalanceTransportInputParametersDefinition
  /**
   * Type details about outbound responses from this Transport
   */
  Response: BalanceResponse
  /**
   * Type details for any provider specific interfaces.
   */
  Provider: {
    /**
     * Structure of the body of the request that will be sent to the data provider.
     */
    RequestBody: unknown

    /**
     * Structure for the body of the response coming from the data provider.
     */
    ResponseBody: unknown
  }
}

export interface BalanceAddress  {
  chain: string
  address: string
  coin: string
}

/**
 * Config object that is provided to the BalanceTransport constructor.
 */
export interface BalanceTransportConfig<T extends BalanceTransportGenerics> {
  /**
   * This method is called for every address in 'addresses' input data.
   * It takes [BalanceAddress], confirmations and adapter settings
   * and should return single [[BalanceRequestConfig]]
   * @param address - address object of type [BalanceAddress]
   * @param confirmations - number of confirmations to get the balance
   * @param adapterSettings - the config for this Adapter
   * @returns [BalanceRequestConfig]
   */
  getBalance: (
    balanceAddress: BalanceAddress,
    confirmations: number,
    adapterSettings: T['Settings'],
  ) =>  BalanceRequestConfig<T>
}


/**
 * Structure containing the association between input address and a provider request.
 */
export interface BalanceRequestConfig<T extends BalanceTransportGenerics>  {
  /** The request that will be sent to the data provider to fetch the balance of an address */
  request: AxiosRequestConfig<T['Provider']['RequestBody']>,
  /** Function that will be called when request for an address is executed. It receives the response from the data provider
   * and adapter settings and should return [Balance] object*/
  onResponse: (res:  AxiosResponse<T['Provider']['ResponseBody']>, adapterSettings: T['Settings'],) => Balance
}

interface InputData {
  addresses: BalanceAddress[]
  confirmations: number
}

/**
 * Transport implementation that is meant to be used with [[BalanceEndpoint]]. It takes incoming request that
 * contains 'addresses' array as input data. Then each address object from that array is passed through `getBalance`
 * function, that returns AxiosRequestConfig and `onResponse` function. The Data Provider response is passed through the
 * `onResponse` function which should return [[Balance]] object. Once the balances of all addresses are fetched and processed,
 * the transport will cache it and return as EA response.
 * @typeParam T - all types related to the [[Transport]]
 */
export class BalanceTransport<T extends BalanceTransportGenerics> implements Transport<T> {
  name!: string
  requester!: Requester
  responseCache!: ResponseCache<T>

  constructor(private config: BalanceTransportConfig<T>) {
  }

  async initialize(
    dependencies: TransportDependencies<T>,
    _adapterSettings: T['Settings'],
    _endpointName: string,
    transportName: string,
  ): Promise<void> {
    this.responseCache = dependencies.responseCache
    this.requester = dependencies.requester
    this.name = transportName
  }

  async foregroundExecute(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    settings: T['Settings']
  ): Promise<AdapterResponse<T['Response']>> {
    const addresses: BalanceAddress[] = (req.requestContext.data as unknown as InputData).addresses
    const confirmations: number = (req.requestContext.data as unknown as InputData).confirmations

    const balanceConfigs = addresses.map(address => this.config.getBalance(address, confirmations, settings))

    const providerDataRequestedUnixMs = Date.now()
    const result: Balance[] = []

    const requestsPromise = balanceConfigs.map(balanceConfig => {
      return this.requester.request<T>(
        calculateHttpRequestKey({
          context: {
            adapterSettings: settings,
            inputParameters: new InputParameters<T["Parameters"]>(balanceTransportInputParametersDefinition),
            endpointName: req.requestContext.endpointName,
          },
          data: req.requestContext.data,
          transportName: this.name,
        }),
        balanceConfig.request,
      ).then(response => {
        const balance = balanceConfig.onResponse(response.response, settings);
        result.push(balance)
      })
    })

    await Promise.all(requestsPromise)

    const response = {
      data: {
        result,
      },
      result: null,
      statusCode: 200,
      timestamps: {
        providerDataRequestedUnixMs,
        providerDataReceivedUnixMs: Date.now(),
        providerIndicatedTimeUnixMs: undefined,
      },
    }
    await this.responseCache.write(this.name, [{ params: req.requestContext.data, response }])
    return response
  }

}