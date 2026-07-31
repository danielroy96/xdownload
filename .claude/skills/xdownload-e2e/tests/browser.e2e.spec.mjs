/**
 * xDownload — full-journey browser E2E (production), via Playwright.
 * ------------------------------------------------------------------
 * Drives the LIVE deployed app in a real Chromium: paste a post URL → fetch
 * via fxtwitter → a video card renders → playback routes through the Worker
 * `/proxy` → the Download button produces a correctly-named file. This is the
 * actual user story the worker-level tests can only approximate.
 *
 * Playwright is NOT a repo dependency (the app is deliberately dep-free); it's
 * installed on demand by run.sh into the skill's own node_modules, so the repo
 * stays clean. Target is configurable:
 *   BASE=https://xdownload.info npx playwright test   (default)
 */
import { test, expect } from '@playwright/test'

const BASE = (process.env.BASE || 'https://xdownload.info').replace(/\/+$/, '')
const SAMPLE_URL = 'https://x.com/SpaceX/status/1732824684683784516'

const urlInput = (page) => page.locator('input[type="url"]')
// The primary action button ("Fetch" / "Paste & Fetch") is the first .btn-brand.
// (The app was rebranded away from X — buttons are `.btn-brand`, not `.btn-x`.)
const primaryBtn = (page) => page.locator('button.btn-brand').first()

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await expect(urlInput(page)).toBeVisible()
})

test('loads the app shell (title + input + action button)', async ({ page }) => {
  await expect(page).toHaveTitle(/download/i)
  await expect(primaryBtn(page)).toBeVisible()
})

test('the Vue app actually mounts (guards against the blank-page outage)', async ({ page }) => {
  // Vue strips the `v-cloak` attribute from #app on a successful mount, so its
  // disappearance is direct proof the bundle loaded, compiled the in-DOM
  // template, and mounted — the failure mode ("site is down" = blank page) that
  // the unit tests can't observe. Since Vue now ships from our OWN origin
  // (bundled by Vite, not a third-party CDN), this is the regression guard for
  // the whole reason this project moved to a build.
  const app = page.locator('#app')
  await expect.poll(async () => app.getAttribute('v-cloak'), { timeout: 15_000 }).toBeNull()
  // And the boot-failure fallback must stay hidden when the app mounts fine.
  await expect(page.locator('#boot-fallback')).toBeHidden()
})

test('embeds the Cloudflare Turnstile widget (download bot-gate)', async ({ page }) => {
  // The widget must be present with our site key + the analytics action tag.
  const widget = page.locator('.cf-turnstile')
  await expect(widget).toHaveCount(1)
  await expect(widget).toHaveAttribute('data-action', 'turnstile-spin-v2')
  // The Turnstile script binds by injecting its hidden response input into the
  // div — proof it initialised (rather than the div sitting inert).
  await expect(page.locator('.cf-turnstile input[name="cf-turnstile-response"]')).toBeAttached({ timeout: 15_000 })
})

test('invalid URL surfaces the friendly validation error', async ({ page }) => {
  await urlInput(page).fill('https://example.com/not-a-post')
  await primaryBtn(page).click()
  await expect(page.getByText(/valid X post URL/i)).toBeVisible()
})

test('full flow: fetch a real post → video renders → playback via /proxy', async ({ page }) => {
  await urlInput(page).fill(SAMPLE_URL)
  await primaryBtn(page).click()

  // A video card must appear.
  const video = page.locator('.video-player-wrap video')
  await expect(video).toBeVisible({ timeout: 30_000 })

  // Playback source must route through the Worker proxy — that's what makes
  // seekable playback survive twimg's hot-link 403s (playSrc → proxied()).
  const src = await video.getAttribute('src')
  expect(src, 'player src should route through the Worker /proxy').toMatch(/\/proxy\?url=/)

  // "N video(s) found" summary renders (the header label).
  await expect(page.locator('.section-label').getByText(/video.*found/i)).toBeVisible()
})

test('full flow: Download button routes through the Turnstile-gated Worker /proxy', async ({ page }) => {
  await urlInput(page).fill(SAMPLE_URL)
  await primaryBtn(page).click()

  const card = page.locator('.result-card').filter({ has: page.locator('.video-player-wrap video') }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })

  // We deliberately DON'T assert a completed file download here. Downloads are
  // Turnstile-gated, and Turnstile is a bot gate — it refuses tokens to
  // automated browsers (Playwright sets navigator.webdriver=true; the widget
  // fails with error 600010 and mints no token). So a headless run can never
  // obtain a valid token, the Worker /proxy download 403s, and the (mostly dead)
  // public-proxy fallbacks can't cover — the chain ends at "open in a new tab"
  // with no download event. That's the gate working as intended, not a bug.
  //
  // What IS verifiable from a bot browser — and what this test pins — is the
  // *wiring*: clicking Download issues a Worker /proxy request for this video
  // with the forced-download `dl=` param, and the gate rejects the tokenless
  // bot request with 403. Real (human) users clear the widget, get a token, and
  // that same request returns 200 with the file. Delivery for real users is
  // confirmed manually / by the worker-layer + unit gate tests, not here.
  const downloadBtn = card.locator('button.btn-brand')
  const [proxyResp] = await Promise.all([
    page.waitForResponse((r) => /\/proxy\?.*\bdl=/.test(r.url()), { timeout: 30_000 }),
    downloadBtn.click(),
  ])
  expect(proxyResp.url()).toMatch(/\/proxy\?url=/)
  expect(proxyResp.status(), 'tokenless bot download must be gated (403)').toBe(403)
})
