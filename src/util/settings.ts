import { Adapter } from '../adapter'
import {
  SettingsDefinitionMap,
  SettingDefinitionDetails,
  EnvGetter,
  ValidSettingValue,
} from '../config'
import { censor } from './index'
import CensorList from './censor/censor-list'

export type DebugPageSetting = SettingDefinitionDetails & { name: string; value: unknown }

/**
 * Builds a list of adapter settings with sensitive values censored
 * Used by both debug settings page and status endpoint
 */
export const buildSettingsList = <T extends SettingsDefinitionMap>(
  adapter: Adapter<T>,
): DebugPageSetting[] => {
  // Censor EA settings
  const settings = adapter.config.settings
  const censoredValues = CensorList.getAll()
  const censoredSettings: Array<SettingDefinitionDetails & { name: string; value: unknown }> = []

  const settingsEntries = Object.entries(settings).flatMap(
    ([settingName, settingValue]): {
      settingName: string
      envVarName: string
      value: ValidSettingValue
    }[] => {
      const getter = settingValue as unknown as EnvGetter
      if (getter instanceof EnvGetter) {
        return getter.entries().map(({ envVarName, value }) => ({ settingName, envVarName, value }))
      }
      return [{ settingName, envVarName: settingName, value: settingValue as ValidSettingValue }]
    },
  )
  for (const { settingName, envVarName, value } of settingsEntries) {
    const definitionDetails = adapter.config.getSettingDebugDetails(settingName)
    censoredSettings.push({
      name: envVarName,
      ...definitionDetails,
      value: censor(value, censoredValues),
    })
  }

  return censoredSettings.sort((a, b) => a.name.localeCompare(b.name))
}
