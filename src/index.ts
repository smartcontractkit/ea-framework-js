import fastify, { FastifyInstance } from 'fastify'
import { AddressInfo } from 'net'
import { join } from 'path'
import { Adapter, AdapterDependencies } from './adapter'
import { callBackgroundExecutes } from './background-executor'
import { AdapterConfig, SettingsMap } from './config'
import { buildMetricsMiddleware, setupMetricsServer } from './metrics'
import { AdapterRouteGeneric, loggingContextMiddleware, makeLogger } from './util'
import { loadTestPayload } from './util/test-payload-loader'
import { errorCatchingMiddleware, validatorMiddleware } from './validation'

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

export const getMTLSOptions = (config: AdapterConfig) => {
  if (
    config.MTLS_ENABLED &&
    (!config.TLS_PRIVATE_KEY || !config.TLS_PUBLIC_KEY || !config.TLS_CA)
  ) {
    throw new Error(
      `TLS_PRIVATE_KEY , TLS_PUBLIC_KEY and  TLS_CA environment variables are required when MTLS_ENABLED is set to true.`,
    )
  } else if (config.MTLS_ENABLED) {
    return {
      https: {
        key: config.TLS_PRIVATE_KEY,
        cert: config.TLS_PUBLIC_KEY,
        ca: config.TLS_CA,
        passphrase: config.TLS_PASSPHRASE,
        requestCert: true,
      },
    }
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
export const start = async <T extends SettingsMap = SettingsMap>(
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

  if (adapter.config.METRICS_ENABLED && adapter.config.EXPERIMENTAL_METRICS_ENABLED) {
    metricsApi = setupMetricsServer(adapter.name, adapter.config as AdapterConfig)
  }

  // Optional Promise to indicate that the API is shutting down (for us to close background executors)
  let apiShutdownPromise

  if (adapter.config.EA_MODE === 'reader' || adapter.config.EA_MODE === 'reader-writer') {
    // Main REST API server to handle incoming requests
    api = await buildRestApi(adapter as unknown as Adapter)

    // Add a hook on close to use on the background execution loop to stop it
    apiShutdownPromise = new Promise<void>((resolve) => {
      api?.addHook('onClose', async () => resolve())
    })
  } else {
    logger.info('REST API is disabled; this instance will not process incoming requests.')
  }

  if (adapter.config.EA_MODE === 'writer' || adapter.config.EA_MODE === 'reader-writer') {
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

export const expose = async <T extends SettingsMap = SettingsMap>(
  adapter: Adapter<T>,
  dependencies?: Partial<AdapterDependencies>,
): Promise<FastifyInstance | undefined> => {
  const { api, metricsApi } = await start(adapter, dependencies)

  const exposeApp = async (app: FastifyInstance | undefined, port: number) => {
    if (app) {
      try {
        await app.listen({ port, host: adapter.config.EA_HOST })
      } catch (err) {
        logger.fatal(`There was an error when starting the server: ${err}`)
        process.exit()
      }

      logger.info(`Listening on port ${(app.server.address() as AddressInfo).port}`)
    }
  }

  // Start listening for incoming requests
  await exposeApp(api, adapter.config.EA_PORT)
  await exposeApp(metricsApi, adapter.config.METRICS_PORT)

  // We return only the main API to maintain backwards compatibility
  return api
}

async function buildRestApi(adapter: Adapter) {
  const mTLSOptions: httpsOptions | Record<string, unknown> = getMTLSOptions(adapter.config)
  const app = fastify({
    ...mTLSOptions,
    bodyLimit: adapter.config.MAX_PAYLOAD_SIZE_LIMIT,
  })

  // Add healthcheck endpoint before middlewares to bypass them
  app.get(join(adapter.config.BASE_URL, 'health'), (req, res) => {
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
    if (adapter.config['CORRELATION_ID_ENABLED']) {
      router.addHook<AdapterRouteGeneric>('onRequest', loggingContextMiddleware)
    }

    router.route<AdapterRouteGeneric>({
      url: adapter.config.BASE_URL,
      method: 'POST',
      handler: async (req, reply) => {
        const response = await adapter.handleRequest(req, reply as unknown as Promise<unknown>)
        return reply.code(response.statusCode || 200).send(response)
      },
    })

    if (adapter.config.METRICS_ENABLED && adapter.config.EXPERIMENTAL_METRICS_ENABLED) {
      router.addHook<AdapterRouteGeneric>('onResponse', buildMetricsMiddleware)
    }
  })

  // Add smoke endpoint after middleware which are needed for tests
  buildSmokeEndpoint(app, adapter.config)
  return app
}

/**
 * Adds the /smoke endpoint to the API for smoke testing the adapter
 *
 * @param app - the Fastify instance
 * @param config - the initialized adapter config
 */
function buildSmokeEndpoint(app: FastifyInstance, config: AdapterConfig) {
  app.get(join(config.BASE_URL, 'smoke'), async (_, res) => {
    const testPayload = loadTestPayload(config.SMOKE_TEST_PAYLOAD_FILE_NAME)
    if (testPayload.isDefault) {
      return res.status(200).send('OK')
    }

    const errors = []
    for (const index in testPayload.requests) {
      try {
        const request = { id: index, data: testPayload.requests[index] }
        // Use Fastify's app inject to pass smoke requests internally
        const response = await app.inject({
          method: 'POST',
          url: '/',
          payload: request,
        })
        const parsedResponse = JSON.parse(response.body)
        // Throw error if not 2xx status code
        if (parsedResponse.statusCode < 200 || parsedResponse.statusCode > 299) {
          throw Error('Smoke test request failed')
        }
      } catch (e: unknown) {
        errors.push(e)
      }
    }
    if (errors.length > 0) {
      return res.status(500).send(errors)
    }
    return res.status(200).send('OK')
  })
}
