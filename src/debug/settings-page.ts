import { Adapter } from '../adapter'
import { SettingDefinitionDetails } from '../config'
import { censor } from '../util'
import CensorList from '../util/censor/censor-list'

export type DebugPageSetting = SettingDefinitionDetails & { name: string; value: unknown }

export const buildDebugSettingsList = (adapter: Adapter): DebugPageSetting[] => {
  // Censor EA settings
  const settings = adapter.config.settings
  const censoredValues = CensorList.getAll()
  const censoredSettings: Array<SettingDefinitionDetails & { name: string; value: unknown }> = []
  for (const [key, value] of Object.entries(settings)) {
    const definitionDetails = adapter.config.getSettingDebugDetails(key)
    censoredSettings.push({
      name: key,
      ...definitionDetails,
      value: censor(value, censoredValues),
    })
  }
  return censoredSettings
}

// To enable syntax highlighting in VSCode, you can download the "Comment tagged templates" extension:
// https://marketplace.visualstudio.com/items?itemName=bierner.comment-tagged-templates
const settingsPage = (settings: DebugPageSetting[]) => /* HTML */ `
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>EA Settings</title>
      <style>
        /* System Fonts as used by GitHub */
        body {
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
            'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th,
        td {
          border: 1px solid black;
          padding: 8px;
          text-align: left;
        }
        td.default {
          opacity: 50%;
        }
        button {
          padding: 8px;
          margin-bottom: 24px;
        }
        h1,
        p,
        button {
          margin-left: 8px;
        }
      </style>

      <script type="text/javascript">
        async function copySettings() {
          // You could technically also hardcode the settings here, but this is much easier than escaping strings
          const settingsResponse = await fetch('/debug/settings/raw')
          const settings = await settingsResponse.text()
          navigator.clipboard.writeText(settings)
        }
      </script>
    </head>

    <body>
      <h1>EA Settings</h1>
      <p>
        This page shows the current settings for the EA. It is intended to be used for debugging
        purposes, and should not be publicly accessible.
      </p>
      <button onclick="copySettings()">Copy settings JSON to clipboard</button>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Description</th>
            <th>Value</th>
            <th>Required</th>
            <th>Default</th>
            <th>Custom Setting</th>
            <th>Env Default Override</th>
          </tr>
        </thead>
        <tbody>
          ${settings
            .map(
              (setting) => /* HTML */ `
                <tr>
                  <td>${setting.name}</td>
                  <td>${setting.type}</td>
                  <td>${setting.description}</td>
                  <td class="${setting.default === setting.value ? 'default' : ''}">
                    ${setting.value || ''}
                  </td>
                  <td>${setting.required ? '✅' : ''}</td>
                  <td>${setting.default || ''}</td>
                  <td>${setting.customSetting ? '✅' : ''}</td>
                  <td>${setting.envDefaultOverride || ''}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </body>
  </html>
`
export default settingsPage
