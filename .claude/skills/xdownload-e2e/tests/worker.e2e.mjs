/**
 * xDownload — Worker + integration end-to-end tests (production).
 * ---------------------------------------------------------------
 * Zero dependencies: Node's built-in test runner (`node --test`) + `fetch`.
 * Matches the repo ethos — no package.json, nothing to install.
 *
 * These tests exercise the LIVE Worker and the LIVE fxtwitter API. They are
 * the deterministic backbone of the E2E suite: the whole download/playback UX
 * rests on the `/proxy` contract (CORS, Range, host allow-list, forced
 * download) and on fxtwitter returning usable video variants. If any of these
 * regress, the app silently breaks — exactly the failure mode CLAUDE.md warns
 * about (PROXY_BASE pointing at a dead origin).
 *
 * Target is configurable so you can point at a preview deploy:
 *   BASE=https://xdownload.info node --test tests/worker.e2e.mjs   (default)
 *
 * Run:  node --test tests/worker.e2e.mjs
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const BASE = (process.env.BASE || 'https://xdownload.info').replace(/\/+$/, '')

// A stable, public post that has a video. Used to (a) prove the fxtwitter
// integration works and (b) discover a REAL, currently-valid twimg URL to feed
// the proxy — rather than hardcoding a twimg URL that can rot over time.
const SAMPLE = { username: 'SpaceX', tweetId: '1732824684683784516' }
const FX = (u, id) => `https://api.fxtwitter.com/${u}/status/${id}`

const TIMEOUT = 30_000
function fetchT(url, opts = {}) {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...opts })
}

// mirrors bestMp4Url() in public/index.html: highest-bitrate progressive MP4,
// never the .m3u8 HLS playlist.
function bestMp4Url(video) {
  const variants = (video.variants || video.formats || [])
    .filter((v) => v.url && /\.mp4(\?|$)/.test(v.url))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  return variants[0]?.url || video.url
}

// Discovered once, shared across the proxy tests below.
let liveVideoUrl = null

before(async () => {
  const res = await fetchT(FX(SAMPLE.username, SAMPLE.tweetId))
  const data = await res.json()
  const video = data?.tweet?.media?.videos?.[0]
  if (video) liveVideoUrl = bestMp4Url(video)
})

// ── fxtwitter integration ────────────────────────────────────────────────
// The app fetches post media straight from api.fxtwitter.com in the browser;
// if its shape or availability changes, fetchVideos() breaks.

test('fxtwitter: known video post returns code 200 with a usable MP4 variant', async () => {
  const res = await fetchT(FX(SAMPLE.username, SAMPLE.tweetId))
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.code, 200)
  const videos = data?.tweet?.media?.videos ?? []
  assert.ok(videos.length >= 1, 'expected at least one video')

  const best = bestMp4Url(videos[0])
  assert.match(best, /\.mp4(\?|$)/, 'best variant must be a progressive MP4')
  assert.doesNotMatch(best, /\.m3u8/, 'must never pick the HLS playlist')
  assert.ok(new URL(best).hostname.endsWith('twimg.com'))
})

test('fxtwitter: deleted/unknown post yields a 404 code the app maps to a message', async () => {
  // A well-formed handle + a tweet id that cannot exist → fxtwitter answers
  // with JSON {code: 404}. fetchVideos() maps this to a friendly error.
  const res = await fetchT(FX(SAMPLE.username, '9999999999999999999'))
  const data = await res.json()
  assert.equal(data.code, 404)
})

// ── Static app hosting ─────────────────────────────────────────────────────
// Non-/proxy requests fall through to the ASSETS binding (env.ASSETS.fetch).

test('static: GET / serves the Vue single-file app', async () => {
  const res = await fetchT(`${BASE}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
  const html = await res.text()
  assert.match(html, /id="app"/, 'Vue mount point present')
  assert.match(html, /api\.fxtwitter\.com|fxtwitter/, 'app talks to fxtwitter')
})

test('static: GET /privacy.html serves the privacy page (AdSense compliance)', async () => {
  const res = await fetchT(`${BASE}/privacy.html`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
})

// ── /proxy contract: rejections ────────────────────────────────────────────
// The proxy is intentionally NOT an open proxy. These guard the allow-list.

test('proxy: missing ?url → 400', async () => {
  const res = await fetchT(`${BASE}/proxy`)
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /missing .*url/i)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('proxy: malformed url → 400 invalid url', async () => {
  const res = await fetchT(`${BASE}/proxy?url=not-a-url`)
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /invalid url/i)
})

test('proxy: non-twimg host → 403 host not allowed', async () => {
  const res = await fetchT(`${BASE}/proxy?url=${encodeURIComponent('https://example.com/evil.mp4')}`)
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /host not allowed/i)
})

test('proxy: non-https twimg url → 403 (protocol locked to https)', async () => {
  const res = await fetchT(`${BASE}/proxy?url=${encodeURIComponent('http://video.twimg.com/x.mp4')}`)
  assert.equal(res.status, 403)
})

test('proxy: POST → 405 method not allowed', async () => {
  const res = await fetchT(`${BASE}/proxy?url=${encodeURIComponent('https://video.twimg.com/x.mp4')}`, {
    method: 'POST',
  })
  assert.equal(res.status, 405)
})

// ── /proxy contract: CORS preflight ──────────────────────────────────────
// The browser sends a Range header on <video>, which triggers a preflight.

test('proxy: OPTIONS preflight advertises CORS + allowed methods', async () => {
  const res = await fetchT(`${BASE}/proxy`, { method: 'OPTIONS' })
  assert.ok(res.status === 200 || res.status === 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('access-control-allow-methods') || '', /GET/)
  assert.match(res.headers.get('access-control-allow-headers') || '', /Range/)
})

// ── /proxy contract: real video (the part that makes downloads work) ────────

test('proxy: streams a real twimg video with ACAO:* and video content-type', async () => {
  assert.ok(liveVideoUrl, 'could not discover a live video URL from fxtwitter')
  const res = await fetchT(`${BASE}/proxy?url=${encodeURIComponent(liveVideoUrl)}`, { method: 'HEAD' })
  assert.equal(res.status, 200)
  // ACAO:* is the whole reason the proxy exists — twimg sends none, so the
  // browser can't read the bytes to save them without this.
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('content-type') || '', /video|mp4|octet-stream/i)
  assert.match(res.headers.get('accept-ranges') || '', /bytes/)
})

test('proxy: honours Range so <video> can seek (206 + Content-Range)', async () => {
  assert.ok(liveVideoUrl, 'could not discover a live video URL from fxtwitter')
  const res = await fetchT(`${BASE}/proxy?url=${encodeURIComponent(liveVideoUrl)}`, {
    headers: { Range: 'bytes=0-1023' },
  })
  assert.equal(res.status, 206)
  assert.match(res.headers.get('content-range') || '', /bytes 0-1023\/\d+/)
  assert.equal(res.headers.get('content-length'), '1024')
})

test('proxy: &dl= forces an attachment download with a safe filename', async () => {
  assert.ok(liveVideoUrl, 'could not discover a live video URL from fxtwitter')
  const url = `${BASE}/proxy?url=${encodeURIComponent(liveVideoUrl)}&dl=my%20clip.mp4`
  const res = await fetchT(url, { method: 'HEAD' })
  assert.equal(res.status, 200)
  const cd = res.headers.get('content-disposition') || ''
  assert.match(cd, /attachment/)
  assert.match(cd, /filename="my clip\.mp4"/)
})
