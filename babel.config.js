// Babel is used ONLY by the Jest test harness (via babel-jest) so that we can
// `require()` the ES-module Worker (worker/worker.js uses `export default`) and
// write modern JS in the test files. The shipped app is NOT transpiled — it's
// served verbatim from public/. See CLAUDE.md.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}
