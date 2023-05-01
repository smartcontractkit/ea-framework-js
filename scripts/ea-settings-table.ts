import { BaseSettingsDefinition } from '../src/config/index'

let output = `# EA Settings\n\n|Name|Type|Default|Description|Validation|Min|Max\n|---|---|---|---|---|---|---|\n`

const sortedSettings = Object.keys(BaseSettingsDefinition).sort()

for (const settingName of sortedSettings) {
  const data = BaseSettingsDefinition[settingName as keyof typeof BaseSettingsDefinition]
  const settingDefault = data['default' as keyof typeof data]

  let details = ''
  let min: number | string = ''
  let max: number | string = ''

  if ('validate' in data) {
    if (data.validate.meta.details) {
      details = `- ${data.validate.meta.details.split(', ').join('<br> - ')}`
    }

    if (typeof data.validate.meta.min === 'number') {
      min = data.validate.meta.min
    }
    if (typeof data.validate.meta.max === 'number') {
      max = data.validate.meta.max
    }
  }

  output += `|${settingName}|${data.type}|${settingDefault}|${data.description}|${details}|${min}|${max}\n`
}

// eslint-disable-next-line no-console
console.log(output)
