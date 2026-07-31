# xDownload — Cloudflare Worker (app + video proxy)

One Worker does everything:

1. **Hosts the app** — serves the Vite build output (`dist/`) as static assets.
2. **Proxies video** — `/proxy?url=<twimg url>` fetches the video server-side,
   spoofs a `twitter.com` Referer to beat twimg's hot-link `403`, and re-serves
   it with `Access-Control-Allow-Origin`. Same origin as the app, so downloads
   and playback work with no CORS issues.
3. **Reports liveness** — `/health` → `200 {"status":"ok"}` for uptime monitors.

It's locked to Twitter media hosts (`video.twimg.com`, `pbs.twimg.com`,
`amp.twimg.com`) — not an open proxy. Cloudflare's **free plan** is plenty.

The Worker script is `worker/worker.js`; configuration lives in the
repo-root **`wrangler.jsonc`** (which sets `main` to this script, runs a build
hook, and serves `dist/` as static assets via the `ASSETS` binding).

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
> that as unreliable and always prefer an explicit `npm run deploy` /
> `npx wrangler deploy`. (CI in `.github/workflows/ci.yml` builds and tests
> every PR, but it does not deploy.)

Nothing you edit changes the live site until you rebuild + redeploy the Worker —
the built assets (`dist/`) ship with it. `npx wrangler deploy` runs the build
hook first; `npm run deploy` also adds a post-deploy smoke check.

---

## Connect the app

`PROXY_BASE` in `src/app.js` is derived from the serving origin:

```js
export const PROXY_BASE = window.location.origin
```

so the app and `/proxy` are always same-origin and it can never point at a dead
absolute host. This replaced a hardcoded absolute URL that once pointed at a
`*.workers.dev` subdomain which 404'd (error 1042) and **silently broke all
downloads and playback**. Keep it origin-derived.

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
