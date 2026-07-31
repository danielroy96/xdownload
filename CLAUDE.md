# CLAUDE.md

Guidance for working in the **xdownload** repo. Read this before making changes.

## What this is

xDownload is an X / Twitter video downloader. A user pastes a post URL, the app
fetches the post's media via the public **fxtwitter API**
(`api.fxtwitter.com`), and offers one-click download + in-page playback of any
videos/GIFs.

The whole thing is one **Cloudflare Worker** that does three jobs:

1. **Hosts the app** — the Vite build output in `dist/` is served via the Static
   Assets (`ASSETS`) binding. Requests matching a built file never hit the
   Worker code.
2. **Proxies video** — `GET /proxy?url=<twimg url>` fetches the video
   server-side, spoofs a `twitter.com` Referer to beat twimg's hot-link `403`,
   and re-serves the bytes with `Access-Control-Allow-Origin: *`. twimg sends
   no CORS headers, so this same-origin proxy is what makes downloads and
   seekable playback work. It is **not** an open proxy — locked to
   `video.twimg.com`, `pbs.twimg.com`, `amp.twimg.com`.
3. **Reports liveness** — `GET /health` → `200 {"status":"ok"}`. A cheap,
   dependency-free probe (no twimg/fxtwitter) for uptime monitors, so a green
   `/health` means "the Worker is running" independent of upstream.

Live at **https://xdownload.info**.

## Architecture — a Vite-built Vue app (read this)

The app is a **Vue 3 SPA built with Vite**. Vue (and `@vueuse/core`) are **npm
dependencies bundled and served from our own origin** — deliberately NOT loaded
from a third-party CDN. This is the core reliability decision: the app used to
load Vue from an unpinned `unpkg.com/vue@3` tag, and any unpkg blip or breaking
release blanked the whole client-rendered site ("site is down"). Bundling Vue
locally removes that single point of failure. **Do not reintroduce a CDN
`<script>` for Vue.** (Bootstrap CSS is still CDN-loaded but pinned, and a CSS
failure only degrades styling, not the app boot.)

The **DOM template still lives in `index.html`** inside `<div id="app">` and is
compiled at runtime. For that to work, `vite.config.js` aliases `vue` to
`vue/dist/vue.esm-bundler.js` (the build that ships the template compiler). This
keeps the large hand-tuned template byte-for-byte — no SFC/render-function
rewrite. If you change that alias to the runtime-only build, the app renders
nothing.

## Layout

- `index.html` — the Vite entry: `<head>` (meta/SEO/Turnstile/Bootstrap),
  the in-DOM Vue template inside `<div id="app" v-cloak>`, a hidden
  `#boot-fallback` + `<noscript>`, and one `<script type="module" src="/src/main.js">`.
- `src/app.js` — the Vue app **options object** (`setup`/`data`/`computed`/
  `mounted`/`methods`) plus `PROXY_BASE` and `ADSENSE_SLOT`. Exported so tests
  import it directly. This is where nearly all app logic lives.
- `src/main.js` — bootstrap: imports Vue + `appOptions` + `page.css`, mounts, and
  arms the boot fail-safe.
- `src/boot.js` — boot fail-safe helpers (`revealFallback`, `appMounted`,
  `startBootWatchdog`). Split out so they're unit-testable without mounting Vue.
- `src/styles/page.css` — page-specific styles (was the inline `<style>`).
- `static/` — Vite `publicDir`: copied verbatim to `dist/` root. Holds
  `brand.css` (shared identity, also linked by `privacy.html`), `robots.txt`,
  `sitemap.xml`, `ads.txt`. Their canonical URLs (`/brand.css`, `/ads.txt`) must
  stay stable — the ad network (ads.txt) & SEO depend on them, so they are NOT hashed.
- `privacy.html` — static privacy/cookies page (a second Vite input; no JS).
- `dist/` — **build output** the Worker serves (gitignored).
- `worker/worker.js` — the Worker: `/health` + `/proxy` handlers + static-asset
  fallthrough.
- `vite.config.js`, `vitest.config.js` — build + test config.
- `wrangler.jsonc` — Worker config (name `xdownload`, `main`, ASSETS binding →
  `dist`, a `build.command` that runs `npm run build`, `xdownload.info`
  custom-domain route).
- `tests/` — the **Vitest** suite (`worker.test.js`, `app.test.js`,
  `boot.test.js`, `helpers/makeInstance.js`, `setup.js`). See Testing.
- `.github/workflows/` — `ci.yml` (build + test on push/PR), `uptime.yml`
  (scheduled production health check + auto-alert).
- `scripts/` — `junit-to-summary.cjs` (renders the CI test report),
  `smoke.mjs` (post-deploy smoke check).
