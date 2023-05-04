import { metrics } from '../src/metrics/index'

metrics.initialize()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metricDefs = metrics.getMetricsDefinition() as unknown as {
  [key: string]: {
    help: string
    labelNames: string[]
  }
}

const sortedMetrics = Object.entries(metricDefs).sort(([metricName1], [metricName2]) =>
  metricName1.localeCompare(metricName2),
)

let output = `# Metrics\n\n|Name|Type|Help|Labels|\n|---|---|---|---|\n`

for (const [name, metric] of sortedMetrics) {
  const type = metric.constructor.name
  const help = metric.help
  const labels = metric.labelNames.map((l) => `- ${l}`).join('<br>')
  output += `|${name}|${type}|${help}|${labels}|\n`
}

// eslint-disable-next-line no-console
console.log(output)
