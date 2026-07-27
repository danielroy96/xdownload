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

**Deploy manually from the repo root** — this is the reliable path:

```bash
npx wrangler deploy       # needs Cloudflare auth; run `npx wrangler login` once
```

`login` backgrounds and prints an OAuth URL to click. The Worker is named
**`xdownload`**, so deploys update it in place, and both the static app and the
proxy script ship together.

> A GitHub↔Cloudflare connection may auto-deploy on push to `main`, but treat
> that as unreliable — there is no CI config in the repo, so always prefer an
> explicit `npx wrangler deploy`.

Nothing you edit (including `public/index.html`) changes the live site until
you redeploy the Worker — the static assets ship with it.

---

## Connect the app

`PROXY_BASE` in `public/index.html` must point at a **live** Worker origin
(same origin serves both the app and `/proxy`):

```js
const PROXY_BASE = 'https://xdownload.info'
```

If it ever points at a dead origin (e.g. an old `*.workers.dev` subdomain that
now 404s with error 1042), **all downloads and playback silently break** — this
is the first thing to check. Keep it as the live origin, no trailing slash.

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
