import { defineConfig } from 'vitest/config'

// Vitest config for the xDownload suite.
//
// Two kinds of code are tested, mirroring the old Jest setup:
//   • worker/worker.js — the Cloudflare Worker. Runs in the default `node`
//     environment by invoking its default export's fetch() handler.
//   • src/app.js — the Vue app options object. Runs in `jsdom` (browser globals)
//     — the test file selects it with a `// @vitest-environment jsdom` docblock.
//
// Per-file environment is chosen with that docblock (Vitest's equivalent of
// Jest's `@jest-environment`), so a single config serves both.
export default defineConfig({
  resolve: {
    // Match vite.config.js so importing src/app.js (which pulls in nothing from
    // Vue directly, but keep parity) resolves the same `vue` build in tests.
    alias: {
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  test: {
    environment: 'node', // default; app.test.js overrides to jsdom via docblock
    include: ['tests/**/*.{test,spec}.js'],
    setupFiles: ['tests/setup.js'],
    globals: true, // expose describe/it/expect/vi without imports (Jest-like)
    // Mock hygiene handled by Vitest so individual tests don't need teardown:
    clearMocks: true, // reset mock.calls between tests
    restoreMocks: true, // restore vi.spyOn'd methods to their originals
    unstubGlobals: true, // undo vi.stubGlobal('fetch', …) etc. after each test
    // jsdom needs a real origin so window.location.origin (used by PROXY_BASE in
    // src/app.js) mirrors production instead of the default about:blank.
    environmentOptions: {
      jsdom: { url: 'https://xdownload.info/' },
    },
    // Keep the CI reporting pipeline: emit JUnit to the same path Jest used, so
    // scripts/junit-to-summary.cjs and the Actions summary/check keep working.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['worker/worker.js', 'src/app.js'],
      reporter: ['text', 'lcov'],
    },
  },
})
