# xDownload video proxy (Cloudflare Worker)

A ~30-line Cloudflare Worker that lets the page read Twitter video bytes so it
can play them reliably and save them in one click.

**Why it's needed:** `video.twimg.com` sends no CORS headers and blocks
hot-linking, so the browser can't read the video to save it. This Worker fetches
the file server-side (no CORS there), spoofs a `twitter.com` Referer, and
re-serves it with `Access-Control-Allow-Origin: *`. It's locked to Twitter media
hosts only, so it can't be abused as an open proxy.

Cloudflare's **free plan** covers this comfortably (100k requests/day).

---

## Deploy in 3 steps

### Option A — Wrangler CLI (recommended)

```bash
# 1. Install the CLI (once)
npm install -g wrangler

# 2. Log in and deploy (from this /worker folder)
wrangler login
wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g.:

```
https://xdownload-proxy.your-subdomain.workers.dev
```

### Option B — Cloudflare dashboard (no CLI)

1. Go to **dash.cloudflare.com → Workers & Pages → Create → Create Worker**.
2. Name it (e.g. `xdownload-proxy`) and **Deploy**.
3. Click **Edit code**, delete the template, paste the contents of
   [`proxy.js`](./proxy.js), then **Deploy** again.
4. Copy the `*.workers.dev` URL shown at the top.

---

## Connect it to the app

Open `public/index.html`, find the `PROXY_BASE` constant near the top of the
`<script>` block, and paste your Worker URL:

```js
const PROXY_BASE = 'https://xdownload-proxy.your-subdomain.workers.dev'
```

Reload the page. Videos now stream through your Worker and the **Download**
button saves files directly to your downloads folder. No other changes needed —
if `PROXY_BASE` is left blank the app still works via public proxies + manual
save.

---

## Endpoints

| Request | Behaviour |
|---|---|
| `GET /?url=<encoded twimg url>` | streams the video (CORS-enabled, supports Range/seeking) |
| `GET /?url=<encoded twimg url>&dl=<filename>` | same, but forces a download with the given filename |

Only `video.twimg.com`, `pbs.twimg.com`, and `amp.twimg.com` targets are
permitted; anything else returns `403`.
