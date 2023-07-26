import * as Generator from 'yeoman-generator'

interface InputTransport {
  type: string
  name: string
}

interface GeneratorEndpointContext {
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


module.exports = class extends Generator<{rootPath: string}> {
  props: {
    // Current ea-framework version in package.json
    frameworkVersion: string
    adapterName: string,
    endpoints: Record<string, GeneratorEndpointContext>,
    // Comma seperated list of endpoints
    endpointNames: string,
    defaultEndpoint: GeneratorEndpointContext
    // Whether to include explanation comments for different parts of adapter components
    includeComments: boolean
  }
  endpointsAndAliases = new Set<string>()
  // When EXTERNAL_ADAPTER_GENERATOR_NO_INTERACTIVE is set to true, the generator will not prompt the user and will use the
  // default values to create one endpoint with all transports. This is useful for testing the generator in CI, or in cases
  // where the user wants to quickly generate the boilerplate code.
  promptDisabled = process.env.EXTERNAL_ADAPTER_GENERATOR_NO_INTERACTIVE === 'true'
  // When EXTERNAL_ADAPTER_GENERATOR_STANDALONE is set to true, tsconfig files (tsconfig.json and tsconfig.test.json) will not
  // extend tsconfig.base.json which is present in external-adapters-js monorepo, but rather generator will create new tsconfig.base.json
  // with the same content in the same directory and extend from it. Also, new packages and config files (jest, babel) will be added
  // to be able to run the tests
  standalone = process.env.EXTERNAL_ADAPTER_GENERATOR_STANDALONE === 'true'

  constructor(args, opts) {
    super(args, opts)
    this.argument('rootPath', {
      type: String,
      required: false,
      default: './',
      description: 'Root path where new External Adapter will be created',
    })

  }

  // prompting stage is used to get input from the user, validate and store it to use it for next stages
  async prompting() {
    const adapterName = await this._promptAdapterName()
    const endpointCount = await this._promptEndpointCount()
    const endpoints: Record<string, GeneratorEndpointContext> = {}

    for (let i = 0; i < endpointCount; i++) {
      let inputEndpointName = await this._promptEndpointName(i)
      this.endpointsAndAliases.add(inputEndpointName)

      let endpointAliases = await this._promptAliases(inputEndpointName)
      endpointAliases.forEach(alias => this.endpointsAndAliases.add(alias))

      const inputTransports = await this._promptTransports(inputEndpointName)

      endpoints[i] = {
        inputEndpointName,
        normalizedEndpointName: this._normalizeEndpointName(inputEndpointName),
        inputTransports,
        normalizedEndpointNameCap: '',
        endpointAliases,
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
      includeComments,
    }
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
    ]

    // If the generator is in standalone mode, also create tsconfig.base.json in the same directory
    // so that both tsconfig and tsconfig.test can extend it. If the generator is not in standalone mode,
    // tsconfig files will extend base settings from external-adapter-js monorepo base tsconfig.
    // Same way jest and babel config files are also created to be able to run the integration tests
    if (this.standalone) {
      baseFiles.push('tsconfig.base.json', 'babel.config.js', 'jest.config.js')
    }

    baseFiles.forEach(fileName => {
      this.fs.copyTpl(
        this.templatePath(fileName),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/${fileName}`),
        {...this.props, standalone: this.standalone}
      )
    })

    // copy main index.ts file
    this.fs.copyTpl(
      this.templatePath(`src/index.ts.ejs`),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/index.ts`),
      this.props
    )

    // Copy config
    this.fs.copy(
      this.templatePath('src/config/index.ts'),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/config/index.ts`),
    )
    this.fs.copyTpl(
      this.templatePath('src/config/overrides.json'),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/config/overrides.json`),
      this.props,
    )

    // Create endpoint and transport files
    Object.values(this.props.endpoints).forEach(({ inputEndpointName, inputTransports, endpointAliases }) => {
      if (inputTransports.length > 1) {
        // Router endpoints
        this.fs.copyTpl(
          this.templatePath('src/endpoint/endpoint-router.ts.ejs'),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/${inputEndpointName}.ts`),
          {
            inputEndpointName,
            inputTransports,
            endpointAliases,
            adapterName: this.props.adapterName,
            includeComments: this.props.includeComments,
          },
        )

        inputTransports.forEach(transport => {
          this.fs.copyTpl(
            this.templatePath(`src/transport/${transport.type}.ts.ejs`),
            this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/transport/${inputEndpointName}-${transport.type}.ts`),
            { inputEndpointName, includeComments: this.props.includeComments },
          )
        })
      } else {
        // Single transport endpoints
        this.fs.copyTpl(
          this.templatePath('src/endpoint/endpoint.ts.ejs'),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/${inputEndpointName}.ts`),
          {
            inputEndpointName,
            inputTransports,
            endpointAliases,
            adapterName: this.props.adapterName,
            includeComments: this.props.includeComments,
          },
        )

        this.fs.copyTpl(
          this.templatePath(`src/transport/${inputTransports[0].type}.ts.ejs`),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/transport/${inputEndpointName}.ts`),
          { inputEndpointName, includeComments: this.props.includeComments },
        )
      }
    })

    // Create endpoint barrel file
    this.fs.copyTpl(
      this.templatePath(`src/endpoint/index.ts.ejs`),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/index.ts`),
      { endpoints: Object.values(this.props.endpoints) },
    )


    // Create test files
    const httpEndpoints = Object.values(this.props.endpoints).filter((e: GeneratorEndpointContext) => e.inputTransports.some(t => t.type === 'http'))
    const wsEndpoints = Object.values(this.props.endpoints).filter((e: GeneratorEndpointContext) => e.inputTransports.some(t => t.type === 'ws'))
    const customEndpoints = Object.values(this.props.endpoints).filter((e: GeneratorEndpointContext) => e.inputTransports.some(t => t.type === 'custom'))

    // Create adapter.test.ts if there is at least one endpoint with httpTransport
    if (httpEndpoints.length) {
      this.fs.copyTpl(
        this.templatePath(`test/adapter.test.ts.ejs`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/adapter.test.ts`),
        { endpoints: httpEndpoints, transportName: 'rest' },
      )
    }

    // Create adapter.test.ts or adapter-ws.test.ts if there is at least one endpoint with wsTransport
    if (wsEndpoints.length) {
      let fileName = 'adapter.test.ts'
      if (httpEndpoints.length || customEndpoints.length) {
        fileName = 'adapter-ws.test.ts'
      }
      this.fs.copyTpl(
        this.templatePath(`test/adapter-ws.test.ts.ejs`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/${fileName}`),
        { endpoints: wsEndpoints },
      )
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
        this.templatePath(`test/adapter.test.ts.ejs`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/${fileName}`),
        { endpoints: customEndpoints, transportName: 'custom' },
      )
    }

    // Copy test fixtures
    this.fs.copyTpl(
      this.templatePath(`test/fixtures.ts.ejs`),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/fixtures.ts`),
      {
        includeWsFixtures: wsEndpoints.length > 0,
        includeHttpFixtures: httpEndpoints.length > 0 || customEndpoints.length > 0,
      },
    )

    // Add dependencies to existing package.json
    const pkgJson = {
      devDependencies: {
        '@types/jest': '27.5.2',
        '@types/node': '16.11.51',
        nock: '13.2.9',
        typescript: '5.0.4',
      },
      dependencies: {
        '@chainlink/external-adapter-framework': this.props.frameworkVersion,
        tslib: '2.4.1',
      },
      scripts: {}
    }

    // If EA has websocket transports add additional packages for tests.
    if (wsEndpoints.length) {
      pkgJson.devDependencies['@sinonjs/fake-timers'] = '9.1.2'
      pkgJson.devDependencies['@types/sinonjs__fake-timers'] = '8.1.2'
    }

    // If the generator is in standalone mode, add additional packages and a script for running the tests with jest
    if (this.standalone) {
      pkgJson.devDependencies['@babel/core'] = '7.21.8'
      pkgJson.devDependencies['@babel/preset-env'] = '7.20.2'
      pkgJson.devDependencies['@babel/preset-typescript'] = "7.21.5"
      pkgJson.devDependencies['jest'] = '29.5.0'
      pkgJson.scripts['test'] = 'EA_PORT=0 METRICS_ENABLED=false jest --updateSnapshot'
    }

    this.fs.extendJSON(this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/package.json`), pkgJson)
  }

  // install stage is used to run npm or yarn install scripts
  install() {
    this.yarnInstall([], {cwd: `${this.options.rootPath}/${this.props.adapterName}`})
  }

  // end is the last stage. can be used for messages or cleanup
  end() {
    this.log(`🚀 Adapter '${this.props.adapterName}' was successfully created. 📍${this.options.rootPath}/${this.props.adapterName}`)
  }

  private async _promptAdapterName(): Promise<string> {
    if (this.promptDisabled) {
      return 'example-adapter'
    }
    let { adapterName } = await this.prompt({
      type: 'input',
      name: 'adapterName',
      message: 'What is the name of adapter?:',
      default: 'example-adapter',
    })

    adapterName = this._normalizeStringInput(adapterName)
    if (adapterName === '') {
      this.log('Adapter name cannot be empty')
      return this._promptAdapterName()
    }
    return adapterName
  }

  private async _promptEndpointCount(): Promise<number> {
    if (this.promptDisabled) {
      return 1
    }
    let { endpointCount } = await this.prompt({
      type: 'input',
      name: 'endpointCount',
      message: 'How many endpoints does adapter have?:',
      default: '1',
    })

    endpointCount = parseInt(endpointCount)

    if (isNaN(endpointCount) || endpointCount <= 0) {
      this.log('Adapter should have at least one endpoint')
      return this._promptEndpointCount()
    }
    return endpointCount
  }

  private async _promptEndpointName(index): Promise<string> {
    if (this.promptDisabled) {
      return 'price'
    }
    const { inputEndpointName } = await this.prompt<{ inputEndpointName: string }>({
      type: 'input',
      name: 'inputEndpointName',
      message: `What is the name of endpoint #${index + 1}:`,
      default: 'price',
    })

    const endpointName = this._normalizeStringInput(inputEndpointName)

    if (endpointName === '') {
      this.log('Endpoint name cannot be empty')
      return this._promptEndpointName(index)
    }

    if (this.endpointsAndAliases.has(endpointName)) {
      this.log(`Endpoint named or aliased '${endpointName}' already exists`)
      return this._promptEndpointName(index)
    }

    return endpointName
  }

  private async _promptAliases(inputEndpointName): Promise<string[]> {
    if (this.promptDisabled) {
      return []
    }
    const { endpointAliasesAnswer } = await this.prompt<{ endpointAliasesAnswer: string }>({
      type: 'input',
      name: 'endpointAliasesAnswer',
      message: `Comma separated aliases for endpoint '${inputEndpointName}':`,
      default: 'empty',
    })
    let endpointAliases: string[]

    if (endpointAliasesAnswer === 'empty' || endpointAliasesAnswer.trim().length === 0) {
      return []
    } else {
      endpointAliases = [...new Set(...[endpointAliasesAnswer.split(',').map(a => this._normalizeStringInput(a.trim()))])]
    }

    let existingEndpoint = endpointAliases.some(a => this.endpointsAndAliases.has(a))
    if (existingEndpoint) {
      this.log(`One of endpoints already contains one or more provided aliases.`)
      return this._promptAliases(inputEndpointName)
    }
    return endpointAliases
  }

  private async _promptTransports(inputEndpointName: string): Promise<InputTransport[]> {
    if (this.promptDisabled) {
      return [
        {type: 'http',  name: 'httpTransport'}, { type: 'ws', name: 'wsTransport' }, {type: 'custom', name: 'customTransport',}
      ]
    }
    const { inputTransports } = await this.prompt<{ inputTransports: InputTransport[] }>({
      type: 'checkbox',
      name: 'inputTransports',
      message: `Select transports that endpoint '${inputEndpointName}' supports:`,
      choices: [
        {
          name: 'Http',
          value: {
            type: 'http',
            name: 'httpTransport',
          },
          checked: true,
        },
        {
          name: 'Websocket',
          value: {
            type: 'ws',
            name: 'wsTransport',
          },
        },
        {
          name: 'Custom',
          value: {
            type: 'custom',
            name: 'customTransport',
          },

        },
      ],
    })

    if (!inputTransports.length) {
      this.log('Endpoint should have at least one transport')
      return this._promptTransports(inputEndpointName)
    }
    return inputTransports
  }

  private async _promptConfirmation(adapterName: string, endpointNames: string): Promise<boolean> {
    if (this.promptDisabled) {
      return true
    }
    const { useComments } = await this.prompt({
      type: 'confirm',
      name: 'useComments',
      default: true,
      message: `Do you want helpful explicative comments to be included along with the source code? (These are usually not included with adapters but can be helpful if you're new to EA development):`,
    })

    const { confirmed } = await this.prompt({
      type: 'confirm',
      name: 'confirmed',
      message: `New adapter '${adapterName}' will be created with following endpoints '${endpointNames}'`,
    })

    if (!confirmed) {
      process.exit(0)
    }

    return useComments
  }

  //convert endpoint name to normalized name that can be used in imports/exports, i.e. crypto-one-two -> cryptoOneTwo
  _normalizeEndpointName(endpointName: string): string {
    const words = endpointName.split('-')

    const capitalizedWords = words.map((word, index) => {
      if (index === 0) {
        return word
      } else {
        return word.charAt(0).toUpperCase() + word.slice(1)
      }
    })
    return capitalizedWords.join('')
  }

  _normalizeStringInput(input: string): string {
    return input.trim().replace(/ /g, '-')
  }
}

