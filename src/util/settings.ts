import { Adapter } from '../adapter'
import { SettingDefinitionDetails } from '../config'
import { censor } from './index'
import CensorList from './censor/censor-list'

export type DebugPageSetting = SettingDefinitionDetails & { name: string; value: unknown }

/**
 * Builds a list of adapter settings with sensitive values censored
 * Used by both debug settings page and status endpoint
 */
export const buildSettingsList = (adapter: Adapter): DebugPageSetting[] => {
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
  
  return censoredSettings.sort((a, b) => a.name.localeCompare(b.name))
} 