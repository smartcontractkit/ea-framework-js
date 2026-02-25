#!/usr/bin/env node

import { resolve } from 'path'
import { execFileSync } from 'child_process'

const pathArg = process.argv[2] || ''

const generatorPath = resolve(__dirname, './generator-adapter/generators/app/index.js')
const args = [generatorPath]
if (pathArg) {
  args.push(pathArg)
}
execFileSync('yo', args, { stdio: 'inherit' })
