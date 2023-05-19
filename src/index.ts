import fastify, { FastifyInstance } from 'fastify'
import { AddressInfo } from 'net'
import { join } from 'path'
import { Adapter, AdapterDependencies } from './adapter'
import { callBackgroundExecutes } from './background-executor'
import { AdapterSettings, SettingsDefinitionMap } from './config'
import { buildMetricsMiddleware, setupMetricsServer } from './metrics'
import { AdapterRequest, AdapterRouteGeneric, loggingContextMiddleware, makeLogger } from './util'
import { errorCatchingMiddleware, validatorMiddleware } from './validation'
import { EmptyInputParameters } from './validation/input-params'

export { FastifyInstance as ServerInstance }

const logger = makeLogger('Main')

const VERSION = process.env['npm_package_version']

export interface httpsOptions {
  https: {
    key: string
    cert: string
    ca: string
    passphrase?: string
    requestCert: boolean
  }
}

export const getTLSOptions = (adapterSettings: AdapterSettings) => {
  if (adapterSettings.TLS_ENABLED && adapterSettings.MTLS_ENABLED) {
    throw new Error('TLS_ENABLED and MTLS_ENABLED cannot both be set to true.')
  }

  if (adapterSettings.TLS_ENABLED || adapterSettings.MTLS_ENABLED) {
    if (
      !adapterSettings.TLS_PRIVATE_KEY ||
      !adapterSettings.TLS_PUBLIC_KEY ||
      !adapterSettings.TLS_CA
    ) {
      const TLSOption = adapterSettings.TLS_ENABLED ? 'TLS_ENABLED' : 'MTLS_ENABLED'
      throw new Error(
        `TLS_PRIVATE_KEY, TLS_PUBLIC_KEY, and TLS_CA environment variables are required when ${TLSOption} is set to true.`,
      )
    }
    const httpsOptions = {
      key: adapterSettings.TLS_PRIVATE_KEY,
      cert: adapterSettings.TLS_PUBLIC_KEY,
      ca: adapterSettings.TLS_CA,
      passphrase: adapterSettings.TLS_PASSPHRASE,
      requestCert: adapterSettings.MTLS_ENABLED,
    }
    return { https: httpsOptions }
  }
  return {}
}

/**
 * Main function for the framework.
 * Initializes config and dependencies, uses those to initialize Transports, and starts listening for requests.
 *
 * @param adapter - an object describing an External Adapter
 * @param dependencies - an optional object with adapter dependencies to inject
 * @returns a Promise that resolves to the http.Server listening for connections
 */
export const start = async <T extends SettingsDefinitionMap>(
  adapter: Adapter<T>,
  dependencies?: Partial<AdapterDependencies>,
): Promise<{
  api: FastifyInstance | undefined
  metricsApi: FastifyInstance | undefined
}> => {
  if (!(adapter instanceof Adapter)) {
    throw new Error(
      'The adapter has not been initialized as an instance of the Adapter class, exiting.',
    )
  }

  // Initialize adapter (create dependencies, inject them, build endpoint map, etc.)
  await adapter.initialize(dependencies)

  let api: FastifyInstance | undefined = undefined
  let metricsApi: FastifyInstance | undefined = undefined

  if (
    adapter.config.settings.METRICS_ENABLED &&
    adapter.config.settings.EXPERIMENTAL_METRICS_ENABLED
  ) {
    metricsApi = setupMetricsServer(adapter.name, adapter.config.settings)
  }

  // Optional Promise to indicate that the API is shutting down (for us to close background executors)
  let apiShutdownPromise

  if (
    adapter.config.settings.EA_MODE === 'reader' ||
    adapter.config.settings.EA_MODE === 'reader-writer'
  ) {
    // Main REST API server to handle incoming requests
    api = await buildRestApi(adapter as unknown as Adapter)

    // Add a hook on close to use on the background execution loop to stop it
    apiShutdownPromise = new Promise<void>((resolve) => {
      api?.addHook('onClose', async () => resolve())
    })
  } else {
    logger.info('REST API is disabled; this instance will not process incoming requests.')
  }

  // Listener for unhandled promise rejections that are bubbling up to the top
  process.on('unhandledRejection', (err: Error) => {
    logger.error({
      name: err.name,
      stack: err.stack,
      message: err.message,
    })
  })

  if (
    adapter.config.settings.EA_MODE === 'writer' ||
    adapter.config.settings.EA_MODE === 'reader-writer'
  ) {
    // Start background loop that will take care of calling any async Transports
    logger.info('Starting background execution loop')
    callBackgroundExecutes(adapter as unknown as Adapter, apiShutdownPromise)
  } else {
    logger.info(
      'Background executor is disabled; this instance will not perform async background executes.',
    )
  }

  return { api, metricsApi }
}

export const expose = async <T extends SettingsDefinitionMap>(
  adapter: Adapter<T>,
  dependencies?: Partial<AdapterDependencies>,
): Promise<FastifyInstance | undefined> => {
  const { api, metricsApi } = await start(adapter, dependencies)

  const exposeApp = async (app: FastifyInstance | undefined, port: number) => {
    if (app) {
      try {
        await app.listen({ port, host: adapter.config.settings.EA_HOST })
      } catch (err) {
        logger.fatal(`There was an error when starting the server: ${err}`)
        process.exit()
      }

      logger.info(`Listening on port ${(app.server.address() as AddressInfo).port}`)
    }
  }

  // Start listening for incoming requests
  await exposeApp(api, adapter.config.settings.EA_PORT)
  await exposeApp(metricsApi, adapter.config.settings.METRICS_PORT)

  // We return only the main API to maintain backwards compatibility
  return api
}

async function buildRestApi(adapter: Adapter) {
  const TLSOptions: httpsOptions | Record<string, unknown> = getTLSOptions(adapter.config.settings)
  const app = fastify({
    ...TLSOptions,
    bodyLimit: adapter.config.settings.MAX_PAYLOAD_SIZE_LIMIT,
  })

  // Add healthcheck endpoint before middlewares to bypass them
  app.get(join(adapter.config.settings.BASE_URL, 'health'), (req, res) => {
    res.status(200).send({ message: 'OK', version: VERSION })
  })

  // Use global error handling
  app.setErrorHandler(errorCatchingMiddleware)

  // Always reply with json content
  app.addHook('preHandler', (_, reply, done) => {
    reply.headers({ 'content-type': 'application/json; charset=utf-8' })
    done()
  })

  app.register(async (router) => {
    // Set up "middlewares" (hooks in fastify)
    router.addHook<AdapterRouteGeneric>('preHandler', validatorMiddleware(adapter))
    if (adapter.config.settings.CORRELATION_ID_ENABLED) {
      router.addHook<AdapterRouteGeneric>('onRequest', loggingContextMiddleware)
    }

    router.route<AdapterRouteGeneric>({
      url: adapter.config.settings.BASE_URL,
      method: 'POST',
      handler: async (req, reply) => {
        const response = await adapter.handleRequest(
          req as AdapterRequest<EmptyInputParameters>,
          reply as unknown as Promise<unknown>,
        )
        return reply.code(response.statusCode || 200).send(response)
      },
    })

    if (
      adapter.config.settings.METRICS_ENABLED &&
      adapter.config.settings.EXPERIMENTAL_METRICS_ENABLED
    ) {
      router.addHook<AdapterRouteGeneric>('onResponse', buildMetricsMiddleware)
    }
  })

  return app
}
