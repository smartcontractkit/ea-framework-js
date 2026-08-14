import { AdapterEndpoint } from './endpoint'
import { AdapterEndpointParams, EndpointGenerics } from './types'
import { SingleNumberResultResponse, TimestampedProviderResult } from '../util'

export type NumericResultEndpointGenerics = EndpointGenerics & {
  Response: SingleNumberResultResponse
}

/**
 * A NumericResultEndpoint is an endpoint that validates the numeric result before it is written
 * to the response cache. It is meant for single-number endpoints where a null, undefined, NaN,
 * or non-finite result from the provider should surface as a 502 error, enabling the Chainlink Node
 * to fall back to the bridge cache (last known good value).
 */
export class NumericResultEndpoint<
  T extends NumericResultEndpointGenerics,
> extends AdapterEndpoint<T> {
  acceptZeroValue: boolean

  constructor(params: AdapterEndpointParams<T> & { acceptZeroValue?: boolean }) {
    super(params)
    this.acceptZeroValue = params.acceptZeroValue ?? true
  }

  protected override resultValidator(
    result: TimestampedProviderResult<T>,
  ): TimestampedProviderResult<T> {
    if ('errorMessage' in result.response) {
      return result
    }

    const { result: value } = result.response
    if (!Number.isFinite(value) || (!this.acceptZeroValue && value === 0)) {
      return {
        params: result.params,
        response: {
          statusCode: 502,
          errorMessage: `Invalid numeric result: ${value}`,
          timestamps: result.response.timestamps,
        },
      }
    }

    return result
  }
}
