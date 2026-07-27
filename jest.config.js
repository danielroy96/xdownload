// Jest config for the xDownload test suite.
//
// Two kinds of code get tested:
//   • worker/worker.js — a Cloudflare Worker (Node-like). Tested in the default
//     "node" environment by invoking its default export's fetch() handler.
//   • public/index.html — the single-file Vue app. Its inline <script> is
//     evaluated in a jsdom environment (browser globals) via a small loader.
//
// Per-file environment is selected with a `@jest-environment` docblock at the
// top of each test file, so we keep a single config here.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['worker/worker.js', 'public/index.html'],
  clearMocks: true,
}
