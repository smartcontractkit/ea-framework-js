import WebSocket, { ClientOptions, RawData } from 'ws'
import { EndpointContext } from '../adapter'
import { metrics } from '../metrics'
import { censorLogs, deferredPromise, makeLogger, sleep, timeoutPromise } from '../util'
import { PartialSuccessfulResponse, ProviderResult, TimestampedProviderResult } from '../util/types'
import { TypeFromDefinition } from '../validation/input-params'
import { TransportGenerics } from './'
import { StreamingTransport, SubscriptionDeltas } from './abstract/streaming'
import {
  connectionErrorLabels,
  recordWsMessageSentMetrics,
  recordWsMessageSubMetrics,
} from './metrics'

// Aliasing type for use at adapter level
export { WebSocket, RawData as WebSocketRawData }

const logger = makeLogger('WebSocketTransport')

type WebSocketClass = new (
  url: string,
  protocols?: string | string[] | undefined,
  options?: ClientOptions,
) => WebSocket

export class WebSocketClassProvider {
  static ctor: WebSocketClass = WebSocket

  static set(ctor: WebSocketClass): void {
    this.ctor = ctor
  }

  static get(): WebSocketClass {
    return this.ctor
  }
}

/**
 * Object used to pass partial websocket transport state into url config function.
 */
export interface WebSocketUrlConfigFunctionParameters {
  /** Number of times streamHandler was called without a responsive connection */
  streamHandlerInvocationsWithNoConnection: number
}

/**
 * Config object that is provided to the WebSocketTransport constructor.
 */
export interface WebSocketTransportConfig<T extends WebsocketTransportGenerics> {
  /** Endpoint to which to open the WS connection*/
  url: (
    context: EndpointContext<T>,
    desiredSubs: TypeFromDefinition<T['Parameters']>[],
    urlConfigFunctionParameters: WebSocketUrlConfigFunctionParameters,
  ) => Promise<string> | string

  /** Optional parameters used when establishing the WebSocket connection */
  options?: (
    context: EndpointContext<T>,
    desiredSubs: TypeFromDefinition<T['Parameters']>[],
  ) => Promise<ClientOptions> | ClientOptions

  /** Map of handlers for different WS lifecycle events */
  handlers: {
    /**
     * Handles when the WS is successfully opened.
     * Optional since logic is not always needed on connection.
     * Note: any listeners set in this method will be cleared after its execution.
     *
     * @param wsConnection - the WebSocket with an established connection
     * @param context - the background context for the Adapter
     * @returns an empty Promise, or void
     */
    open?: (wsConnection: WebSocket, context: EndpointContext<T>) => Promise<void> | void

    /**
     * Handles when client is ready to send a heartbeat to server
     *
     * @param wsConnection - the WebSocket with an established connection
     * @param context - the background context for the Adapter
     * @returns an empty Promise, or void
     */
    heartbeat?: (wsConnection: WebSocket, context: EndpointContext<T>) => Promise<void> | void

    /**
     * Handles when the websocket connection dispatches an error event
     * Optional to let the adapter handle the event in its own way if it decides to
     *
     * @param errorEvent - the WebSocket error event
     * @param context - the background context for the Adapter
     * @returns void
     */
    error?: (errorEvent: WebSocket.ErrorEvent, context: EndpointContext<T>) => void

    /**
     * Handles when the websocket connection dispatches a close event
     * Optional to let the adapter handle the event in its own way if it decides to
     *
     * @param closeEvent - the WebSocket close event
     * @param context - the background context for the Adapter
     * @returns void
     */
    close?: (closeEvent: WebSocket.CloseEvent, context: EndpointContext<T>) => void

    /**
     * Handles when the WS receives a message
     *
     * @param message - the message received by the WS
     * @param context - the background context for the Adapter
     * @returns a list of cache entries of adapter responses to set in the cache
     */
    message: (
      message: T['Provider']['WsMessage'],
      context: EndpointContext<T>,
    ) => ProviderResult<T>[] | undefined
  }

