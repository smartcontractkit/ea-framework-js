import { NopTransport, TestAdapter } from '../src/util/testing-utils'
import untypedTest, { TestFn } from 'ava'
import { InputParameters } from '../src/validation'
import { DEFAULT_LWBA_ALIASES, LwbaEndpoint, LwbaEndpointGenerics, lwbaEndpointInputParametersDefinition } from '../src/adapter'

type TestContext = {
  testAdapter: TestAdapter
}
const test = untypedTest as TestFn<TestContext>

test('lwba price endpoint has common aliases', async (t) => {
  const lwbaEndpoint = new LwbaEndpoint({
    name: 'test',
    inputParameters: new InputParameters(lwbaEndpointInputParametersDefinition),
    transport: new NopTransport(),
  }) as LwbaEndpoint<LwbaEndpointGenerics>

  t.deepEqual(lwbaEndpoint.aliases, DEFAULT_LWBA_ALIASES)
})