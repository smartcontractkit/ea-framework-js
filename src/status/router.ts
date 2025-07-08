import { FastifyInstance } from 'fastify'
import { join } from 'path'
import { hostname } from 'os'
import { Adapter } from '../adapter'
import { buildSettingsList } from '../util/settings'

export interface StatusResponse {
  adapter: {
    name: string
    version: string
    uptimeSeconds: number
  }
  endpoints: {
    name: string
    aliases: string[]
    transports: string[]
  }[]
  defaultEndpoint?: string
  configuration: {
    name: string
    value: unknown
    type: string
    description: string
    required: boolean
    default: unknown
    customSetting: boolean
    envDefaultOverride: unknown
  }[]
  runtime: {
    nodeVersion: string
    platform: string
    architecture: string
    hostname: string
  }
  metrics: {
    enabled: boolean
    port?: number
    endpoint?: string
  }
}

/**
 * This function registers the status endpoint for the adapter.
 * This endpoint provides comprehensive information about the adapter including:
 * - Adapter metadata (name, version, commit)
 * - Configuration (obfuscated sensitive values)
 * - Runtime information
 * - Dependencies status
 * - Endpoints and transports
 *
 * @param app - the fastify instance that has been created
 * @param adapter - the adapter for which to create the status endpoint
 */
export default function registerStatusEndpoint(app: FastifyInstance, adapter: Adapter) {
  // Status endpoint that returns comprehensive adapter information
  app.get(join(adapter.config.settings.BASE_URL, '/status'), async () => {
    const metricsEndpoint = adapter.config.settings.METRICS_USE_BASE_URL
      ? join(adapter.config.settings.BASE_URL, 'metrics')
      : '/metrics'

    const statusResponse: StatusResponse = {
      adapter: {
        name: adapter.name,
        version: process.env['npm_package_version'] || 'unknown',
        uptimeSeconds: process.uptime(),
      },
      endpoints: adapter.endpoints.map((endpoint) => ({
        name: endpoint.name,
        aliases: endpoint.aliases || [],
        transports: endpoint.transportRoutes.routeNames(),
      })),
      defaultEndpoint: adapter.defaultEndpoint,
      configuration: buildSettingsList(adapter),
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        hostname: hostname(),
      },
      metrics: {
        enabled: adapter.config.settings.METRICS_ENABLED,
        port: adapter.config.settings.METRICS_ENABLED
          ? adapter.config.settings.METRICS_PORT
          : undefined,
        endpoint: adapter.config.settings.METRICS_ENABLED ? metricsEndpoint : undefined,
      },
    }

    return statusResponse
  })
}
