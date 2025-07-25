import { FastifyInstance } from 'fastify'
import { join } from 'path'
import { Adapter } from '../adapter'
import settingsPage from './settings-page'
import { buildSettingsList } from '../util/settings'

/**
 * This function registers the debug endpoints for the adapter.
 * These endpoints are intended to be used for debugging purposes only, and should not be publicly accessible.
 *
 * @param app - the fastify instance that has been created
 * @param adapter - the adapter for which to create the debug endpoints
 */
export default function registerDebugEndpoints(app: FastifyInstance, adapter: Adapter) {
  // Debug endpoint to return the current settings in raw JSON (censoring sensitive values)
  app.get(join(adapter.config.settings.BASE_URL, '/debug/settings/raw'), async () => {
    const censoredSettings = buildSettingsList(adapter)
    return JSON.stringify(
      censoredSettings.sort((a, b) => a.name.localeCompare(b.name)),
      null,
      2,
    )
  })

  // Helpful UI to visualize current settings
  app.get(join(adapter.config.settings.BASE_URL, '/debug/settings'), (req, reply) => {
    const censoredSettings = buildSettingsList(adapter)
    const censoredSettingsPage = settingsPage(censoredSettings)
    reply.headers({ 'content-type': 'text/html' }).send(censoredSettingsPage)
  })
}
