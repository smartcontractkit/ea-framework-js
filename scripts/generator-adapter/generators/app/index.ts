import * as Generator from 'yeoman-generator'
interface InputTransport {
  type: string
  name: string
}
interface EndpointGenerator {
  // The name of endpoint from user input. Spaces replaced with '-'
  inputEndpointName: string
  // Endpoint name converted to normalized name that can be used in imports/exports, i.e. crypto-one-two -> cryptoOneTwo
  normalizedEndpointName: string
  // List of user-selected transports
  inputTransports: InputTransport[],
  // List of endpoint aliases
  endpointAliases: string[]
  // Endpoint name with a first letter being uppercase, i.e. crypto -> Crypto. This is needed for request payload names in the tests
  normalizedEndpointNameCap: string
}

module.exports = class extends Generator {
  props: {
    // Current ea-framework version in package.json
    frameworkVersion: string
    adapterName: string,
    endpoints: Record<string, EndpointGenerator>,
    // Comma seperated list of endpoints
    endpointNames: string,
    defaultEndpoint: EndpointGenerator
    // Whether to include explanation comments for different parts of adapter components
    includeComments: boolean
  }

  constructor(args, opts) {
    super(args, opts);
    this.argument("rootPath", { type: String, required: false, default: './', description: 'Root path where new External Adapter will be created'});
  }
  // prompting stage is used to get input from the user, validate and store it to use it for next stages
  async prompting() {
    const adapterName = await this._promptAdapterName()
    const endpointCount = await this._promptEndpointCount()
    const endpoints: Record<string, EndpointGenerator> = {}

    for (let i = 0; i < endpointCount; i++) {
      let inputEndpointName = await this._promptEndpointName(i)
      const existingEndpoint = this._checkExistingEndpoint(endpoints, inputEndpointName)

      // If the user provides the same endpoint name for a different endpoint, try prompting again a few times to use another name.
      if (existingEndpoint) {
        let retries = 3
        while (retries !== 0) {
          inputEndpointName = await this._promptEndpointName(i, inputEndpointName)
          const existingEndpointRetry = this._checkExistingEndpoint(endpoints, inputEndpointName)

          if (!existingEndpointRetry) {
            break;
          }
          --retries

          if (retries === 0) {
            throw new Error(`There is already configured endpoint with name '${inputEndpointName}'`)
          }
        }
      }

      let endpointAliases = await this._promptAliases(inputEndpointName)

      // Check each alias to make sure there are no other registered endpoints with that name/alias
      let existingAliasEndpoint = this._checkExistingEndpointAliases(endpoints, endpointAliases)

      if (existingAliasEndpoint) {
        let retries = 3
        while (retries !== 0) {
          endpointAliases = await this._promptAliases(inputEndpointName, true)

          const existingAliasEndpointRetry = this._checkExistingEndpointAliases(endpoints, endpointAliases)

          if (!existingAliasEndpointRetry) {
            break;
          }
          --retries

          if (retries === 0) {
            throw new Error(`There is already configured endpoint with provided one or more aliases (${endpointAliases}). Endpoint ${existingAliasEndpointRetry.inputEndpointName} , aliases - ${existingAliasEndpointRetry.endpointAliases}`)
          }
        }
      }

     const inputTransports = await this._promptTransports(inputEndpointName)

      endpoints[i] = {
        inputEndpointName,
        normalizedEndpointName: this._normalizeEndpointName(inputEndpointName),
        inputTransports,
        normalizedEndpointNameCap: '',
        endpointAliases
      }
      endpoints[i].normalizedEndpointNameCap = endpoints[i].normalizedEndpointName.charAt(0).toUpperCase() + endpoints[i].normalizedEndpointName.slice(1)
    }

    const endpointNames = Object.values(endpoints).map(e => e.normalizedEndpointName).join(', ')

    const includeComments = await this._promptConfirmation(adapterName, endpointNames)

    this.props = {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      frameworkVersion: (await import('../../../package.json')).version,
      adapterName,
      endpoints,
      endpointNames,
      defaultEndpoint: endpoints[0],
      includeComments
    };
  }

  // writing stage is used to create new folder/files with templates based on user-provided input
  writing() {
    // Copy base files
    const baseFiles = [
      'CHANGELOG.md',
      'package.json',
      'README.md',
      'test-payload.json',
      'tsconfig.json',
      'tsconfig.test.json',
      'src/index.ts'
    ]

    baseFiles.forEach(fileName => {
      this.fs.copyTpl(
        this.templatePath(fileName),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/${fileName}`),
        this.props
      );
    })

    // Copy config
    this.fs.copy(
      this.templatePath('src/config/index.ts'),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/config/index.ts`),
    )
    this.fs.copyTpl(
      this.templatePath('src/config/overrides.json'),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/config/overrides.json`),
      this.props
    )


    // Create endpoint and transport files
    Object.values(this.props.endpoints).forEach(({inputEndpointName, inputTransports, endpointAliases}) => {
      if (inputTransports.length > 1) {
        // Router endpoints
        this.fs.copyTpl(
          this.templatePath('src/endpoint/endpoint-router.ts'),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/${inputEndpointName}.ts`),
          {inputEndpointName, inputTransports, endpointAliases, adapterName: this.props.adapterName, includeComments: this.props.includeComments}
        );

        inputTransports.forEach(transport => {
          this.fs.copyTpl(
            this.templatePath(`src/transport/${transport.type}.ts`),
            this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/transport/${inputEndpointName}-${transport.type}.ts`),
            {inputEndpointName, includeComments: this.props.includeComments}
          );
        })
      }else {
        // Single transport endpoints
        this.fs.copyTpl(
          this.templatePath('src/endpoint/endpoint.ts'),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/${inputEndpointName}.ts`),
          {inputEndpointName, inputTransports, endpointAliases, adapterName: this.props.adapterName, includeComments: this.props.includeComments}
        );

        this.fs.copyTpl(
          this.templatePath(`src/transport/${inputTransports[0].type}.ts`),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/transport/${inputEndpointName}.ts`),
          {inputEndpointName, includeComments: this.props.includeComments}
        );
      }
    })

    // Create endpoint barrel file
    this.fs.copyTpl(
      this.templatePath(`src/endpoint/index.ts`),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/index.ts`),
      {endpoints: Object.values(this.props.endpoints)}
    );


    // Create test files
    const httpEndpoints = Object.values(this.props.endpoints).filter((e: EndpointGenerator) => e.inputTransports.some(t => t.type === 'http'))
    const wsEndpoints = Object.values(this.props.endpoints).filter((e: EndpointGenerator) => e.inputTransports.some(t => t.type === 'ws'))
    const customEndpoints = Object.values(this.props.endpoints).filter((e: EndpointGenerator) => e.inputTransports.some(t => t.type === 'custom'))

    // Create adapter.test.ts if there is at least one endpoint with httpTransport
    if (httpEndpoints.length) {
      this.fs.copyTpl(
        this.templatePath(`test/adapter.test.ts`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/adapter.test.ts`),
        {endpoints: httpEndpoints, transportName: 'rest'}
      );
    }

    // Create adapter.test.ts or adapter-ws.test.ts if there is at least one endpoint with wsTransport
    if (wsEndpoints.length) {
      let fileName = 'adapter.test.ts'
      if (httpEndpoints.length || customEndpoints.length) {
        fileName = 'adapter-ws.test.ts'
      }
      this.fs.copyTpl(
        this.templatePath(`test/adapter-ws.test.ts`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/${fileName}`),
        {endpoints: wsEndpoints}
      );
    }

    // Create adapter.test.ts or adapter-custom.test.ts if there is at least one endpoint with customTransport.
    // Custom transport integration tests use the same template as http, but in separate file. This is not ideal
    // since the setup is the same (usually) and we could have just another test describe block, but at least this is
    // consistent behavior as each transport-specific test is in its own file.
    if (customEndpoints.length) {
      let fileName = 'adapter.test.ts'
      if (httpEndpoints.length || wsEndpoints.length) {
        fileName = 'adapter-custom.test.ts'
      }
      this.fs.copyTpl(
        this.templatePath(`test/adapter.test.ts`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/${fileName}`),
        {endpoints: customEndpoints, transportName: 'custom'}
      );
    }

    // Copy test fixtures
    this.fs.copyTpl(
      this.templatePath(`test/fixtures.ts`),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/fixtures.ts`),
      {includeWsFixtures: wsEndpoints.length > 0, includeHttpFixtures: httpEndpoints.length > 0 || customEndpoints.length > 0}
    );

    // Add dependencies to existing package.json
    const pkgJson = {
      devDependencies: {
        "@types/jest": "27.5.2",
        "@types/node": "16.11.51",
        nock: "13.2.9",
        typescript: "5.0.4"
      },
      dependencies: {
        "@chainlink/external-adapter-framework": this.props.frameworkVersion,
        tslib: "2.4.1"
      }
    }

    // If EA has websocket transports add additional packages for tests.
    if (wsEndpoints.length) {
      pkgJson.devDependencies['@sinonjs/fake-timers'] = '9.1.2'
      pkgJson.devDependencies['@types/sinonjs__fake-timers'] = '8.1.2'
    }
    this.fs.extendJSON(this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/package.json`), pkgJson);
  }

  // install stage is used to run npm or yarn install scripts
  install() {
    this.yarnInstall()
  }

  // end is the last stage. can be used for messages or cleanup
  end() {
    this.log(`🚀 Adapter '${this.props.adapterName}' was successfully created.📍${this.options.rootPath}/${this.props.adapterName}`)
  }

  private async _promptAdapterName(): Promise<string> {
    let { adapterName } = await this.prompt( {
      type: "input",
      name: "adapterName",
      message: "What is the name of adapter?:",
      default: "example-adapter"
    })

    adapterName = this._normalizeStringInput(adapterName)
    if (adapterName === '') {
      throw new Error('Adapter name cannot be empty')
    }
    return adapterName
  }

  private async _promptEndpointCount(): Promise<number> {
    let { endpointCount } = await this.prompt({
      type: "input",
      name: "endpointCount",
      message: "How many endpoints does adapter have?:",
      default: "1"
    })

    endpointCount = parseInt(endpointCount)

    if (isNaN(endpointCount) || endpointCount <= 0) {
      throw new Error('Adapter should have at least one endpoint')
    }

    return endpointCount
  }

  private async _promptEndpointName(index, existingEndpointName?): Promise<string> {
    let message =  `What is the name of endpoint #${index+1}:`
    if (existingEndpointName) {
      message =  `Endpoint named or aliased '${existingEndpointName}' already exists. Please use another name for endpoint #${index+1}:`
    }
    let { inputEndpointName } = await this.prompt<{inputEndpointName: string}>({
      type: "input",
      name: "inputEndpointName",
      message,
      default: "price"
    })

    inputEndpointName = this._normalizeStringInput(inputEndpointName)

    if (inputEndpointName === '') {
      throw new Error('Endpoint name cannot be empty')
    }
    return inputEndpointName
  }

  private async _promptAliases(inputEndpointName, retry = false): Promise<string[]> {
    let message = `Comma separated aliases for endpoint '${inputEndpointName}':`
    if (retry) {
      message = `There is already registered endpoint that contains one or more provided aliases. Please use different values:`
    }
    const { endpointAliasesAnswer } = await this.prompt<{endpointAliasesAnswer: string}>({
      type: "input",
      name: "endpointAliasesAnswer",
      message,
      default: "empty"
    })
    let endpointAliases

    if (endpointAliasesAnswer === 'empty') {
      endpointAliases = []
    }else {
      endpointAliases = endpointAliasesAnswer.split(',').map(a => this._normalizeStringInput(a.trim()))
    }
    return endpointAliases
  }

  private async _promptTransports(inputEndpointName: string): Promise<InputTransport[]> {
    const { inputTransports } = await this.prompt<{inputTransports: InputTransport[]}>(   {
      type: "checkbox",
      name: "inputTransports",
      message: `Select transports that endpoint '${inputEndpointName}' supports:`,
      choices: [
        {
          name: "Http",
          value: {
            type: 'http',
            name: 'httpTransport',
          },
          checked: true
        },
        {
          name: "Websocket",
          value: {
            type: 'ws',
            name: 'wsTransport'
          }
        },
        {
          name: "Custom",
          value: {
            type: 'custom',
            name: 'customTransport'
          }

        }
      ]
    })

    if (!inputTransports.length) {
      throw new Error('Endpoint should have at least one transport')
    }
    return inputTransports
  }

  private async _promptConfirmation(adapterName: string, endpointNames: string): Promise<boolean> {
    const { useComments }  = await this.prompt({
      type: "confirm",
      name: "useComments",
      default: false,
      message: `Do you want helpful comments to be included in the source code ?:`
    })

    const { confirmed }  = await this.prompt({
      type: "confirm",
      name: "confirmed",
      message: `New adapter '${adapterName}' will be created with following endpoints '${endpointNames}'`
    })

    if(!confirmed) {
      process.exit(0)
    }

    return useComments
  }

  // Based on user input for endpoint name check if there is already registered endpoint/aliases with that name
  private _checkExistingEndpoint(endpoints: Record<string, EndpointGenerator>, newEndpointNameInput: string): EndpointGenerator | undefined {
    return  Object.values(endpoints).find(e => {
      return e.inputEndpointName === newEndpointNameInput || e.endpointAliases.includes(newEndpointNameInput)
    })
  }

  private _checkExistingEndpointAliases(endpoints: Record<string, EndpointGenerator>, aliases: string[]): EndpointGenerator | undefined {
    let existingEndpoint
    for (let i = 0; i < aliases.length; i++) {
      const alias = aliases[i]
      existingEndpoint = this._checkExistingEndpoint(endpoints, alias)
      if (existingEndpoint) {
        break
      }
    }
    return existingEndpoint

  }

  //convert endpoint name to normalized name that can be used in imports/exports, i.e. crypto-one-two -> cryptoOneTwo
  _normalizeEndpointName(endpointName: string): string {
    const words = endpointName.split('-')

    const capitalizedWords = words.map((word, index) => {
      if (index === 0) {
        return word;
      } else {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
    });
    return capitalizedWords.join('')
  }

  _normalizeStringInput(input: string): string {
    return input.trim().replace(/ /g, '-')
  }
}

