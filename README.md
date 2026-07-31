# xDownload — X / Twitter Video Downloader

A dead-simple web app for downloading videos and GIFs from X (formerly Twitter)
posts. Paste a post URL, and the app extracts its media via the public
[fxtwitter API](https://github.com/FxEmbed/FxEmbed), plays it inline, and offers
a one-click download.

**Live at [xdownload.info](https://xdownload.info).**

## How it works

The whole thing is a single **Cloudflare Worker** doing three jobs:

1. **Hosts the app** — the Vite build output in `dist/` is served via the
   Worker's Static Assets binding.
2. **Proxies video** — `GET /proxy?url=<twimg url>` fetches the video
   server-side, spoofs a `twitter.com` Referer to beat twimg's hot-link `403`,
   and re-serves the bytes with `Access-Control-Allow-Origin: *`. twimg sends no
   CORS headers, so this same-origin proxy is what makes downloads and seekable
   playback work. It is **not** an open proxy — it's locked to `video.twimg.com`,
   `pbs.twimg.com`, and `amp.twimg.com`, and immutable media is edge-cached.
3. **Reports liveness** — `GET /health` → `{"status":"ok"}`, a cheap probe for
   uptime monitors (independent of X/twimg).

The app is a **Vue 3 SPA built with Vite**. Vue and `@vueuse/core` are **bundled
and served from our own origin** — deliberately not from a third-party CDN,
because a CDN blip on the framework used to blank the whole client-rendered site.
(Bootstrap CSS is still CDN-loaded but pinned.)

## Layout

| Path | What it is |
|---|---|
| `index.html` | Vite entry: `<head>` + the in-DOM Vue template in `<div id="app">` + a module script + a boot fallback. |
| `src/app.js` | The Vue app options (logic) + `PROXY_BASE`/`ADSENSE_SLOT`. |
| `src/main.js`, `src/boot.js` | Bootstrap + mount, and the boot fail-safe. |
| `src/styles/page.css` | Page-specific styles. |
| `static/` | Copied verbatim to the site root: `brand.css`, `robots.txt`, `sitemap.xml`, `ads.txt`. |
| `privacy.html` | Static privacy / cookies page (AdSense compliance). |
| `dist/` | Vite build output — what the Worker serves (gitignored). |
| `worker/worker.js` | The Worker: `/health` + `/proxy` handlers + static-asset fallthrough. |
| `wrangler.jsonc` | Worker config (name, `main`, ASSETS binding → `dist`, build hook, custom-domain route). |
| `tests/` | Vitest unit tests for the Worker, the app logic, and the boot fail-safe. |
| `.github/workflows/` | `ci.yml` (build + test on push/PR) and `uptime.yml` (scheduled prod health check + alert). |
| `.claude/skills/xdownload-e2e/` | End-to-end test suite that runs against the **live** site. |

## Develop

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
```

For a production-fidelity check: `npm run build && npm run preview`, or
`npx wrangler dev` (builds `dist/` and serves it **plus** `/proxy` + `/health`).

The Vite dev/preview servers don't run the Worker, so `/proxy` and `/health`
don't exist there — but `PROXY_BASE` is `window.location.origin`, so
downloads/playback fall through to the public-proxy fallbacks in dev.

> **Gotcha:** `PROXY_BASE` (in `src/app.js`) is `window.location.origin`, so the
> app and `/proxy` are always same-origin. Keep it origin-derived — don't
> hardcode an absolute origin, which is how the site silently broke before.

## Test

**Unit tests (Vitest)** — dev/CI harness.

```bash
npm ci
npm test
```

**End-to-end tests** — hit the live production Worker + app.

```bash
cd .claude/skills/xdownload-e2e
./run.sh            # worker / HTTP layer (zero-install)
./run.sh browser    # full browser journey (installs Playwright on first run)
./run.sh all        # both layers
```

## Deploy

Deploy manually from the repo root (needs Cloudflare auth — run
`npx wrangler login` once):

```bash
npm run deploy      # vite build → wrangler deploy → post-deploy smoke check
```

`npx wrangler deploy` also works (its build hook runs `npm run build` first).
Deploys update the `xdownload` Worker in place; the built app and the proxy
script ship together. **Editing source changes nothing on the live site until
you rebuild + redeploy.** CI validates every PR, and a scheduled uptime monitor
(`.github/workflows/uptime.yml`) alerts on any production outage.

## License

Not affiliated with X Corp. This is a tool for accessing publicly available
media; users are responsible for respecting copyright and X's terms of service.
