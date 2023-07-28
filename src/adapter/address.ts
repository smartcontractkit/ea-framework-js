import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'

export type PoRAddress = Record<string, unknown> & {
  network: string
  chainId: string
  address: string
}

export type PoRAddressResponse = {
  Result: null
  Data: {
    result: PoRAddress[]
  }
}

/**
 * Helper type structure that contains the Response type passed to the generic parameters of an AddressEndpoint
 */
export type AddressEndpointGenerics = TransportGenerics & {
  Response: PoRAddressResponse
}

/**
 * An AddressEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its response type must be `PoRAddressResponse`
 */
export class AddressEndpoint<T extends AddressEndpointGenerics> extends AdapterEndpoint<T> {}
