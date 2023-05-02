import { metrics } from '../src/metrics/index'

metrics.initialize()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metricDefs = metrics.getMetricsDefinition() as { [key: string]: any }

const sortedMetrics = Object.keys(metricDefs).sort()

let output = `# Metrics\n\n|Name|Type|Help|Label Names|\n|---|---|---|---|\n`

for (const metric of sortedMetrics) {
  const data = metricDefs[metric as keyof typeof metricDefs]
  const type = data.constructor.name
  const help = data['help' as keyof typeof data]
  const labelNames = data['labelNames' as keyof typeof data]
  output += `|${metric}|${type}|${help}|${labelNames}|\n`
}

// eslint-disable-next-line no-console
console.log(output)