  /** Map of "builders", functions that will be used to prepare specific WS messages */
  builders?: {
    /**
     * Builds a WS message that will be sent to subscribe to a specific feed
     *
     * @param params - the body of the adapter request
     * @param context - the background context for the Adapter
     * @returns the WS message (can be any type as long as the [[WebSocket]] doesn't complain)
     */
    subscribeMessage?: (
      params: TypeFromDefinition<T['Parameters']>,
      context: EndpointContext<T>,
    ) => unknown

    /**
     * Builds a WS message that will be sent to unsubscribe to a specific feed
     *
     * @param params - the body of the adapter request
     * @param context - the background context for the Adapter
     * @returns the WS message (can be any type as long as the [[WebSocket]] doesn't complain)
     */
    unsubscribeMessage?: (
      params: TypeFromDefinition<T['Parameters']>,
      context: EndpointContext<T>,
    ) => unknown
  }
}

/**
 * Helper struct type that will be used to pass types to the generic parameters of a Transport.
 * Extends the common TransportGenerics, adding Provider specific types for this WS endpoint.
 */
export type WebsocketTransportGenerics = TransportGenerics & {
  /**
   * Type details for any provider specific interfaces.
   */
  Provider: {
    /**
     * Structure of any message that will come through the websocket connection.
     */
    WsMessage: unknown
  }
}

/**
 * Transport implementation that takes incoming requests, adds them to an [[subscriptionSet]] and,
 * through a WebSocket connection, subscribes to the relevant feeds to populate the cache.
 *
 * @typeParam T - Helper struct type that will be used to pass types to the generic parameters (check [[WebsocketTransportGenerics]])
 */
export class WebSocketTransport<
  T extends WebsocketTransportGenerics,
