import { defineConfig, devices } from '@playwright/test'

// Full-journey browser tests hit the LIVE site (default xdownload.info),
// so there is no local webServer to start. Point at a preview with BASE=…
export default defineConfig({
  testDir: '.',
  testMatch: /browser\.e2e\.spec\.mjs/,
  timeout: 90_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: (process.env.BASE || 'https://xdownload.info').replace(/\/+$/, ''),
    trace: 'retain-on-failure',
  },
})
