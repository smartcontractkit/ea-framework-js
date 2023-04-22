import { AxiosRequestConfig } from 'axios'
import EventSource from 'eventsource'
import { EndpointContext } from '../adapter'
import { calculateHttpRequestKey } from '../cache'
import { makeLogger, sleep } from '../util'
import { Requester } from '../util/requester'
import { PartialSuccessfulResponse, ProviderResult, TimestampedProviderResult } from '../util/types'
import { TypeFromDefinition } from '../validation/input-params'
import { TransportDependencies, TransportGenerics } from './'
import { StreamingTransport, SubscriptionDeltas } from './abstract/streaming'

const logger = makeLogger('SSETransport')

export interface SSEConfig {
  url: string
  eventSourceInitDict?: EventSource.EventSourceInitDict
}

/**
 * Helper struct type that will be used to pass types to the generic parameters of a Transport.
 * Extends the common TransportGenerics, adding Provider specific types for this SSE endpoint.
 */
type SSETransportGenerics = TransportGenerics & {
  /**
   * Type details for any provider specific interfaces.
   */
  Provider: {
    /**
     * Structure of the body of the request that will be sent to the data provider.
     */
    RequestBody: unknown
  }
}

/**
 * Transport implementation that establishes a long lived connection to a server using the SSE protocol and subcribes to updates.
 *
 * @typeParam T - Helper struct type that will be used to pass types to the generic parameters (check [[SSETransportGenerics]])
 */
export class SseTransport<T extends SSETransportGenerics> extends StreamingTransport<T> {
  EventSource: typeof EventSource = EventSource
  eventListeners!: {
    type: string
    parseResponse: (evt: MessageEvent) => ProviderResult<T>
  }[]
  sseConnection?: EventSource
  timeOfLastReq = 0
  requester!: Requester

  constructor(
    private config: {
      prepareSSEConnectionConfig: (
        params: TypeFromDefinition<T['Parameters']>[],
        context: EndpointContext<T>,
      ) => SSEConfig
      prepareKeepAliveRequest?: (
        context: EndpointContext<T>,
      ) => AxiosRequestConfig<T['Provider']['RequestBody']>
      prepareSubscriptionRequest: (
        params: TypeFromDefinition<T['Parameters']>[],
        context: EndpointContext<T>,
      ) => AxiosRequestConfig<T['Provider']['RequestBody']>
      prepareUnsubscriptionRequest: (
        params: TypeFromDefinition<T['Parameters']>[],
        context: EndpointContext<T>,
      ) => AxiosRequestConfig<T['Provider']['RequestBody']>
      eventListeners: {
        type: string
        parseResponse: (evt: MessageEvent) => ProviderResult<T>[]
      }[]
      keepaliveSleepMs?: number
      pollingSleepMs?: number
    },
  ) {
    super()
  }

  getSubscriptionTtlFromConfig(adapterSettings: T['Settings']): number {
    return adapterSettings.SSE_SUBSCRIPTION_TTL
  }

  override async initialize(
    dependencies: TransportDependencies<T>,
    adapterSettings: T['Settings'],
    endpointName: string,
    transportName: string,
  ): Promise<void> {
    super.initialize(dependencies, adapterSettings, endpointName, transportName)
    this.requester = dependencies.requester
    if (dependencies.eventSource) {
      this.EventSource = dependencies.eventSource
    }
  }

  async streamHandler(
    context: EndpointContext<T>,
    subscriptions: SubscriptionDeltas<TypeFromDefinition<T['Parameters']>>,
  ): Promise<void> {
    if (
      (subscriptions.new.length || subscriptions.stale.length) &&
      (!this.sseConnection || this.sseConnection.readyState !== this.sseConnection.OPEN)
    ) {
      logger.debug('No established connection and new subscriptions available, connecting to SSE')
      const sseConfig = this.config.prepareSSEConnectionConfig(subscriptions.new, context)
      this.providerDataStreamEstablished = Date.now()
      this.sseConnection = new this.EventSource(sseConfig.url, sseConfig.eventSourceInitDict)

      const eventHandlerGenerator = (listener: (typeof this.config.eventListeners)[0]) => {
        return (e: MessageEvent) => {
          const providerDataReceived = Date.now()
          const results = listener.parseResponse(e).map((r) => {
            const partialResponse = r.response as PartialSuccessfulResponse<T['Response']>
            const result = r as TimestampedProviderResult<T>
            result.response.timestamps = {
              providerDataStreamEstablishedUnixMs: this.providerDataStreamEstablished,
              providerDataReceivedUnixMs: providerDataReceived,
              providerIndicatedTimeUnixMs: partialResponse.timestamps?.providerIndicatedTimeUnixMs,
            }
            return result
          })
          this.responseCache.write(this.name, results)
        }
      }

      this.config.eventListeners.forEach((listener) => {
        this.sseConnection?.addEventListener(listener.type, eventHandlerGenerator(listener))
      })
    }

    const makeRequest = async (
      key: string,
      req: AxiosRequestConfig<T['Provider']['RequestBody']>,
    ) => {
      await this.requester.request(key, req)
      this.timeOfLastReq = Date.now()
    }

    if (subscriptions.new.length) {
      const subscribeRequest = this.config.prepareSubscriptionRequest(subscriptions.new, context)
      makeRequest(
        calculateHttpRequestKey({
          context,
          transportName: this.name,
          data: subscriptions.new,
        }),
        subscribeRequest,
      )
    }
    if (subscriptions.stale.length) {
      const unsubscribeRequest = this.config.prepareUnsubscriptionRequest(
        subscriptions.stale,
        context,
      )
      makeRequest(
        calculateHttpRequestKey({
          context,
          transportName: this.name,
          data: subscriptions.stale,
        }),
        unsubscribeRequest,
      )
    }
    if (
      this.config.prepareKeepAliveRequest &&
      subscriptions.desired.length &&
      Date.now() - this.timeOfLastReq > context.adapterSettings.SSE_KEEPALIVE_SLEEP
    ) {
      const prepareKeepAliveRequest = this.config.prepareKeepAliveRequest(context)
      makeRequest(
        calculateHttpRequestKey({
          context,
          transportName: this.name,
          data: subscriptions.desired,
        }),
        prepareKeepAliveRequest,
      )
    }

    // The background execute loop no longer sleeps between executions, so we have to do it here
    logger.trace(
      `SSE handler complete, sleeping for ${context.adapterSettings.BACKGROUND_EXECUTE_MS_SSE}ms...`,
    )
    await sleep(context.adapterSettings.BACKGROUND_EXECUTE_MS_SSE)

    return
  }
}
