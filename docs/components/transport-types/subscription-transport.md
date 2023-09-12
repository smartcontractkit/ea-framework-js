# Subscription Transport

The `SubscriptionTransport` is an **abstract transport** (class) that serves as the foundation for implementing subscription-based transports. It handles incoming requests, adds them to a subscription set, and provides those entries to a background handler method. This class is intended to be extended by specific transport implementations. 

All incoming requests to the adapter for an endpoint that uses subscription-based transport are stored in a cached set (`SubscriptionSet`).
Periodically, the background execute loop of the adapter will read the entire subscription set and call the `backgroundHandler` method of the transport.

`SubscriptionTransport` has two abstract methods that should be implemented by subclasses. 
1. `backgroundHandler` is called on each background execution iteration. It receives endpoint context as first argument and an array of all the entries in the subscription set as second argument. Sub-transport logic should be defined in this method.
2. `getSubscriptionTtlFromConfig` receives adapter settings and should return time-to-live (TTL) value for subscription set.


## Example implementation of SubscriptionTransport

```typescript
// `AddressTransport` is a custom subscription-based transport that extends `SubscriptionTransport`
// It uses `ethers` library to fetch data from a contract
export class AddressTransport extends SubscriptionTransport<AddressTransportTypes> {
  // JsonRpcProvider provider instance to be used for contract calls in this example
  provider!: ethers.providers.JsonRpcProvider

  // Initialize the transport with necessary dependencies, adapter settings, endpoint name, and a transport name. 
  // You can initialize additional properties here as well, like in this case `this.provider`
  async initialize(
    dependencies: TransportDependencies<AddressTransportTypes>,
    adapterSettings: AddressTransportTypes['Settings'],
    endpointName: string,
    transportName: string,
  ): Promise<void> {
    // when initializing additional properties don't forget to call super.initialize()
    await super.initialize(dependencies, adapterSettings, endpointName, transportName)
  
    this.provider = new ethers.providers.JsonRpcProvider(
      adapterSettings.RPC_URL,
      adapterSettings.CHAIN_ID,
    )
  }

  // backgroundHandler receives endpoint context and entries in subscription set and should implement the transport logic
  async backgroundHandler(
    context: EndpointContext<AddressTransportTypes>,
    entries: RequestParams[],
  ) {
    // Processes each entry in subscription set
    await Promise.all(entries.map(async (param) => this.handleRequest(param)))
    // Sleeps for BACKGROUND_EXECUTE_MS miliseconds after processing all entries in subscription set
    await sleep(context.adapterSettings.BACKGROUND_EXECUTE_MS)
  }

  // helper method that takes params in subscription set, cocnstructs and saves a response object into a cache. 
  private async handleRequest(param: RequestParams) {
    let response: AdapterResponse<BaseEndpointTypes['Response']>
    try {
      response = await this._handleRequest(param)
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred'
      response = {
        statusCode: 502,
        errorMessage,
        timestamps: {
          providerDataRequestedUnixMs: 0,
          providerDataReceivedUnixMs: 0,
          providerIndicatedTimeUnixMs: undefined,
        },
      }
    }
    // save response to cache
    await this.responseCache.write(this.name, [{ params: param, response }])
  }

  // helper method that gets the data from a contract and returns as AdapterResponse object
  private async _handleRequest(
    param: RequestParams,
  ): Promise<AdapterResponse<AddressTransportTypes['Response']>> {
    const {  contractAddress } = param
    const contract = new ethers.Contract(contractAddress, ABI, this.provider)

    const providerDataRequestedUnixMs = Date.now()
    const addressList = await contract.getAddressList()

    return {
      data: {
        result: addressList,
      },
      statusCode: 200,
      result: null,
      timestamps: {
        providerDataRequestedUnixMs,
        providerDataReceivedUnixMs: Date.now(),
        providerIndicatedTimeUnixMs: undefined,
      },
    }
  }

  // getSubscriptionTtlFromConfig method should return TTL number for subscription sets in this transport
  getSubscriptionTtlFromConfig(adapterSettings: BaseEndpointTypes['Settings']): number {
    return adapterSettings.WARMUP_SUBSCRIPTION_TTL
  }
}
```


Another example of `SubscriptionTransport` is built-in [HTTP Transport](./http-transport.md).

