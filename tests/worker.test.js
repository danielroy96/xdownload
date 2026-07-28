/**
 * Tests for worker/worker.js — the Cloudflare Worker that hosts the app and
 * proxies twimg video.
 *
 * We exercise the real default export's fetch(request, env) handler. `fetch`
 * (the upstream call the Worker makes) and `env.ASSETS.fetch` (static hosting)
 * are the only external dependencies, and both are mocked so tests are
 * hermetic — no network, no real assets.
 *
 * @jest-environment node
 */
const worker = require('../worker/worker.js').default

// A minimal ASSETS binding: records the request it was handed and returns a
// recognisable static response. TURNSTILE_SECRET is present so the download
// gate (which reads env.TURNSTILE_SECRET) behaves as it does in production.
function makeEnv() {
  const assetsFetch = jest.fn(async (req) => new Response('<html>app</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }))
  return { env: { ASSETS: { fetch: assetsFetch }, TURNSTILE_SECRET: 'test-secret' }, assetsFetch }
}

// Build a Request for the Worker. `path` may include a query string.
function req(path, init) {
  return new Request(`https://xdownload.info${path}`, init)
}

const TWIMG = 'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/abc.mp4'
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Mock global.fetch so the Worker's two possible outbound calls are told apart:
// the Turnstile siteverify POST (download gate) and the upstream twimg fetch.
//   siteverify: an object → returned as the JSON verdict (e.g. { success: true });
//               'throw'   → the fetch rejects (network failure);
//               'non-2xx' → returns HTTP 500 (siteverify unreachable/broken).
//   upstream:   the Response used for the twimg fetch (defaults to 200 video).
// Returns the jest spy so callers can assert on the calls.
function mockFetch({ siteverify = { success: true }, upstream } = {}) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('/turnstile/v0/siteverify')) {
      if (siteverify === 'throw') throw new Error('siteverify down')
      if (siteverify === 'non-2xx') return new Response('err', { status: 500 })
      return new Response(JSON.stringify(siteverify), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return upstream || new Response('bytes', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    })
  })
}

// A download request for TWIMG carrying a Turnstile token (header, as the app sends it).
function downloadReq(token = 'GOOD-TOKEN', filename = 'my/../evil name.mp4') {
  const headers = token ? { 'cf-turnstile-response': token } : {}
  return req(`/proxy?url=${encodeURIComponent(TWIMG)}&dl=${encodeURIComponent(filename)}`, { headers })
}

