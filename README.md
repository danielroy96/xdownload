# xDownload — X / Twitter Video Downloader

A dead-simple web app for downloading videos and GIFs from X (formerly Twitter)
posts. Paste a post URL, and the app extracts its media via the public
[fxtwitter API](https://github.com/FxEmbed/FxEmbed), plays it inline, and offers
a one-click download.

**Live at [xdownload.info](https://xdownload.info).**

## How it works

The whole thing is a single **Cloudflare Worker** doing two jobs:

1. **Hosts the static app** — the `public/` directory (a single-file Vue 3 app)
   is served via the Worker's Static Assets binding.
2. **Proxies video** — `GET /proxy?url=<twimg url>` fetches the video
   server-side, spoofs a `twitter.com` Referer to beat twimg's hot-link `403`,
   and re-serves the bytes with `Access-Control-Allow-Origin: *`. twimg sends no
   CORS headers, so this same-origin proxy is what makes downloads and seekable
   playback work. It is **not** an open proxy — it's locked to `video.twimg.com`,
   `pbs.twimg.com`, and `amp.twimg.com`, and immutable media is edge-cached.

There is **no build step and no runtime dependencies** — the app is vanilla
HTML/JS using Vue 3, Bootstrap 5, and Bootstrap Icons straight from a CDN.

## Layout

| Path | What it is |
|---|---|
| `public/index.html` | The entire app — a single-file Vue 3 app (markup + `<style>` + inline `<script>`) styled with Bootstrap 5. |
| `public/privacy.html` | Static privacy / cookies page (AdSense compliance). |
| `worker/worker.js` | The Worker: the `/proxy` handler + static-asset fallthrough. |
| `wrangler.jsonc` | Worker config (name, `main`, ASSETS binding, `xdownload.info` custom-domain route). |
| `tests/` | Jest unit tests for the Worker and the app logic. |
| `.github/workflows/ci.yml` | GitHub Actions CI — runs the Jest suite on every push / PR to `main`. |
| `.claude/skills/xdownload-e2e/` | End-to-end test suite that runs against the **live** site. |

## Develop

Serve the static app locally (any static server works):

```bash
python3 -m http.server 3456 --directory public   # http://localhost:3456
```

The `/proxy` endpoint doesn't exist locally (it's Worker-only), but `PROXY_BASE`
in `public/index.html` points at the live `https://xdownload.info`, whose proxy
sends `Access-Control-Allow-Origin: *` — so downloads and playback still work
from local testing.

> **Gotcha:** `PROXY_BASE` must always point at a **live** Worker origin. If it
> ever points at a dead origin, all downloads and playback silently break. Same
> origin serves both the app and `/proxy`, so keep it that way.

## Test

**Unit tests (Jest)** — dev-only harness; the app itself stays dependency-free.

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
npx wrangler deploy
```

Deploys update the `xdownload` Worker in place; both the static app and the proxy
script ship together. **Editing any file changes nothing on the live site until
you redeploy.** CI validates every PR, but deployment is a manual step.

## License

Not affiliated with X Corp. This is a tool for accessing publicly available
media; users are responsible for respecting copyright and X's terms of service.