> extends StreamingTransport<T> {
  wsConnection?: WebSocket
  currentUrl = ''
  lastMessageReceivedAt = 0
  connectionOpenedAt = 0
  streamHandlerInvocationsWithNoConnection = 0
  heartbeatInterval?: NodeJS.Timeout

  constructor(private config: WebSocketTransportConfig<T>) {
    super()
  }

  getSubscriptionTtlFromConfig(adapterSettings: T['Settings']): number {
    return adapterSettings.WS_SUBSCRIPTION_TTL
  }

  connectionClosed(): boolean {
    return !this.wsConnection || this.wsConnection.readyState === WebSocket.CLOSED
  }

  serializeMessage(payload: unknown): string {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  }
  deserializeMessage(data: WebSocket.Data): T['Provider']['WsMessage'] {
    return JSON.parse(data.toString()) as T['Provider']['WsMessage']
  }

  startHeartbeat(context: EndpointContext<T>): void {
    if (this.config.handlers.heartbeat) {
      this.stopHeartbeat()

      const intervalId = setInterval(async () => {
        if (this.heartbeatInterval !== intervalId) {
          clearInterval(intervalId)
          return
        }

        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
          try {
            logger.debug('Calling heartbeat handler')
            await this.config.handlers.heartbeat?.(this.wsConnection, context)
          } catch (error) {
            logger.warn({ error }, 'Heartbeat handler failed, will be tried later.')
          }
        } else {
          this.stopHeartbeat()
        }
      }, context.adapterSettings.WS_HEARTBEAT_INTERVAL_MS)

      this.heartbeatInterval = intervalId
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
  }

  buildConnectionHandlers(
    context: EndpointContext<T>,
    connection: WebSocket,
    connectionReadyResolve: (value: WebSocket) => void,
  ) {
    return {
      // Called when the WS connection is opened
      open: async (event: WebSocket.Event) => {
        logger.debug(`Opened websocket connection. (event type ${event.type})`)
        if (this.config.handlers.open) {
          await this.config.handlers.open(connection, context)
          logger.debug('Successfully executed connection opened handler')
        }
        this.startHeartbeat(context)
        connectionReadyResolve(event.target)
      },

      // Called when any message is received by the open connection
      message: async (event: WebSocket.MessageEvent) => {
        const parsed = this.deserializeMessage(event.data)
        censorLogs(() => logger.trace(`Got ws message: ${event.data}`))
        const providerDataReceived = Date.now()
        const results = this.config.handlers.message(parsed, context)?.map((r) => {
          const result = r as TimestampedProviderResult<T>
          const partialResponse = r.response as PartialSuccessfulResponse<T['Response']>
          result.response.timestamps = {
            providerDataStreamEstablishedUnixMs: this.providerDataStreamEstablished,
            providerDataReceivedUnixMs: providerDataReceived,
            providerIndicatedTimeUnixMs: partialResponse.timestamps?.providerIndicatedTimeUnixMs,
          }
          return result
        })
        logger.trace(`Writing ${results?.length ?? 0} responses to cache`)
        if (Array.isArray(results) && results.length > 0) {
          // Updating the last message received time here, to only care about messages we use
          this.lastMessageReceivedAt = Date.now()
          await this.responseCache.write(this.name, results)
        }

        // Do this after writing so we get the values to the cache ASAP
        // We're not calculating feedId or subscription because this is only a single message,
        // and it could in theory contain more than one value to set to the cache
        metrics.get('wsMessageTotal').labels({ direction: 'received' }).inc()
      },

      // Called when an error is thrown by the connection
      error: async (event: WebSocket.ErrorEvent) => {
        censorLogs(() =>
          logger.warn(
            `Error occurred in web socket connection. Error: ${event.error} ; Message: ${event.message}`,
          ),
        )
        // Record connection error count
        metrics.get('wsConnectionErrors').labels(connectionErrorLabels(event.message)).inc()
        if (this.config.handlers.error) {
          this.config.handlers.error(event, context)
          logger.debug('Successfully executed connection error handler')
        }
      },

      // Called when the WS connection closes for any reason
      close: (event: WebSocket.CloseEvent) => {
        // If the connection closed with 1000, it's a usual closure
        const level = event.code === 1000 ? 'debug' : 'info'
        logger[level](
          `Closed websocket connection. Code: ${event.code} ; reason: ${event.reason?.toString()}`,
        )

        // Record active ws connections by decrementing count on close
        // Using URL in label since connection_key is removed from v3
        metrics.get('wsConnectionActive').dec()

        // Also, register that the connection was closed and the reason why.
        // We need to filter out query params from the URL to avoid having
        // the cardinality of the metric go out of control.
        const filteredUrl = this.currentUrl.split('?')[0]
        metrics.get('wsConnectionClosures').inc({
          code: event.code,
          url: filteredUrl,
        })
        if (this.config.handlers.close) {
          this.config.handlers.close(event, context)
          logger.debug('Successfully executed connection close handler')
        }
        this.stopHeartbeat()
      },
    }
  }

  async establishWsConnection(
    context: EndpointContext<T>,
    url: string,
    options?: WebSocket.ClientOptions | undefined,
  ): Promise<WebSocket> {
    const [promise, resolve, reject] = deferredPromise()
    const ctor = WebSocketClassProvider.get()
    const connection = new ctor(url, undefined, options)
    const handlers = this.buildConnectionHandlers(context, connection, resolve)
    connection.addEventListener('error', handlers.error)
    connection.addEventListener(
      'open',
      this.rejectionHandler<WebSocket.Event>(reject, handlers.open),
    )

    // Attempt to establish the connection
    metrics.get('wsConnectionAttempt').inc()
    try {
      await timeoutPromise(
        'WS Open Handler',
        promise,
        context.adapterSettings.WS_CONNECTION_OPEN_TIMEOUT,
      )

      // Record active ws connections by incrementing count on open
      metrics.get('wsConnectionActive').inc()
    } catch (e) {
      logger.error(`There was an error connecting to the provider websocket`)
      throw e
    }

    // Now that the connection is established, we can clean up listeners and set the proper ones
    connection.removeAllListeners()
    connection.addEventListener(
      'message',
      this.rejectionHandler<WebSocket.MessageEvent>(reject, handlers.message),
    )
    connection.addEventListener('error', handlers.error)
    connection.addEventListener('close', handlers.close)

    return connection
  }

  async sendMessages(context: EndpointContext<T>, subscribes: unknown[], unsubscribes: unknown[]) {
    const serializedSubscribes = subscribes.map(this.serializeMessage)
    const serializedUnsubscribes = unsubscribes.map(this.serializeMessage)

    const messages = serializedSubscribes.concat(serializedUnsubscribes)

    if (messages.length > 0) {
      logger.debug(`There are ${messages.length} messages to send`)
    }

    for (const message of messages) {
      this.wsConnection?.send(message)
    }
  }

  async streamHandler(
    context: EndpointContext<T>,
    subscriptions: SubscriptionDeltas<TypeFromDefinition<T['Parameters']>>,
  ): Promise<void> {
    // New subs && no connection -> connect -> add subs
    // No new subs && no connection -> skip
    // New subs && connection -> add subs
    // No new subs && connection -> unsubs only
    if (!subscriptions.new.length && !this.wsConnection) {
      logger.debug('No entries in subscription set and no established connection, skipping')
      await sleep(context.adapterSettings.BACKGROUND_EXECUTE_MS_WS)
      return
    }

    // We want to check that if we have a connection, it hasn't gone stale. That is,
    // since opening it, have we had any activity from the provider.
    const now = Date.now()
    const timeSinceLastMessage = Math.max(0, now - this.lastMessageReceivedAt)
    const timeSinceConnectionOpened = Math.max(0, now - this.connectionOpenedAt)
    const timeSinceLastActivity = Math.min(timeSinceLastMessage, timeSinceConnectionOpened)
    const connectionUnresponsive =
      timeSinceLastActivity > 0 &&
      timeSinceLastActivity > context.adapterSettings.WS_SUBSCRIPTION_UNRESPONSIVE_TTL

    let connectionClosed = this.connectionClosed()
    logger.trace(`WS conn staleness info: 
      now: ${now} |
      timeSinceLastMessage: ${timeSinceLastMessage} |
      timeSinceConnectionOpened: ${timeSinceConnectionOpened} |
      timeSinceLastActivity: ${timeSinceLastActivity} |
      subscriptionUnresponsiveTtl: ${context.adapterSettings.WS_SUBSCRIPTION_UNRESPONSIVE_TTL} |
      connectionUnresponsive: ${connectionUnresponsive} |
    `)

    // The var connectionUnresponsive checks whether the time since last activity on
    // _any_ successful open connection (or 0 if we haven't had one yet) has exceeded
    // WS_SUBSCRIPTION_UNRESPONSIVE_TTL. There is interplay with WS_SUBSCRIPTION_TTL
    // to determine minimum TTL of an open connection given no explicit connection errors.
    if (connectionUnresponsive) {
      this.streamHandlerInvocationsWithNoConnection += 1
      logger.info(
        `The connection is unresponsive (last message ${timeSinceLastMessage}ms ago), incremented failover counter to ${this.streamHandlerInvocationsWithNoConnection}`,
      )
      // Filter out query params from the URL to avoid leaking sensitive data
      // and prevent metric cardinality explosion
      const filteredUrl = this.currentUrl.split('?')[0]
      metrics
        .get('wsConnectionFailoverCount')
        .labels({ transport_name: this.name, url: filteredUrl })
        .set(this.streamHandlerInvocationsWithNoConnection)
    }

    // We want to check if the URL we calculate is different from the one currently connected.
    // This is because some providers handle subscriptions on the URLs and not through messages.
    // Subclasses may also implement alternate URL handling logic,
    // eg: toggling through multiple possible URLs in case of failure.
    const urlFromConfig = await this.config.url(context, subscriptions.desired, {
      streamHandlerInvocationsWithNoConnection: this.streamHandlerInvocationsWithNoConnection,
    })
    const urlChanged = this.currentUrl !== urlFromConfig

    // Check if we should close the current connection
    if (!connectionClosed && (urlChanged || connectionUnresponsive)) {
      if (urlChanged) {
        logger.info('Websocket URL has changed, closing connection to reconnect...')
        censorLogs(() =>
          logger.debug(`Websocket URL changed from ${this.currentUrl} to ${urlFromConfig}`),
        )
      } else {
        censorLogs(() =>
          logger.info(
            `Last message was received ${timeSinceLastMessage} ago, exceeding the threshold of ${context.adapterSettings.WS_SUBSCRIPTION_UNRESPONSIVE_TTL}ms, closing connection...`,
          ),
        )
      }

      // Check if connection was opened very recently; if so, wait a bit before continuing.
      // This is so if we just opened the connection and are waiting to receive some messages,
      // we don't close is immediately after and miss the chance to receive them
      if (timeSinceConnectionOpened < 1000) {
        logger.info(
          `Connection was opened only ${timeSinceConnectionOpened}ms ago, waiting for that to get to 1s before continuing...`,
        )
        await sleep(1000 - timeSinceConnectionOpened)
      }
      this.wsConnection?.close(1000)
      connectionClosed = true

      if (subscriptions.desired.length) {
        // Clear subscription metrics for all active subscriptions
        recordWsMessageSubMetrics(context, [], subscriptions.desired)
        censorLogs(() =>
          logger.trace(
            `Connection will be reopened and will subscribe to new and resubscribe to existing: ${JSON.stringify(
              subscriptions.desired,
            )}`,
          ),
        )
      }
    }

    // Check if we need to open a new connection
    if (connectionClosed && subscriptions.desired.length) {
      logger.debug('No established connection and new subscriptions available, connecting to WS')
      const options =
        this.config.options && (await this.config.options(context, subscriptions.desired))
      this.currentUrl = urlFromConfig
      // Need to write this now, otherwise there could be messages sent with values before the open handler finishes
      this.providerDataStreamEstablished = Date.now()

      // Local subscriptions array should be empty before the connection is opened
      this.localSubscriptions = []

      // If the connection was closed, the new subscriptions should be the desired ones
      subscriptions.new = subscriptions.desired

      // Connect to the provider
      this.wsConnection = await this.establishWsConnection(context, urlFromConfig, options)

      // Now that we successfully opened the connection, we can reset the variables
      connectionClosed = false
      this.connectionOpenedAt = Date.now()
    }

    // Send messages only if the connection is open
    // Otherwise we could encounter the case where we just closed the connection because there's no desired ones,
    // but without this check we'd attempt to send out all the unsubscribe messages
    if (!connectionClosed) {
      logger.debug('Connection is open, sending subs/unsubs if there are any')
      const builders = this.config.builders
      if (builders) {
        const { subscribeMessage, unsubscribeMessage } = builders
        await this.sendMessages(
          context,
          subscribeMessage
            ? subscriptions.new.map((sub) => subscribeMessage(sub, context))
            : subscriptions.new,
          unsubscribeMessage
            ? subscriptions.stale.map((sub) => unsubscribeMessage(sub, context))
            : subscriptions.stale,
        )
        recordWsMessageSentMetrics(context, subscriptions.new, subscriptions.stale)
      } else {
        logger.trace(
          "This ws transport has no builders configured, so we're not sending any messages",
        )
      }
    }

    // Record WS subscription metrics
    recordWsMessageSubMetrics(context, subscriptions.new, subscriptions.stale)

    // The background execute loop no longer sleeps between executions, so we have to do it here
    logger.trace(
      `Websocket handler complete, sleeping for ${context.adapterSettings.BACKGROUND_EXECUTE_MS_WS}ms...`,
    )
    await sleep(context.adapterSettings.BACKGROUND_EXECUTE_MS_WS)

    return
  }

  private rejectionHandler<E>(
    rejectionFn: (reason?: unknown) => void,
    handler: (event: E) => Promise<void>,
  ) {
    return async (event: E) => {
      try {
        await handler(event)
      } catch (e) {
        return rejectionFn(e)
      }
    }
  }
}

