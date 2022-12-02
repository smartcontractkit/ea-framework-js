const fromVariables = ['ETH', 'BTC']

const toVariables = ['USD', 'JPY']

function generateTestPayload() {
  const payload = {
    requests: [],
  }

  for (const from of fromVariables) {
    for (const to of toVariables) {
      payload.requests.push({
        from,
        to,
      })
    }
  }

  return JSON.stringify(payload)
}

module.exports = generateTestPayload()
