export const inputParameters = new InputParameters({
  base: {
    aliases: ['from', 'coin', 'symbol', 'market'],
    required: true,
    type: 'string',
    description: 'The symbol of symbols of the currency to query',
  },
  quote: {
    aliases: ['to', 'convert'],
    required: true,
    type: 'string',
    description: 'The symbol of the currency to convert to',
  },
})

export type BaseEndpointTypes = {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: typeof config.settings
}