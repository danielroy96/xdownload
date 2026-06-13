/**
 * xDownload — Cloudflare Worker (app host + video proxy)
 * ------------------------------------------------------
 * One Worker does two jobs:
 *
 *   1. Serves the static app (public/index.html) via Static Assets. Any request
 *      that matches a file in /public is returned directly — the code below
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
  'Access-Control-Allow-Headers': 'Range, Content-Type',
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

async function handleProxy(request, reqUrl) {
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

  let upstream
  try {
    upstream = await fetch(t.toString(), { method: request.method, headers: fwd })
  } catch (e) {
    return json({ error: 'upstream fetch failed', detail: String(e) }, 502)
  }

  const headers = new Headers(upstream.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)

  const dl = reqUrl.searchParams.get('dl')
  if (dl) headers.set('Content-Disposition', `attachment; filename="${safeName(dl)}"`)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/proxy') return handleProxy(request, url)
    // Not the proxy route — serve the static app (index.html, etc.).
    return env.ASSETS.fetch(request)
  },
}
