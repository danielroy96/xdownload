/**
 * xDownload — Cloudflare Worker (app host + video proxy)
 * ------------------------------------------------------
 * One Worker does two jobs:
 *
 *   1. Serves the built app (the Vite output in dist/) via Static Assets. Any
 *      request that matches a built file is returned directly — the code below
 *      isn't even invoked for those.
 *
 *   2. Handles `/proxy?url=<twimg url>` — Twitter's CDN sends no CORS headers
 *      and blocks hot-linking, so the browser can't read the video bytes to
 *      save them. This endpoint fetches the file server-side (no CORS there),
 *      spoofs a twitter.com Referer to beat the hot-link check, and re-serves
 *      the bytes with `Access-Control-Allow-Origin`. Because it's the same
 *      origin as the app, downloads and playback "just work".
 *
 * It is intentionally NOT an open proxy: only Twitter media hosts are allowed.
 *
 *   GET /proxy?url=<encoded twimg url>            → stream (supports Range/seek)
 *   GET /proxy?url=<encoded twimg url>&dl=name.mp4 → forced download
 */

const ALLOWED_HOSTS = new Set([
  'video.twimg.com',
  'pbs.twimg.com',
  'amp.twimg.com',
])

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  // `cf-turnstile-response` is a non-simple header, so a cross-origin download
  // (e.g. the app on localhost hitting the live Worker) triggers a preflight;
  // it must be allow-listed here or the browser drops the token before it
  // reaches us. Same-origin production traffic skips the preflight entirely.
  'Access-Control-Allow-Headers': 'Range, Content-Type, cf-turnstile-response',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition',
  'Access-Control-Max-Age': '86400',
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// Strip anything that could break a Content-Disposition header.
function safeName(name) {
  return (name || 'video.mp4').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}

// Verify a Cloudflare Turnstile token server-side (the ONLY place the secret is
// ever seen — never the browser). Downloads carry the token the widget minted;
// we confirm it with Cloudflare before spending bandwidth on the fetch below.
//
// Canonical siteverify contract:
//   POST https://challenges.cloudflare.com/turnstile/v0/siteverify
//   body: { secret, response: <token>, remoteip: <client ip> }
// and only `success === true` counts as a pass. We FAIL CLOSED — any network
// error, non-2xx, non-JSON body, or missing secret is treated as "not human".
async function verifyTurnstile(token, ip, env) {
  if (!token || !env || !env.TURNSTILE_SECRET) return false
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip || '',
      }),
    })
    if (!r.ok) return false
    const data = await r.json()
    return data.success === true
  } catch {
    return false
  }
}

async function handleProxy(request, reqUrl, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed' }, 405)
  }

  const target = reqUrl.searchParams.get('url')
  if (!target) return json({ error: 'missing ?url parameter' }, 400)

  let t
  try {
    t = new URL(target)
  } catch {
    return json({ error: 'invalid url' }, 400)
  }
  if (t.protocol !== 'https:' || !ALLOWED_HOSTS.has(t.hostname)) {
    return json({ error: 'host not allowed' }, 403)
  }

  // Turnstile gate — DOWNLOADS ONLY. A forced-download request carries `dl`
  // (the save-as filename); those come from a user clicking "Download" in the
  // app, which attaches the human-verification token the widget minted. We gate
  // that action on a passing siteverify before touching upstream.
  //
  // Playback (no `dl`) is deliberately NOT gated: the <video> element makes
  // range/seek requests directly and can't attach a token, and Turnstile tokens
  // are single-use anyway — gating playback would break streaming. The token
  // rides in a request header (kept out of the URL / access logs); we also
  // accept it as a query param as a belt-and-braces fallback.
  const dl = reqUrl.searchParams.get('dl')
  if (dl) {
    const token =
      request.headers.get('cf-turnstile-response') ||
      reqUrl.searchParams.get('cf-turnstile-response')
    const ip = request.headers.get('CF-Connecting-IP')
    const human = await verifyTurnstile(token, ip, env)
    if (!human) return json({ error: 'turnstile verification failed' }, 403)
  }

  // Forward Range (so the <video> player can seek) and spoof a Referer that
  // twimg accepts; a real-looking User-Agent avoids occasional blocks.
  const fwd = new Headers()
  const range = request.headers.get('Range')
  if (range) fwd.set('Range', range)
  fwd.set('Referer', 'https://twitter.com/')
  fwd.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  )

  // twimg media is immutable per URL, so let Cloudflare cache full responses at
  // the edge — this cuts repeat upstream fetches (and bandwidth) on the free
  // plan. Range requests (seeking) are left uncached: they return partial (206)
  // bodies we don't want stored and re-served as if they were the whole file.
  const cacheable = request.method === 'GET' && !range

  let upstream
  try {
    upstream = await fetch(t.toString(), {
      method: request.method,
      headers: fwd,
      // `cf` is honoured only on the Cloudflare runtime; harmless elsewhere.
      cf: cacheable ? { cacheEverything: true, cacheTtl: 86400 } : undefined,
    })
  } catch (e) {
    return json({ error: 'upstream fetch failed', detail: String(e) }, 502)
  }

  const headers = new Headers(upstream.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)

  // Let browsers cache the immutable media too (24h) — only for full 200s.
  if (cacheable && upstream.status === 200) {
    headers.set('Cache-Control', 'public, max-age=86400, immutable')
  }

  // `dl` was read (and gated) above; reuse it to force the save-as download.
  if (dl) headers.set('Content-Disposition', `attachment; filename="${safeName(dl)}"`)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

// Cheap, dependency-free liveness probe for uptime monitors. Unlike `/`, it
// doesn't touch static assets, and unlike `/proxy` it never depends on twimg or
// fxtwitter — so a green /health means "the Worker itself is running", cleanly
// separating an app/Worker outage from an upstream (X/twimg) problem.
function handleHealth() {
  return json({ status: 'ok', service: 'xdownload' }, 200)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/health') return handleHealth()
    if (url.pathname === '/proxy') return handleProxy(request, url, env)
    // Not a Worker route — serve the static app (index.html, etc.).
    return env.ASSETS.fetch(request)
  },
}
