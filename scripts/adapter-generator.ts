#!/usr/bin/env node

import { resolve } from 'path'
import { execSync } from 'child_process'

const pathArg = process.argv[2] || ''

const generatorPath = resolve(__dirname, './generator-adapter')
const generatorCommand = `yo ${generatorPath} ${pathArg}  --ignore-version-check`

execSync(generatorCommand, { stdio: 'inherit' })
