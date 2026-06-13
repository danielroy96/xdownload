# xDownload — Cloudflare Worker (app + video proxy)

One Worker does everything:

1. **Hosts the app** — serves `public/index.html` as a static asset.
2. **Proxies video** — `/proxy?url=<twimg url>` fetches the video server-side,
   spoofs a `twitter.com` Referer to beat twimg's hot-link `403`, and re-serves
   it with `Access-Control-Allow-Origin`. Same origin as the app, so downloads
   and playback work with no CORS issues.

It's locked to Twitter media hosts (`video.twimg.com`, `pbs.twimg.com`,
`amp.twimg.com`) — not an open proxy. Cloudflare's **free plan** is plenty.

---

## Deploy / update

From this `worker/` folder:

```bash
npm install -g wrangler   # once; needs a recent version for Static Assets
wrangler login
wrangler deploy
```

Because the Worker is named **`xdownload`**, this **updates your existing
Worker in place** — the URL stays:

```
https://xdownload.<your-subdomain>.workers.dev
```

`wrangler deploy` uploads `public/index.html` as a static asset and the proxy
script together.

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
