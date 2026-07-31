---
name: xdownload-e2e
description: >-
  Run the comprehensive end-to-end test suite for the xDownload app against the
  PRODUCTION Worker and site (https://xdownload.info). Use this whenever the
  user wants to test, verify, smoke-test, sanity-check, or confirm the health
  of xdownload — after a `wrangler deploy`, when downloads/playback are reported
  broken, when PROXY_BASE or the `/proxy` contract may have regressed, when the
  fxtwitter integration is suspect, or before/after any change to the app
  (src/*, index.html) or worker/worker.js. Covers the Worker /health + /proxy
  contract (CORS, Range, host allow-list, forced download), static hosting of
  the Vite build, that the Vue app actually mounts, the fxtwitter API
  integration, and the full browser user journey (paste → fetch → render → play
  → download).
---

# xDownload end-to-end tests

Runs a comprehensive E2E suite against the **live** xDownload Worker and app.
Everything targets production URLs by default (`https://xdownload.info`) — these
are true end-to-end tests, not unit tests against local stubs.

## Why two layers

The app is one Cloudflare Worker doing two jobs (host the static Vue app; proxy
twimg video). The suite mirrors that split:

1. **Worker + integration layer** — `tests/worker.e2e.mjs`, Node's built-in test
   runner (`node --test`) with `fetch`. **Zero dependencies**, matching the
   repo's dep-free ethos. This is the deterministic backbone: it pins the
   `/proxy` contract (the thing every download/playback depends on) and the
   fxtwitter integration. Always runs.
2. **Full-journey browser layer** — `tests/browser.e2e.spec.mjs`, Playwright
   driving real Chromium through the actual user story. Playwright is **not** a
   repo dependency; it's installed on demand into this skill's own
   `node_modules`, so the repo stays clean.

## Running

From this skill directory (`.claude/skills/xdownload-e2e/`):

```bash
./run.sh            # worker/HTTP layer only (fast, zero-install) — the default
./run.sh browser    # full browser journey (first run installs Playwright+Chromium)
./run.sh all        # both layers
```

Point at a preview/staging deploy instead of production with `BASE`:

```bash
BASE=https://xdownload.<subdomain>.workers.dev ./run.sh all
```

The worker layer alone is the right quick check after a deploy. Run `all` (or
`browser`) when you need to prove the real download/playback UX in a browser.

## What each layer asserts

**Worker + integration (`worker.e2e.mjs`)**
- fxtwitter returns a video post with a usable progressive **MP4** variant, and
  `bestMp4Url()` never selects the `.m3u8` HLS playlist (mirrors index.html).
- A nonexistent post yields JSON `{code: 404}` the app can map to a message.
- Static hosting: `GET /` serves the Vue app (`id="app"` present); `/privacy.html`
  serves (AdSense compliance page).
- `/proxy` rejections: missing `?url` → 400; malformed → 400; non-twimg host →
  403; non-https → 403; `POST` → 405 — the guards that keep it from being an
  open proxy.
- `/proxy` CORS preflight (`OPTIONS`) advertises `ACAO:*` + allowed methods and
  headers (including `cf-turnstile-response`, sent on gated downloads).
- `/proxy` on a **real** twimg video (discovered live via fxtwitter, so no
  rotting hardcoded URL): 200 with `ACAO:*` and a video content-type;
  `Range` → 206 + `Content-Range` (seekable playback). Playback is **not** gated.
- `/proxy` **download gate**: a `&dl=` request with no Turnstile token, and with
  a bogus token, both → 403 (the gate fails closed). The safe-filename shaping
  that runs *after* the gate passes is covered by the unit suite (mocks
  siteverify), since a real token can't be minted headlessly (see below).
- `/proxy` edge caching: a full (non-Range) GET carries a long-lived, immutable
  `Cache-Control` (Cloudflare edge + browser caching of immutable twimg media);
  a `Range` 206 is **not** marked immutable (partial bodies stay uncached).

**Full-journey browser (`browser.e2e.spec.mjs`)**
- App shell loads (title, URL input, action button).
- The Cloudflare Turnstile widget is embedded (site key + `data-action` +
  its injected `cf-turnstile-response` input).
- An invalid URL surfaces the friendly validation error.
- Pasting a real post URL fetches, renders a `<video>` card, and the player
  `src` routes through the Worker `/proxy` (what makes playback beat twimg's
  hot-link 403s).
- The **Download** button routes through the Turnstile-gated Worker `/proxy`
  (a `&dl=` request is issued and, for this automated browser, gated → 403).
  **We do not assert a completed file download**: Turnstile is a bot gate and
  refuses tokens to automated browsers (Playwright → `navigator.webdriver=true`
  → widget error `600010`, no token), so a headless run can never obtain a valid
  token. Real (human) users clear the widget and download normally; verify that
  path manually. The gate's fail-closed behavior is pinned by the worker layer.

## Sample post

Tests use a known-stable public post with a video:
`https://x.com/SpaceX/status/1732824684683784516`. If X ever removes it,
update `SAMPLE` in `tests/worker.e2e.mjs` and `SAMPLE_URL` in
`tests/browser.e2e.spec.mjs` to any live post that contains a video.

## Interpreting failures

- **All `/proxy` real-video tests fail but rejections pass** → the Worker is up
  but upstream twimg fetch or the sample post broke. Check the sample post is
  still live; try another video post.
- **Every worker test fails / connection errors** → the Worker/domain is down or
  `PROXY_BASE` regressed (see CLAUDE.md — this has silently broken the site
  before). Verify with `curl https://xdownload.info/proxy` → expect
  `400 {"error":"missing ?url parameter"}`.
- **Browser: player `src` is a raw twimg URL, not `/proxy?...`** → `PROXY_BASE`
  in `src/app.js` is misconfigured; playback and downloads will be unreliable.
- **Browser: the "Vue app actually mounts" test fails / the page is blank** →
  the built bundle failed to load or mount (`#app` keeps its `v-cloak`); the
  boot fallback should show. Check the build output and console.
- **fxtwitter tests fail** → the free public API changed shape or is down;
  `fetchVideos()` in the app will break the same way.
- **Worker `&dl=` gate tests fail (a tokenless/bogus-token download is NOT 403)**
  → either `TURNSTILE_SECRET` isn't bound to the Worker (`wrangler secret list`)
  or the gate was removed. A live gate must fail closed on a bad/absent token.
- **Browser download test fails with a `110200` in the console** → the widget's
  allowed-domains list is missing the target host (`xdownload.info` /
  `localhost`); real users are blocked too. Fix it in the Turnstile dashboard.
  (Error `600010` is different — it's Turnstile correctly refusing the automated
  browser; that's expected and the test accounts for it.)

Reminder (from CLAUDE.md): editing the app (`src/*`, `index.html`) or
`worker/worker.js` changes **nothing** on the live site until the app is rebuilt
and redeployed (`npm run deploy`, or `npx wrangler deploy` which builds first).
These tests hit the deployed Worker, so run them **after** deploying.
