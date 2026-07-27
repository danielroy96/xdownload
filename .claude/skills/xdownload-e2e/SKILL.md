---
name: xdownload-e2e
description: >-
  Run the comprehensive end-to-end test suite for the xDownload app against the
  PRODUCTION Worker and site (https://xdownload.info). Use this whenever the
  user wants to test, verify, smoke-test, sanity-check, or confirm the health
  of xdownload — after a `wrangler deploy`, when downloads/playback are reported
  broken, when PROXY_BASE or the `/proxy` contract may have regressed, when the
  fxtwitter integration is suspect, or before/after any change to
  public/index.html or worker/worker.js. Covers the Worker proxy contract
  (CORS, Range, host allow-list, forced download), static hosting, the
  fxtwitter API integration, and the full browser user journey (paste → fetch →
  render → play → download).
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
- `/proxy` CORS preflight (`OPTIONS`) advertises `ACAO:*` + allowed methods/headers.
- `/proxy` on a **real** twimg video (discovered live via fxtwitter, so no
  rotting hardcoded URL): 200 with `ACAO:*` and a video content-type;
  `Range` → 206 + `Content-Range` (seekable playback); `&dl=` → `Content-Disposition:
  attachment` with a safe filename.

**Full-journey browser (`browser.e2e.spec.mjs`)**
- App shell loads (title, URL input, action button).
- An invalid URL surfaces the friendly validation error.
- Pasting a real post URL fetches, renders a `<video>` card, and the player
  `src` routes through the Worker `/proxy` (what makes playback beat twimg's
  hot-link 403s).
- The **Download** button produces a file named by the `<handle>_<id>.mp4`
  convention (asserted via Playwright's download event — no need to save 20 MB).

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
  in `public/index.html` is empty/misconfigured; playback and downloads will be
  unreliable.
- **fxtwitter tests fail** → the free public API changed shape or is down;
  `fetchVideos()` in the app will break the same way.

Reminder (from CLAUDE.md): editing `public/index.html` or `worker/worker.js`
changes **nothing** on the live site until `npx wrangler deploy`. These tests
hit the deployed Worker, so run them **after** deploying to verify a change.