- `.claude/launch.json` — local dev server (see below).

## Running & verifying locally

`npm install` first. Then the preview dev server (config `xdownload` in
`.claude/launch.json`) runs **`npm run dev`** (Vite, `http://localhost:5173`).
For a production-fidelity check use `npm run build && npm run preview` (serves
`dist/`), or `npx wrangler dev` (builds `dist/`, serves it **and** `/proxy` +
`/health`).

Note the Vite dev/preview servers don't run the Worker, so `/proxy` and
`/health` don't exist there — but `PROXY_BASE` is now `window.location.origin`,
so downloads/playback fall through to the public-proxy fallbacks in dev. Use
`wrangler dev` when you need the real proxy locally.

## Testing

Run the unit suite with **`npm test`** (Vitest; `vitest run`). Per-file
environment is chosen with a `// @vitest-environment node|jsdom` docblock.
Coverage:

- `tests/worker.test.js` (node) — the Worker's `/health` + `/proxy` contract
  (host allow-list, CORS/preflight, Range forwarding, forced download, the
  Turnstile download gate, edge caching, upstream failure). Imports `worker.js`
  directly; mocks `fetch` with `vi.spyOn`.
- `tests/app.test.js` (jsdom) — the app logic, imported from `src/app.js` via
  `tests/helpers/makeInstance.js` (which runs `setup()`/`data()`/`computed`/
  `methods` like Vue). Mocking uses Vitest throughout (`vi.stubGlobal('fetch',…)`,
  `vi.spyOn`); `vitest.config.js` enables `unstubGlobals`/`restoreMocks`, so
  tests need no manual teardown.
- `tests/boot.test.js` (jsdom) — the boot fail-safe / watchdog.
- `tests/setup.js` — installs an in-memory `localStorage` (Node 26 ships a global
  `localStorage` that shadows jsdom's and needs a file flag). VueUse's
  `useLocalStorage` reads `window.localStorage` under the hood.

Keep test names as full human-readable scenarios — `scripts/junit-to-summary.cjs`
groups the CI report by the top-level `describe` (feature) and lists each test as
a scenario. CI (`.github/workflows/ci.yml`) runs `npm run build` then `npm test`
on every push and PR; **`main` has branch protection requiring the "Run Jest
Tests" check** (the job name is historical/load-bearing — it now runs Vitest;
don't rename it without updating branch protection). Add/adjust tests when you
change behavior — match the existing describe/scenario style.

There is also a comprehensive production **E2E skill** (`xdownload-e2e`): a
zero-dep worker/HTTP layer + a Playwright browser journey that hit the live site.
Run it after deploying.

## Deploying — IMPORTANT

- Deploy from the repo root: **`npm run deploy`** (= `vite build` → `wrangler
  deploy` → `node scripts/smoke.mjs` post-deploy smoke check), or `npx wrangler
  deploy` directly (its `build.command` runs `npm run build` first). Requires
  Cloudflare auth; if not cached, `npx wrangler login`.
- **Editing source changes nothing on the live site until you rebuild + redeploy
  the Worker.** The Worker serves the built `dist/`.
- Deploy/commit/push only when the user asks. Treat any GitHub→Cloudflare
  auto-deploy as unreliable and prefer explicit `npm run deploy`.
- Verify live health: `curl https://xdownload.info/health` → `{"status":"ok"}`;
  `curl https://xdownload.info/proxy` → `400 {"error":"missing ?url parameter"}`;
  `/proxy?url=<non-twimg>` → `403 host not allowed`.
- To complete a deployment, verify all changes satisfy the tests in the
  `xdownload-e2e` skill.

## Key gotcha: PROXY_BASE

`PROXY_BASE` in `src/app.js` is now **`window.location.origin`** — derived from
whatever origin serves the app, so the app and `/proxy` are always same-origin
and it can never point at a dead absolute host. This replaced a hardcoded
absolute URL that had silently broken the whole site before (it was once a
`*.workers.dev` subdomain that 404'd — Cloudflare error 1042). **Keep it
origin-derived**; don't hardcode an absolute origin back in.

## Download strategy (in src/app.js)

`downloadVideo()` tries an ordered chain and stops at the first success:
own Worker `/proxy` → direct fetch → several public CORS proxies → finally a
`rel="noreferrer"` `<a download>` that opens the video for manual save. Each
fetch has a timeout and validates the blob (size ≥ 100 KB, video-ish MIME) so a
dead proxy or HTML error page can't stall or masquerade as success. Always
prefer the highest-bitrate progressive **MP4** — never the `.m3u8` HLS
playlist.

## Reliability / anti-downtime measures

- Vue bundled from our own origin (no CDN SPOF) — see Architecture.
- `PROXY_BASE` origin-derived — see the gotcha above.
- Boot fail-safe (`src/boot.js` + `#boot-fallback` + `v-cloak`): a failed mount
  reveals a static message instead of a blank page.
- `/health` endpoint + `.github/workflows/uptime.yml`: a scheduled probe every
  ~15 min that opens/updates a dedup'd GitHub issue on failure (and closes it on
  recovery).
- `scripts/smoke.mjs` runs in `npm run deploy` so a bad deploy fails loudly.

## Conventions & preferences

- **Match the existing comment style.** `worker.js` and `src/*` are heavily,
  deliberately commented — explaining *why* (CORS, hot-link 403s, fallback
  ordering, the Vue-bundling decision), not just *what*. Keep that density.
- **Visual style is xDownload's own brand** (deliberately rebranded *away* from
  X — no X logo/palette). The identity lives in `static/brand.css` `:root`:
  indigo-violet accent (`--brand: #6d5efc`), teal secondary (`--brand-2:
  #00c2a8`), gradient buttons (`.btn-brand`), rounded cards, Plus Jakarta Sans.
  Reuse those CSS vars; don't reintroduce the old X black/blue look or a new
  palette.