describe('Serving the app', () => {
  test('serves the homepage', async () => {
    const { env, assetsFetch } = makeEnv()
    const res = await worker.fetch(req('/'), env)
    expect(assetsFetch).toHaveBeenCalledTimes(1)
    expect(await res.text()).toBe('<html>app</html>')
  })

  test('serves other pages like /privacy.html', async () => {
    const { env, assetsFetch } = makeEnv()
    await worker.fetch(req('/privacy.html'), env)
    expect(assetsFetch).toHaveBeenCalledTimes(1)
    const handed = assetsFetch.mock.calls[0][0]
    expect(new URL(handed.url).pathname).toBe('/privacy.html')
  })

  test('never fetches upstream video for a page load', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('x'))
    const { env } = makeEnv()
    await worker.fetch(req('/index.html'), env)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('Proxy — only serves legitimate twimg video', () => {
  test('answers a CORS preflight without calling upstream', async () => {
    const spy = jest.spyOn(global, 'fetch')
    const { env } = makeEnv()
    const res = await worker.fetch(req('/proxy', { method: 'OPTIONS' }), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('rejects non-GET methods (405)', async () => {
    const { env } = makeEnv()
    const res = await worker.fetch(req('/proxy', { method: 'POST' }), env)
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method not allowed' })
  })

  test('rejects a request with no url (400)', async () => {
    const { env } = makeEnv()
    const res = await worker.fetch(req('/proxy'), env)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing ?url parameter' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('rejects a malformed url (400)', async () => {
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent('h ttp://not a url')}`),
      env
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid url' })
  })

  test('blocks non-twimg hosts (403)', async () => {
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent('https://example.com/x.mp4')}`),
      env
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'host not allowed' })
  })

  test('blocks non-https urls (403)', async () => {
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent('http://video.twimg.com/x.mp4')}`),
      env
    )
    expect(res.status).toBe(403)
  })

  test.each([
    'video.twimg.com',
    'pbs.twimg.com',
    'amp.twimg.com',
  ])('allows the twimg host %s', async (host) => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('bytes', { status: 200, headers: { 'Content-Type': 'video/mp4' } })
    )
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent(`https://${host}/x.mp4`)}`),
      env
    )
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  test('blocks look-alike hostnames (403)', async () => {
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent('https://video.twimg.com.attacker.com/x.mp4')}`),
      env
    )
    expect(res.status).toBe(403)
  })
})

describe('Proxy — streaming video to the browser', () => {
  test('fetches with a twitter Referer and re-serves the bytes with CORS', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('VIDEOBYTES', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': '10' },
      })
    )
    const { env } = makeEnv()
    const res = await worker.fetch(req(`/proxy?url=${encodeURIComponent(TWIMG)}`), env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('VIDEOBYTES')
    // Upstream fetch got the twimg URL + spoofed headers.
    const [calledUrl, calledInit] = spy.mock.calls[0]
    expect(calledUrl).toBe(TWIMG)
    expect(calledInit.headers.get('Referer')).toBe('https://twitter.com/')
    expect(calledInit.headers.get('User-Agent')).toMatch(/Mozilla/)
    // Response carries CORS + preserves upstream content type.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    spy.mockRestore()
  })

  test('forwards Range requests so the player can seek', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('partial', { status: 206 })
    )
    const { env } = makeEnv()
    await worker.fetch(
      req(`/proxy?url=${encodeURIComponent(TWIMG)}`, { headers: { Range: 'bytes=0-1023' } }),
      env
    )
    const calledInit = spy.mock.calls[0][1]
    expect(calledInit.headers.get('Range')).toBe('bytes=0-1023')
    spy.mockRestore()
  })

  test('preserves the upstream status code', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('partial', { status: 206, statusText: 'Partial Content' })
    )
    const { env } = makeEnv()
    const res = await worker.fetch(req(`/proxy?url=${encodeURIComponent(TWIMG)}`), env)
    expect(res.status).toBe(206)
    spy.mockRestore()
  })

  test('forces a download with a safe filename when &dl is set (valid token)', async () => {
    // Downloads are gated on Turnstile now, so supply a token + passing verdict.
    const spy = mockFetch({ siteverify: { success: true } })
    const { env } = makeEnv()
    const res = await worker.fetch(downloadReq(), env)
    const cd = res.headers.get('Content-Disposition')
    expect(cd).toMatch(/^attachment; filename="/)
    // Path separators and other unsafe chars are collapsed to underscores.
    expect(cd).not.toMatch(/[/\\]/)
    expect(cd).toContain('.mp4')
    spy.mockRestore()
  })

  test('forwards HEAD requests', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent(TWIMG)}`, { method: 'HEAD' }),
      env
    )
    expect(res.status).toBe(200)
    expect(spy.mock.calls[0][1].method).toBe('HEAD')
    spy.mockRestore()
  })
})

