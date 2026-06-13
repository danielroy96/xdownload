# xDownload — Cloudflare Worker (app + video proxy)

One Worker does everything:

1. **Hosts the app** — serves `public/index.html` as a static asset.
2. **Proxies video** — `/proxy?url=<twimg url>` fetches the video server-side,
   spoofs a `twitter.com` Referer to beat twimg's hot-link `403`, and re-serves
   it with `Access-Control-Allow-Origin`. Same origin as the app, so downloads
   and playback work with no CORS issues.

It's locked to Twitter media hosts (`video.twimg.com`, `pbs.twimg.com`,
`amp.twimg.com`) — not an open proxy. Cloudflare's **free plan** is plenty.

The Worker script is `worker/worker.js`; configuration lives in the
repo-root **`wrangler.jsonc`** (which sets `main` to this script and serves
`public/` as static assets via the `ASSETS` binding).

---

## Deploy / update

This repo is connected to Cloudflare via GitHub, so **pushing to `main`
auto-deploys** (deploy command: `npx wrangler deploy`). To deploy manually from
the repo root instead:

```bash
npm install -g wrangler   # once; needs a recent version for Static Assets
wrangler login
wrangler deploy
```

The Worker is named **`xdownload`**, so deploys update it in place — the URL
stays `https://xdownload.<your-subdomain>.workers.dev`. Both the static app and
the proxy script ship together.

---

## Connect the app

`PROXY_BASE` in `public/index.html` is already set to your Worker origin:

```js
const PROXY_BASE = 'https://xdownload.daniel-roy56.workers.dev'
```

If your Worker URL ever changes, update that line (no trailing slash).

---

## Verify

After deploying, these should hold:

| Request | Expected |
|---|---|
| `GET /` | the app loads |
| `GET /proxy?url=https://example.com/x` | `403 {"error":"host not allowed"}` |
| `GET /proxy?url=<encoded twimg .mp4>` | the video streams (with CORS headers) |

Then open the app, fetch a post, and click **Download** — the file saves
directly instead of opening in a new tab.
