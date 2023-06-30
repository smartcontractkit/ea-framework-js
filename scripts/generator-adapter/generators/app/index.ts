import * as Generator from 'yeoman-generator'
interface Transport {
  type: string
  name: string
}
interface Endpoint {
  endpointName: string
  normalizedEndpointName: string
  transports: Transport[],
  endpointAliases: string
  normalizedEndpointNameCap: string
}

module.exports = class extends Generator {
  props: {
    frameworkVersion: string
    adapterName: string,
    endpoints: Record<string, Endpoint>,
    endpointNames: string,
    defaultEndpoint: Endpoint
  }

  constructor(args, opts) {
    super(args, opts);
    this.argument("rootPath", { type: String, required: false, default: './', description: 'Root path where new External Adapter will be created'});
  }
  async prompting() {
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

    const endpoints: Record<string, Endpoint> = {}
    for (let i = 0; i < endpointCount; i++) {
      let { endpointName } = await this.prompt<{endpointName: string}>({
        type: "input",
        name: "endpointName",
        message: `What is the name of endpoint #${i+1}:`,
        default: "price"
      })

      endpointName = this._normalizeStringInput(endpointName)

      if (endpointName === '') {
        throw new Error('Endpoint name cannot be empty')
      }

      const existingEndpoint = Object.values(endpoints).find(e => e.endpointName === endpointName)
      if (existingEndpoint) {
        throw new Error(`There is already configured endpoint with name '${endpointName}'`)
      }

      const { endpointAliasesAnswer } = await this.prompt<{endpointAliasesAnswer: string}>({
        type: "input",
        name: "endpointAliasesAnswer",
        message: `Comma separated aliases for endpoint '${endpointName}':`,
        default: "empty"
      })
      let endpointAliases

      if (endpointAliasesAnswer === 'empty') {
        endpointAliases = []
      }else {
        endpointAliases = endpointAliasesAnswer.split(',')
      }

      const { transports } = await this.prompt<{transports: Transport[]}>(   {
        type: "checkbox",
        name: "transports",
        message: `Select transports that endpoint '${endpointName}' supports:`,
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

          }
        ]
      })

      if (!transports.length) {
        throw new Error('Endpoint should have at least one transport')
      }

      endpoints[i] = {
        endpointName,
        normalizedEndpointName: this._normalizeEndpointName(endpointName),
        transports,
        normalizedEndpointNameCap: '',
        endpointAliases: JSON.stringify(endpointAliases)
      }
      endpoints[i].normalizedEndpointNameCap = endpoints[i].normalizedEndpointName.charAt(0).toUpperCase() + endpoints[i].normalizedEndpointName.slice(1)
    }

    const endpointNames = Object.values(endpoints).map(e => e.normalizedEndpointName).join(', ')

    const { confirmed }  = await this.prompt({
      type: "confirm",
      name: "confirmed",
      message: `New adapter '${adapterName}' will be created with following endpoints '${endpointNames}'`
    })

    if(!confirmed) {
      process.exit(0)
    }

    this.props = {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      frameworkVersion: (await import('../../../package.json')).version,
      adapterName,
      endpoints,
      endpointNames,
      defaultEndpoint: endpoints[0],
    };
  }
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
    Object.values(this.props.endpoints).forEach(({endpointName, transports, endpointAliases}) => {
      if (transports.length > 1) {
        // Router endpoints
        this.fs.copyTpl(
          this.templatePath('src/endpoint/endpoint-router.ts'),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/${endpointName}.ts`),
          {endpointName, transports, endpointAliases, adapterName: this.props.adapterName}
        );

        transports.forEach(transport => {
          this.fs.copyTpl(
            this.templatePath(`src/transport/${transport.type}.ts`),
            this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/transport/${endpointName}-${transport.type}.ts`),
            {endpointName}
          );
        })
      }else {
        // Single transport endpoints
        this.fs.copyTpl(
          this.templatePath('src/endpoint/endpoint.ts'),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/endpoint/${endpointName}.ts`),
          {endpointName, transports, endpointAliases, adapterName: this.props.adapterName}
        );

        this.fs.copyTpl(
          this.templatePath(`src/transport/${transports[0].type}.ts`),
          this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/src/transport/${endpointName}.ts`),
          {endpointName}
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
    const httpEndpoints = Object.values(this.props.endpoints).filter((e: Endpoint) => e.transports.some(t => t.type === 'http'))
    const wsEndpoints = Object.values(this.props.endpoints).filter((e: Endpoint) => e.transports.some(t => t.type === 'ws'))

    // Create adapter.test.ts if there is at least one endpoint with httpTransport
    if (httpEndpoints.length) {
      this.fs.copyTpl(
        this.templatePath(`test/adapter.test.ts`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/adapter.test.ts`),
        {httpEndpoints}
      );
    }

    // Create adapter.test.ts or adapter-ws.test.ts if there is at least one endpoint with wsTransport
    if (wsEndpoints.length) {
      let fileName = 'adapter.test.ts'
      if (httpEndpoints.length) {
        fileName = 'adapter-ws.test.ts'
      }
      this.fs.copyTpl(
        this.templatePath(`test/adapter-ws.test.ts`),
        this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/${fileName}`),
        {wsEndpoints}
      );
    }

    // Copy test fixtures
    this.fs.copyTpl(
      this.templatePath(`test/fixtures.ts`),
      this.destinationPath(`${this.options.rootPath}/${this.props.adapterName}/test/integration/fixtures.ts`),
      {includeWsFixtures: wsEndpoints.length > 0, includeHttpFixtures: httpEndpoints.length > 0}
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
  install() {
    this.yarnInstall()
  }
  end() {
    console.info(`🚀 Adapter '${this.props.adapterName}' was successfully created.📍${this.options.rootPath}/${this.props.adapterName}`)
  }

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