/**
 * Transport that wraps the WebSocketTransport in order to provide helper methods for a reverse mapping. This is useful
 * when the Data Provider uses pair IDs that cannot be programmatically translated into request params.
 *
 * Example with `{from: "STETH", to: "USD"} -> "STETHUSD"`:
 * Instead of trying to split the Data Provider ID string based on length, we can use
 * `setReverseMapping("STETHUSD", {from: "STETH", to: "USD"})` to map the Data Provider ID to the request payload, then
 * use `getReverseMapping("STETHUSD")` to get the right input parameters.
 *
 * @typeParam T - Helper struct type that will be used to pass types to the generic parameters (check [[WebsocketTransportGenerics]])
 * @typeParam K - The type for the Data Provider's IDs
 */
export class WebsocketReverseMappingTransport<
  T extends WebsocketTransportGenerics,
  K,
> extends WebSocketTransport<T> {
  private requestMapping: Map<K, TypeFromDefinition<T['Parameters']>> = new Map()

  /**
   * Sets the request params mapping for the given value
   *
   * @param value - the Data Provider lookup value to map to `params`
   * @param params - the body of the adapter request
   * @returns the WS message (can be any type as long as the [[WebSocket]] doesn't complain)
   */
  setReverseMapping(value: K, params: TypeFromDefinition<T['Parameters']>) {
    this.requestMapping.set(value, params)
  }

  /**
   * Gets the request params mapping for the given value
   *
   * @param value - the Data Provider lookup value
   * @returns the request parameters for the Data Provider lookup value, if one has been set
   */
  getReverseMapping(value: K): TypeFromDefinition<T['Parameters']> | undefined {
    return this.requestMapping.get(value)
  }
}
