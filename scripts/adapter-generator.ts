#!/usr/bin/env node

import { resolve } from 'path'
import { execSync } from 'child_process'

const pathArg = process.argv[2] || ''

const generatorPath = resolve(__dirname, './generator-adapter/generators/app/index.js')
const generatorCommand = `yo ${generatorPath} ${pathArg}`

execSync(generatorCommand, { stdio: 'inherit' })
