module.exports = {
  modulePathIgnorePatterns: ['./dist'],
  // `cookie` v2 (pulled in by fastify -> light-my-request) is ESM-only. Jest's module loader
  // can't `require()` ESM, so let babel-jest transform that package to CommonJS.
  transformIgnorePatterns: ['/node_modules/(?!cookie/)'],
}
