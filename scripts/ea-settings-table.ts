import { BaseSettingsDefinition, SettingDefinition } from '../src/config/index'

const spacer = Array(30).fill('&nbsp;').join('')

let output = `# EA Settings\n\n|Name|Type|Default|${spacer}Description${spacer}|${spacer}Validation${spacer}|Min|Max\n|---|---|---|---|---|---|---|\n`

const sortedSettings: Array<[string, SettingDefinition]> = Object.entries(
  BaseSettingsDefinition,
).sort(([settingName1], [settingName2]) => settingName1.localeCompare(settingName2))

for (const [name, setting] of sortedSettings) {
  let validation = ''
  let min: number | string = ''
  let max: number | string = ''

  if (setting.validate) {
    if (setting.validate.meta.details) {
      validation = `- ${setting.validate.meta.details.split(', ').join('<br> - ')}`
    }

    if (typeof setting.validate.meta.min === 'number') {
      min = setting.validate.meta.min
    }
    if (typeof setting.validate.meta.max === 'number') {
      max = setting.validate.meta.max
    }
  }

  output += `|${name}|${setting.type}|${setting.default}|${setting.description}|${validation}|${min}|${max}\n`
}

// eslint-disable-next-line no-console
console.log(output)
