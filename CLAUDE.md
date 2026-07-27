# CLAUDE.md

Guidance for working in the **xdownload** repo. Read this before making changes.

## What this is

xDownload is an X / Twitter video downloader. A user pastes a post URL, the app
fetches the post's media via the public **fxtwitter API**
(`api.fxtwitter.com`), and offers one-click download + in-page playback of any
videos/GIFs.

The whole thing is one **Cloudflare Worker** that does two jobs:

1. **Hosts the static app** — `public/` is served via the Static Assets
   (`ASSETS`) binding. Requests matching a file in `public/` never hit the
   Worker code.
2. **Proxies video** — `GET /proxy?url=<twimg url>` fetches the video
   server-side, spoofs a `twitter.com` Referer to beat twimg's hot-link `403`,
   and re-serves the bytes with `Access-Control-Allow-Origin: *`. twimg sends
   no CORS headers, so this same-origin proxy is what makes downloads and
   seekable playback work. It is **not** an open proxy — locked to
   `video.twimg.com`, `pbs.twimg.com`, `amp.twimg.com`.

Live at **https://xdownload.info**.

## Layout

- `public/index.html` — the entire app: a single-file **Vue 3** app (global
  build, no bundler) styled with **Bootstrap 5.3.3**, all via CDN. ~790 lines,
  markup + `<style>` + inline `<script>`. This is where nearly all app work
  happens.
- `public/privacy.html` — static privacy/cookies page.
- `worker/worker.js` — the Worker: `/proxy` handler + static-asset fallthrough.
- `wrangler.jsonc` — Worker config (name `xdownload`, `main`, ASSETS binding,
  `xdownload.info` custom-domain route).
- `.claude/launch.json` — local dev server (see below).

There is **no build step, no `package.json`, no dependencies to install.**
Everything is vanilla JS/HTML served as-is. Wrangler is the only tool.

## Running & verifying locally

Use the preview dev server (config `xdownload` in `.claude/launch.json`): it's
`python3 -m http.server 3456 --directory public`, so `http://localhost:3456`
serves the static app. The `/proxy` endpoint does **not** exist locally (it's
Worker-only) — but `PROXY_BASE` points at the live `https://xdownload.info`,
whose proxy sends `ACAO: *`, so downloads/playback still work from local
testing.

## Deploying — IMPORTANT

- Deploy manually from the repo root: **`npx wrangler deploy`**. Requires
  Cloudflare auth; if not cached, `npx wrangler login` (backgrounds and prints
  an OAuth URL to click). Deploys update the `xdownload` Worker in place.
- **Editing `public/index.html` (or any file) changes nothing on the live site
  until you redeploy the Worker.** The static assets ship with the Worker.
- Deploy/commit/push only when the user asks. `worker/README.md` mentions a
  GitHub→Cloudflare auto-deploy on push to `main`; treat that as unreliable and
  prefer explicit `wrangler deploy`.
- Verify live health: `curl https://xdownload.info/proxy` → `400
  {"error":"missing ?url parameter"}` means it's up. `/proxy?url=<non-twimg>` →
  `403 host not allowed`.

## Key gotcha: PROXY_BASE

`const PROXY_BASE` in `public/index.html` (~line 503) must point at a **live**
Worker origin (currently `https://xdownload.info`). It was once hardcoded to a
`*.workers.dev` subdomain that later 404'd (Cloudflare error 1042), silently
breaking all downloads/playback. If downloads suddenly fail everywhere, check
this first. Same origin serves both the app and `/proxy`, so keep it that way.

## Download strategy (in index.html)

`downloadVideo()` tries an ordered chain and stops at the first success:
own Worker `/proxy` → direct fetch → several public CORS proxies → finally a
`rel="noreferrer"` `<a download>` that opens the video for manual save. Each
fetch has a timeout and validates the blob (size ≥ 100 KB, video-ish MIME) so a
dead proxy or HTML error page can't stall or masquerade as success. Always
prefer the highest-bitrate progressive **MP4** — never the `.m3u8` HLS
playlist.

## Conventions & preferences

- **Match the existing comment style.** Both `worker.js` and `index.html` are
  heavily, deliberately commented — explaining *why* (CORS, hot-link 403s,
  fallback ordering), not just *what*. Keep that density when editing.
- **Visual style is X/Twitter:** black nav/header (`#000`), blue accent
  (`--x-blue: #1d9bf0`), pill buttons (`.btn-x`), rounded cards. Reuse the CSS
  vars in `:root`; don't introduce a new palette.
- Keep the app **single-file and dependency-free** (CDN only). Don't add a
  bundler/`package.json` unless explicitly asked.
- Any `<script>` you add to the app must live **outside** Vue's `#app` root —
  Vue strips inline scripts inside its template (this is why AdSense is
  activated from the `mounted()` hook, not an inline `<script>`).

## Monetization / third parties

- **Google AdSense**: client `ca-pub-3160807008877535`, ad slot `5120476027`
  (set in both the `<ins>` tag and the `ADSENSE_SLOT` const). The `mounted()`
  hook skips `adsbygoogle.push({})` while the slot is the `1111…` placeholder to
  keep dev/preview clean.
- fxtwitter API is unauthenticated and free; error codes are mapped to friendly
  messages in `fetchVideos()`.
- A discreet, dismissible cookie notice (localStorage `cookieNoticeAck`) and the
  privacy page exist for AdSense compliance.
