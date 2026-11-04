module.exports = {
  modulePathIgnorePatterns: ['./dist'],
  // Jest's module loader can't `require()` ESM. Packages listed in the negative lookahead below
  // ship ESM-only (or ESM-first) builds, so they are excluded from the ignore list and transformed
  // to CommonJS by babel-jest.
  transformIgnorePatterns: ['/node_modules/(?!(cookie|eventsource|eventsource-parser)/)'],
}
