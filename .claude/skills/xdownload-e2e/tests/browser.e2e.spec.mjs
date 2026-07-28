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

test('full flow: Download button produces a correctly-named file', async ({ page }) => {
  await urlInput(page).fill(SAMPLE_URL)
  await primaryBtn(page).click()

  const card = page.locator('.result-card').filter({ has: page.locator('.video-player-wrap video') }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })

  const downloadBtn = card.locator('button.btn-brand')
  // The download chain fetches through the proxy then triggers a same-origin
  // <a download> save — Playwright observes that as a download event. We assert
  // it fires with the buildFilename() convention (<handle>_<id>.mp4) without
  // waiting for the full ~20 MB body to land on disk.
  //
  // Downloads are Turnstile-gated now. In practice the Worker /proxy is the only
  // reliable path (the public-proxy fallbacks are mostly dead), so a file only
  // lands when the widget's token VERIFIES — i.e. the widget renders on this
  // domain (xdownload.info in the widget's allowed-domains) AND TURNSTILE_SECRET
  // is bound to the Worker. If this test times out with no download event, that
  // configuration is incomplete: the widget mints no token → /proxy 403s → the
  // chain ends at "open in a new tab" (no download event). The gate's own
  // fail-closed behavior is pinned deterministically by the worker layer.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    downloadBtn.click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^SpaceX_\d+\.mp4$/)
})