- **Keep Vue (and other framework deps) bundled from our own origin** — the
  build exists specifically to avoid a third-party CDN SPOF. Add npm deps as
  needed, but don't move the core framework back to a runtime CDN `<script>`.
- Any executable inline `<script>` must live **outside** Vue's `#app` root — Vue
  strips inline scripts inside its template (this is why the Adsterra banner is
  injected from the `mounted()` hook, and the module entry / boot fallback sit after
  `</div>`). The `application/ld+json` block is data, not executable, so it's
  fine in `<head>`.

## Monetization / third parties

- **Ads: Adsterra (display banner only).** AdSense was dropped — Google rejected
  the site under "Google-served ads on screens without publisher content" (the
  standard rejection for downloader/utility tools). Adsterra accepts this
  category with no traffic minimum. Config is the `ADSTERRA_*` consts in
  `src/app.js`. Two fixed-size zones are served and swapped by viewport: the
  desktop leaderboard (`ADSTERRA_KEY`/`_WIDTH`/`_HEIGHT`, 728×90) and a narrow
  mobile banner (`ADSTERRA_MOBILE_*`, 160×300) used at/below `ADSTERRA_MOBILE_MAX`
  px (`initAds()`→`activeAdZone()` picks, `injectAdZone()` renders, and it
  re-injects when the viewport crosses the breakpoint). `ADS_ENABLED` is true only
  once a real hex zone key replaces the `'PLACEHOLDER'` sentinel; `MOBILE_ADS_ENABLED`
  gates the mobile zone (placeholder → the desktop zone is scaled down instead).
  Adsterra's banner is two `<script>`s ending in `document.write`, which can't go
  in the page directly (Vue strips inline `<script>` inside `#app`, and
  `document.write` after load wipes the document) — so `initAds()` (called from
  `mounted()`) injects them into a sandboxed `<iframe>` it creates in
  `#ad-banner`, where `document.write` targets the iframe's own document. Only the
  plain display banner is used — **no popunders / interstitials / social-bar**
  (keeps the clean brand UX). `showAds` (v-if on the slot) + `ADS_ENABLED` keep
  the slot hidden entirely while the key is the placeholder, so dev/preview and
  the pre-approval build show no empty ad box. To go live: create an Adsterra
  Banner unit sized `ADSTERRA_WIDTH×ADSTERRA_HEIGHT` (default 300×250), paste its
  key into `ADSTERRA_KEY`, paste Adsterra's ads.txt block into `static/ads.txt`,
  then rebuild+deploy.
- fxtwitter API is unauthenticated and free; error codes are mapped to friendly
  messages in `fetchVideos()`.
- A discreet, dismissible cookie notice (persisted via VueUse `useLocalStorage`
  under key `cookieNoticeAck`) and the privacy page exist for ad-network/privacy
  compliance.
- **Cloudflare Turnstile** gates video **downloads** (bot protection). The
  `cf-turnstile` widget (site key in `index.html`) mints a token that
  `downloadVideo()` sends to `/proxy` as a `cf-turnstile-response` header; the
  Worker verifies it via `challenges.cloudflare.com/turnstile/v0/siteverify`
  using **`env.TURNSTILE_SECRET`** and only serves download requests (`dl=`) on
  `success === true`, failing closed. Playback (`/proxy` without `dl=`) is
  deliberately **not** gated (a `<video>` can't carry a single-use token across
  range/seek). Set the secret with `npx wrangler secret put TURNSTILE_SECRET`
  before deploying, or Worker-proxy downloads 403.