describe('Proxy — Turnstile download gate', () => {
  test('a valid token is verified via canonical siteverify, then the file is served', async () => {
    const spy = mockFetch({ siteverify: { success: true } })
    const { env } = makeEnv()
    const res = await worker.fetch(downloadReq('GOOD-TOKEN'), env)
    expect(res.status).toBe(200)

    // First outbound call is siteverify with the canonical form-encoded body.
    const [svUrl, svInit] = spy.mock.calls[0]
    expect(svUrl).toBe(SITEVERIFY)
    expect(svInit.method).toBe('POST')
    const body = new URLSearchParams(svInit.body)
    expect(body.get('secret')).toBe('test-secret')     // from env.TURNSTILE_SECRET
    expect(body.get('response')).toBe('GOOD-TOKEN')     // the token from the request
    // Second call is the upstream twimg fetch (only reached because it passed).
    expect(spy.mock.calls[1][0]).toBe(TWIMG)
    spy.mockRestore()
  })

  test('passes the client IP (CF-Connecting-IP) as remoteip', async () => {
    const spy = mockFetch({ siteverify: { success: true } })
    const { env } = makeEnv()
    const r = req(`/proxy?url=${encodeURIComponent(TWIMG)}&dl=v.mp4`, {
      headers: { 'cf-turnstile-response': 'GOOD-TOKEN', 'CF-Connecting-IP': '203.0.113.7' },
    })
    await worker.fetch(r, env)
    const body = new URLSearchParams(spy.mock.calls[0][1].body)
    expect(body.get('remoteip')).toBe('203.0.113.7')
    spy.mockRestore()
  })

  test('rejects a download with no token (403) without calling upstream', async () => {
    const spy = mockFetch({ siteverify: { success: true } })
    const { env } = makeEnv()
    const res = await worker.fetch(downloadReq(null), env)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'turnstile verification failed' })
    // Fail fast: no token means siteverify and upstream are never called.
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('rejects a download when siteverify says success:false (403)', async () => {
    const spy = mockFetch({ siteverify: { success: false, 'error-codes': ['invalid-input-response'] } })
    const { env } = makeEnv()
    const res = await worker.fetch(downloadReq('BAD-TOKEN'), env)
    expect(res.status).toBe(403)
    // siteverify was consulted, but upstream was never reached.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe(SITEVERIFY)
    spy.mockRestore()
  })

  test('fails closed (403) when siteverify itself errors', async () => {
    const spy = mockFetch({ siteverify: 'throw' })
    const { env } = makeEnv()
    const res = await worker.fetch(downloadReq('GOOD-TOKEN'), env)
    expect(res.status).toBe(403)
    spy.mockRestore()
  })

  test('fails closed (403) when siteverify returns a non-2xx', async () => {
    const spy = mockFetch({ siteverify: 'non-2xx' })
    const { env } = makeEnv()
    const res = await worker.fetch(downloadReq('GOOD-TOKEN'), env)
    expect(res.status).toBe(403)
    spy.mockRestore()
  })

  test('playback (no &dl) is never gated — siteverify is not called', async () => {
    const spy = mockFetch({ siteverify: { success: true } })
    const { env } = makeEnv()
    const res = await worker.fetch(req(`/proxy?url=${encodeURIComponent(TWIMG)}`), env)
    expect(res.status).toBe(200)
    // Exactly one outbound call — the upstream fetch — and it's NOT siteverify.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe(TWIMG)
    spy.mockRestore()
  })
})

describe('Proxy — edge caching', () => {
  test('caches a full video response at the edge', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('bytes', { status: 200 }))
    const { env } = makeEnv()
    const res = await worker.fetch(req(`/proxy?url=${encodeURIComponent(TWIMG)}`), env)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, immutable')
    // asks Cloudflare to cache the upstream response
    expect(spy.mock.calls[0][1].cf).toMatchObject({ cacheEverything: true })
    spy.mockRestore()
  })

  test('never caches a partial (Range) response', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('partial', { status: 206 }))
    const { env } = makeEnv()
    const res = await worker.fetch(
      req(`/proxy?url=${encodeURIComponent(TWIMG)}`, { headers: { Range: 'bytes=0-99' } }),
      env
    )
    expect(res.headers.get('Cache-Control')).toBeNull()
    expect(spy.mock.calls[0][1].cf).toBeUndefined()
    spy.mockRestore()
  })

  test('never caches an upstream error', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 403 }))
    const { env } = makeEnv()
    const res = await worker.fetch(req(`/proxy?url=${encodeURIComponent(TWIMG)}`), env)
    expect(res.headers.get('Cache-Control')).toBeNull()
    spy.mockRestore()
  })
})

describe('Proxy — upstream failure', () => {
  test('returns 502 when the upstream fetch fails', async () => {
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    const { env } = makeEnv()
    const res = await worker.fetch(req(`/proxy?url=${encodeURIComponent(TWIMG)}`), env)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('upstream fetch failed')
    expect(body.detail).toMatch(/ECONNRESET/)
    spy.mockRestore()
  })
})
