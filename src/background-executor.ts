import { Adapter, AdapterEndpoint, EndpointContext, EndpointGenerics } from './adapter'
import { metrics } from './metrics'
import { MetaTransport, Transport, TransportGenerics } from './transports'
import { asyncLocalStorage, makeLogger } from './util'

const logger = makeLogger('BackgroundExecutor')

/**
 * Very simple background loop that will call the [[Transport.backgroundExecute]] functions in all Transports.
 * It gets the time in ms to wait as the return value from those functions, and sleeps until next execution.
 *
 * @param adapter - an initialized External Adapter
 * @param server - the http server to attach an on close listener to
 */
export async function callBackgroundExecutes(adapter: Adapter, apiShutdownPromise?: Promise<void>) {
  // Set up variable to check later on to see if we need to stop this background "thread"
  // If no server is provided, the listener won't be set and serverClosed will always be false
  let serverClosed = false

  const timeoutsMap: {
    [endpointName: string]: NodeJS.Timeout
  } = {}

  apiShutdownPromise?.then(() => {
    serverClosed = true
    for (const endpointName in timeoutsMap) {
      logger.debug(`Clearing timeout for endpoint "${endpointName}"`)
      timeoutsMap[endpointName].unref()
      clearTimeout(timeoutsMap[endpointName])
    }
  })

  // Checks if an individual transport has a backgroundExecute function, and executes it if it does
  const callBackgroundExecute = (
    endpoint: AdapterEndpoint<EndpointGenerics>,
    transport: Transport<TransportGenerics>,
    transportName?: string,
  ) => {
    const backgroundExecute = transport.backgroundExecute?.bind(transport)
    if (!backgroundExecute) {
      logger.debug(`Endpoint "${endpoint.name}" has no background execute, skipping...`)
      return
    }

    const context: EndpointContext<EndpointGenerics> = {
      endpointName: endpoint.name,
      inputParameters: endpoint.inputParameters,
      adapterConfig: adapter.config,
    }

    const handler = async () => {
      if (serverClosed) {
        logger.info('Server closed, stopping recursive backgroundExecute handler chain')
        return
      }
      // Count number of background executions per endpoint
      metrics
        .get('bgExecuteTotal')
        .labels({ endpoint: endpoint.name, transport: transportName })
        .inc()

      // Time the duration of the background execute process excluding sleep time
      const metricsTimer = metrics
        .get('bgExecuteDurationSeconds')
        .labels({ endpoint: endpoint.name, transport: transportName })
        .startTimer()

      logger.debug(`Calling background execute for endpoint "${endpoint.name}"`)

      try {
        await asyncLocalStorage.run(
          {
            correlationId: `Endpoint: ${endpoint.name} - Transport: ${transport.constructor.name}`,
          },
          () => {
            return backgroundExecute(context)
          },
        )
      } catch (error) {
        logger.error(error, (error as Error).stack)
        metrics
          .get('bgExecuteErrors')
          .labels({ endpoint: endpoint.name, transport: transportName })
          .inc()
      }

      // This background execute loop is no longer the one to determine the sleep between bg execute calls.
      // That is now instead responsibility of each transport, to allow for custom ones to implement their own timings.
      logger.trace(
        `Finished background execute for endpoint "${endpoint.name}", calling it again in 10ms...`,
      )
      metricsTimer()
      timeoutsMap[endpoint.name] = setTimeout(handler, 10)
    }

    // Start recursive async calls
    handler()
  }

  for (const endpoint of adapter.endpoints) {
    const { transport } = endpoint

    // Check if transport is a MetaTransport by casting and checking a known property (transports)
    const castMeta = transport as MetaTransport<TransportGenerics>
    if (castMeta.transports) {
      logger.debug(
        `Encountered MetaTransport ${transport.constructor.name}, calling backgroundExecute on all transports`,
      )
      for (const [transportName, nestedTransport] of Object.entries(castMeta.transports)) {
        callBackgroundExecute(endpoint, nestedTransport, transportName)
      }
    } else {
      callBackgroundExecute(endpoint, transport)
    }
  }
}
