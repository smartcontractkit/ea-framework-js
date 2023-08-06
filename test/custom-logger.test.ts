import test from 'ava'
import { start } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { LoggerFactory } from '../src/util/logger'
import { NopTransport } from '../src/util/testing-utils'

test('custom logger instance is properly injected', async (t) => {
  let timesCalled = 0

  const loggerFactory: LoggerFactory = {
    child: () => {
      return {
        fatal: () => {
          timesCalled++
        },
        error: () => {
          timesCalled++
        },
        warn: () => {
          timesCalled++
        },
        info: () => {
          timesCalled++
        },
        debug: () => {
          timesCalled++
        },
        trace: () => {
          timesCalled++
        },
      }
    },
  }

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })

  t.is(timesCalled, 0)

  await start(adapter, {
    loggerFactory,
  })

  t.true(timesCalled > 0)
})
