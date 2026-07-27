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
  // Reporters: keep Jest's normal console output ('default'), and also emit a
  // JUnit XML report. CI consumes reports/junit.xml two ways — dorny/test-reporter
  // turns it into a per-test Check run, and a small script renders it into the
  // Actions run summary. See .github/workflows/ci.yml.
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'reports',
      outputName: 'junit.xml',
      // By default jest-junit bakes the whole "describe + test" path into every
      // testcase's classname, which flattens the report. Split them: the
      // describe block becomes the group (classname), the test title stays on
      // its own. That gives dorny clean per-feature headings and lets our
      // summary script group by feature. suiteNameTemplate labels the two
      // file-level suites by filename rather than their first describe.
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      suiteNameTemplate: '{filename}',
    }],
  ],
}
