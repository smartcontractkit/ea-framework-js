import axios, { AxiosRequestConfig } from 'axios'
import EventSource from 'eventsource'
import { EndpointContext } from '../adapter'
import { AdapterConfig } from '../config'
import { makeLogger, sleep } from '../util'
import { PartialSuccessfulResponse, ProviderResult, TimestampedProviderResult } from '../util/types'
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

  constructor(
    private config: {
      prepareSSEConnectionConfig: (
        params: T['Request']['Params'][],
        context: EndpointContext<T>,
      ) => SSEConfig
      prepareKeepAliveRequest?: (
        context: EndpointContext<T>,
      ) => AxiosRequestConfig<T['Provider']['RequestBody']>
      prepareSubscriptionRequest: (
        params: T['Request']['Params'][],
        context: EndpointContext<T>,
      ) => AxiosRequestConfig<T['Provider']['RequestBody']>
      prepareUnsubscriptionRequest: (
        params: T['Request']['Params'][],
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

  getSubscriptionTtlFromConfig(config: AdapterConfig<T['CustomSettings']>): number {
    return config.SSE_SUBSCRIPTION_TTL
  }

  override async initialize(
    dependencies: TransportDependencies<T>,
    config: AdapterConfig<T['CustomSettings']>,
    endpointName: string,
  ): Promise<void> {
    super.initialize(dependencies, config, endpointName)
    if (dependencies.eventSource) {
      this.EventSource = dependencies.eventSource
    }
  }

  async streamHandler(
    context: EndpointContext<T>,
    subscriptions: SubscriptionDeltas<T['Request']['Params']>,
  ): Promise<void> {
    if (
      (subscriptions.new.length || subscriptions.stale.length) &&
      (!this.sseConnection || this.sseConnection.readyState !== this.sseConnection.OPEN)
    ) {
      logger.debug('No established connection and new subscriptions available, connecting to SSE')
      const sseConfig = this.config.prepareSSEConnectionConfig(subscriptions.new, context)
      this.providerDataStreamEstablished = Date.now()
      this.sseConnection = new this.EventSource(sseConfig.url, sseConfig.eventSourceInitDict)

      const eventHandlerGenerator = (listener: typeof this.config.eventListeners[0]) => {
        return (e: MessageEvent) => {
          const providerDataReceived = Date.now()
          const results = listener.parseResponse(e).map((r) => {
            const partialResponse = r.response as PartialSuccessfulResponse<T['Response']>
            const result = r as TimestampedProviderResult<T>
            result.response.timestamps = {
              providerDataStreamEstablished: this.providerDataStreamEstablished,
              providerDataReceived,
              providerIndicatedTime: partialResponse.timestamps?.providerIndicatedTime,
            }
            return result
          })
          this.responseCache.write(results)
        }
      }

      this.config.eventListeners.forEach((listener) => {
        this.sseConnection?.addEventListener(listener.type, eventHandlerGenerator(listener))
      })
    }

    const makeRequest = async (req: AxiosRequestConfig<T['Provider']['RequestBody']>) => {
      try {
        const res = await axios.request(req)
        logger.debug(res.data, `response status ${res.statusText} from keepalive request`)
      } catch (err) {
        logger.error(err, `Error on keepalive request`)
      }
      this.timeOfLastReq = Date.now()
    }

    if (subscriptions.new.length) {
      const subscribeRequest = this.config.prepareSubscriptionRequest(subscriptions.new, context)
      makeRequest(subscribeRequest)
    }
    if (subscriptions.stale.length) {
      const unsubscribeRequest = this.config.prepareUnsubscriptionRequest(
        subscriptions.stale,
        context,
      )
      makeRequest(unsubscribeRequest)
    }
    if (
      this.config.prepareKeepAliveRequest &&
      subscriptions.desired.length &&
      Date.now() - this.timeOfLastReq > context.adapterConfig.SSE_KEEPALIVE_SLEEP
    ) {
      const prepareKeepAliveRequest = this.config.prepareKeepAliveRequest(context)
      makeRequest(prepareKeepAliveRequest)
    }

    // The background execute loop no longer sleeps between executions, so we have to do it here
    logger.trace(
      `SSE handler complete, sleeping for ${context.adapterConfig.BACKGROUND_EXECUTE_MS_WS}ms...`,
    )
    await sleep(context.adapterConfig.BACKGROUND_EXECUTE_MS_SSE)

    return
  }
}
