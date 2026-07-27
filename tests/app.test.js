/**
 * Tests for the single-file Vue app in public/index.html.
 *
 * The app's logic is loaded LIVE out of index.html (see tests/helpers/loadApp)
 * so these tests track the shipped code. Methods are exercised against a `this`
 * context built from the component's own data(), exactly as Vue would.
 *
 * @jest-environment jsdom
 */
const { loadApp, makeInstance } = require('./helpers/loadApp')

// An AbortError as fetch would throw when the request times out / is aborted.
function abortError() {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

describe('module constants', () => {
  test('PROXY_BASE points at a live https Worker origin (not workers.dev)', () => {
    const { PROXY_BASE } = loadApp()
    expect(PROXY_BASE).toBe('https://xdownload.info')
    // The classic breakage was a dead *.workers.dev subdomain — guard it.
    expect(PROXY_BASE).not.toMatch(/workers\.dev/)
    expect(PROXY_BASE).not.toMatch(/\/$/) // no trailing slash
  })

  test('ADSENSE_SLOT is the real slot, not the dormant placeholder', () => {
    const { ADSENSE_SLOT } = loadApp()
    expect(ADSENSE_SLOT).toBe('5120476027')
    expect(ADSENSE_SLOT.startsWith('1111')).toBe(false)
  })
})

describe('data() defaults', () => {
  test('initial state is clean and proxyBase has trailing slashes trimmed', () => {
    const { options } = loadApp()
    const d = options.data()
    expect(d.url).toBe('')
    expect(d.loading).toBe(false)
    expect(d.error).toBeNull()
    expect(d.videos).toEqual([])
    expect(d.toasts).toEqual([])
    expect(d.proxyBase).toBe('https://xdownload.info')
  })
})

describe('parseTweetUrl', () => {
  const cases = [
    ['https://x.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['https://twitter.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['https://www.twitter.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['https://mobile.twitter.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    // no scheme → https is prepended
    ['x.com/user_1/status/1234567890', { username: 'user_1', tweetId: '1234567890' }],
    // trailing path / query is ignored
    ['https://x.com/jack/status/20/video/1?s=20', { username: 'jack', tweetId: '20' }],
    // surrounding whitespace trimmed
    ['   https://x.com/jack/status/20  ', { username: 'jack', tweetId: '20' }],
  ]
  test.each(cases)('parses %s', (input, expected) => {
    const { ctx } = makeInstance()
    expect(ctx.parseTweetUrl(input)).toEqual(expected)
  })

  const bad = [
    'https://youtube.com/watch?v=abc',
    'https://x.com/jack',            // no /status/
    'https://x.com/jack/status/',    // no id
    'not a url at all',
    'https://x.com/status/20',       // missing username segment
  ]
  test.each(bad)('rejects %s → null', (input) => {
    const { ctx } = makeInstance()
    expect(ctx.parseTweetUrl(input)).toBeNull()
  })
})

describe('proxied / playSrc', () => {
  test('proxied builds an encoded /proxy URL against proxyBase', () => {
    const { ctx } = makeInstance()
    const url = ctx.proxied('https://video.twimg.com/a b.mp4')
    expect(url).toBe(
      'https://xdownload.info/proxy?url=' +
        encodeURIComponent('https://video.twimg.com/a b.mp4')
    )
  })

  test('proxied appends an encoded &dl filename when provided', () => {
    const { ctx } = makeInstance()
    const url = ctx.proxied('https://video.twimg.com/x.mp4', 'jack_20.mp4')
    expect(url).toContain('&dl=jack_20.mp4')
  })

  test('playSrc routes through the proxy when proxyBase is set', () => {
    const { ctx } = makeInstance()
    expect(ctx.playSrc({ url: 'https://video.twimg.com/x.mp4' })).toContain('/proxy?url=')
  })

  test('playSrc uses the direct url when proxyBase is empty', () => {
    const { ctx } = makeInstance({ proxyBase: '' })
    expect(ctx.playSrc({ url: 'https://video.twimg.com/x.mp4' })).toBe('https://video.twimg.com/x.mp4')
  })
})

describe('bestMp4Url', () => {
  test('picks the highest-bitrate progressive mp4 variant', () => {
    const { ctx } = makeInstance()
    const video = {
      url: 'https://video.twimg.com/fallback.mp4',
      variants: [
        { url: 'https://video.twimg.com/low.mp4', bitrate: 320000 },
        { url: 'https://video.twimg.com/high.mp4', bitrate: 2176000 },
        { url: 'https://video.twimg.com/mid.mp4', bitrate: 832000 },
      ],
    }
    expect(ctx.bestMp4Url(video)).toBe('https://video.twimg.com/high.mp4')
  })

  test('never selects an .m3u8 HLS playlist', () => {
    const { ctx } = makeInstance()
    const video = {
      url: 'https://video.twimg.com/fallback.mp4',
      variants: [
        { url: 'https://video.twimg.com/playlist.m3u8', bitrate: 9999999 },
        { url: 'https://video.twimg.com/prog.mp4', bitrate: 500000 },
      ],
    }
    expect(ctx.bestMp4Url(video)).toBe('https://video.twimg.com/prog.mp4')
  })

  test('supports the `formats` alias for variants', () => {
    const { ctx } = makeInstance()
    const video = {
      url: 'https://video.twimg.com/fallback.mp4',
      formats: [{ url: 'https://video.twimg.com/f.mp4', bitrate: 1000 }],
    }
    expect(ctx.bestMp4Url(video)).toBe('https://video.twimg.com/f.mp4')
  })

  test('falls back to video.url when there are no mp4 variants', () => {
    const { ctx } = makeInstance()
    expect(ctx.bestMp4Url({ url: 'https://video.twimg.com/only.mp4' }))
      .toBe('https://video.twimg.com/only.mp4')
  })
})

describe('buildFilename', () => {
  test('uses author handle + video id', () => {
    const { ctx } = makeInstance({ tweet: { author: { screen_name: 'jack' } }, videos: [{}] })
    expect(ctx.buildFilename({ id: '999' }, 0)).toBe('jack_999.mp4')
  })

  test('adds a 1-based index suffix when the post has multiple videos', () => {
    const { ctx } = makeInstance({ tweet: { author: { screen_name: 'jack' } }, videos: [{}, {}] })
    expect(ctx.buildFilename({ id: '999' }, 1)).toBe('jack_999_2.mp4')
  })

  test('falls back to "x" handle and tweet id when fields are missing', () => {
    const { ctx } = makeInstance({ tweet: { id: '42' }, videos: [{}] })
    expect(ctx.buildFilename({}, 0)).toBe('x_42.mp4')
  })
})

describe('tryFetchVideo', () => {
  test('returns a Blob for a valid, large, video-typed response', async () => {
    const blob = { size: 500_000, type: 'video/mp4' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x.mp4')).resolves.toBe(blob)
  })

  test('returns null on non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, blob: async () => ({}) })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x.mp4')).resolves.toBeNull()
  })

  test('rejects tiny blobs (proxy error page masquerading as 200)', async () => {
    const blob = { size: 512, type: 'text/html' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })

  test('rejects a large but non-video MIME type', async () => {
    const blob = { size: 500_000, type: 'application/json' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })

  test('accepts octet-stream (some proxies omit the video type)', async () => {
    const blob = { size: 500_000, type: 'application/octet-stream' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBe(blob)
  })

  test('returns null when fetch throws / aborts', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted'))
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })
})

describe('fetchVideos (fxtwitter integration)', () => {
  function mockJson(body, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body })
  }

  test('bails early with a friendly error on an invalid URL (no network call)', async () => {
    global.fetch = jest.fn()
    const { ctx } = makeInstance({ url: 'https://youtube.com/watch?v=x' })
    await ctx.fetchVideos()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(ctx.error).toMatch(/valid X post URL/)
    expect(ctx.loading).toBe(false)
  })

  test('populates tweet + videos on success and toasts the count', async () => {
    mockJson({
      code: 200,
      tweet: {
        author: { screen_name: 'jack' },
        media: { videos: [{ url: 'https://video.twimg.com/a.mp4' }] },
      },
    })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.fxtwitter.com/jack/status/20')
    expect(ctx.videos).toHaveLength(1)
    expect(ctx.error).toBeNull()
    expect(ctx.toasts.some((t) => /1 video found/.test(t.message))).toBe(true)
  })

  test('post with no videos toasts a warning and leaves videos empty', async () => {
    mockJson({ code: 200, tweet: { media: { videos: [] } } })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.videos).toEqual([])
    expect(ctx.toasts.some((t) => /No videos/.test(t.message))).toBe(true)
  })

  test.each([
    [404, /not found/i],
    [401, /protected account/i],
    [403, /restricted/i],
  ])('maps fxtwitter code %s to a friendly message', async (code, re) => {
    mockJson({ code }, true)
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(re)
    expect(ctx.loading).toBe(false)
  })

  test('unknown code produces a generic error including the code', async () => {
    mockJson({ code: 500 }, false)
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/error 500/)
  })

  test('network TypeError becomes a connection-error message', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/Network error/)
  })
})

describe('clearInput', () => {
  test('resets url, tweet, videos and error back to the empty state', () => {
    const { ctx } = makeInstance({
      url: 'https://x.com/jack/status/20',
      tweet: { id: '20' },
      videos: [{}, {}],
      error: 'boom',
    })
    ctx.clearInput()
    expect(ctx.url).toBe('')
    expect(ctx.tweet).toBeNull()
    expect(ctx.videos).toEqual([])
    expect(ctx.error).toBeNull()
  })
})

describe('fetchVideos — hardening', () => {
  test('a non-JSON (HTML) response yields a friendly service error, not a SyntaxError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
    })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/unexpected response/i)
    expect(ctx.error).not.toMatch(/SyntaxError|token/)
    expect(ctx.loading).toBe(false)
  })

  test('a timeout / abort yields a timeout message', async () => {
    global.fetch = jest.fn().mockRejectedValue(abortError())
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/timed out/i)
    expect(ctx.loading).toBe(false)
  })

  test('passes an AbortSignal to fetch so the request can be timed out', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 200, tweet: { media: { videos: [] } } }) })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    const init = global.fetch.mock.calls[0][1]
    expect(init.signal).toBeDefined()
  })
})

describe('pasteAndFetch', () => {
  function stubClipboard(impl) {
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { readText: impl },
      configurable: true,
    })
  }

  test('reads a URL from the clipboard, sets it, and fetches', async () => {
    stubClipboard(async () => 'https://x.com/jack/status/20')
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, tweet: { media: { videos: [{ url: 'https://video.twimg.com/a.mp4' }] } } }),
    })
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(ctx.url).toBe('https://x.com/jack/status/20')
    expect(global.fetch).toHaveBeenCalled()
    expect(ctx.videos).toHaveLength(1)
  })

  test('empty clipboard warns and does not fetch', async () => {
    stubClipboard(async () => '   ')
    global.fetch = jest.fn()
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(ctx.toasts.some((t) => /empty/i.test(t.message))).toBe(true)
  })

  test('blocked clipboard (throws) warns and does not fetch', async () => {
    stubClipboard(async () => { throw new Error('denied') })
    global.fetch = jest.fn()
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(ctx.toasts.some((t) => /clipboard/i.test(t.message))).toBe(true)
  })
})

describe('mounted() cookie notice', () => {
  function runMounted(overrides = {}) {
    const { options } = loadApp()
    const ctx = { ...options.data(), $nextTick: (fn) => fn && fn(), ...overrides }
    options.mounted.call(ctx)
    return ctx
  }

  test('shows the notice when it has never been acknowledged', () => {
    localStorage.clear()
    const ctx = runMounted()
    expect(ctx.showCookieNotice).toBe(true)
  })

  test('hides the notice once acknowledgement is stored', () => {
    localStorage.setItem('cookieNoticeAck', '1')
    const ctx = runMounted()
    expect(ctx.showCookieNotice).toBe(false)
  })
})

describe('acceptCookies', () => {
  test('hides the notice and persists acknowledgement', () => {
    localStorage.clear()
    const { ctx } = makeInstance({ showCookieNotice: true })
    ctx.acceptCookies()
    expect(ctx.showCookieNotice).toBe(false)
    expect(localStorage.getItem('cookieNoticeAck')).toBe('1')
  })
})

describe('toast', () => {
  test('pushes a toast then auto-dismisses it after the timeout', () => {
    jest.useFakeTimers()
    try {
      const { ctx } = makeInstance()
      ctx.toast('hello', 'success', 'bi-check')
      expect(ctx.toasts).toHaveLength(1)
      expect(ctx.toasts[0]).toMatchObject({ message: 'hello', type: 'success', icon: 'bi-check' })
      jest.advanceTimersByTime(4000)
      expect(ctx.toasts).toHaveLength(0)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('saveBlob', () => {
  test('creates an object URL, clicks a download anchor, and revokes later', () => {
    jest.useFakeTimers()
    try {
      const createSpy = jest.fn(() => 'blob:fake')
      const revokeSpy = jest.fn()
      global.URL.createObjectURL = createSpy
      global.URL.revokeObjectURL = revokeSpy
      const clickSpy = jest
        .spyOn(window.HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {})

      const { ctx } = makeInstance()
      ctx.saveBlob({ size: 1 }, 'jack_20.mp4')

      expect(createSpy).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
      expect(document.querySelector('a')).toBeNull() // anchor removed after click
      jest.advanceTimersByTime(60_000)
      expect(revokeSpy).toHaveBeenCalledWith('blob:fake')
      clickSpy.mockRestore()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('downloadVideo (fallback chain)', () => {
  test('saves via the first strategy that yields a valid blob', async () => {
    const blob = { size: 500_000, type: 'video/mp4' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const saveBlob = jest.fn()
    const { ctx } = makeInstance({
      tweet: { author: { screen_name: 'jack' } },
      videos: [{}],
      saveBlob,
    })
    await ctx.downloadVideo({ id: '20', url: 'https://video.twimg.com/x.mp4' }, 0)
    // First strategy is the Worker proxy — one fetch, then save.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toContain('/proxy?url=')
    expect(saveBlob).toHaveBeenCalledWith(blob, 'jack_20.mp4')
    expect(ctx.downloadingIdx).toBeNull()
  })

  test('falls through every fetch strategy then opens a manual-save anchor', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, blob: async () => ({}) })
    const clickSpy = jest
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const { ctx } = makeInstance({
      tweet: { author: { screen_name: 'jack' } },
      videos: [{}],
      saveBlob: jest.fn(),
    })
    await ctx.downloadVideo({ id: '20', url: 'https://video.twimg.com/x.mp4' }, 0)
    // Worker + direct + 4 public proxies = 6 attempts.
    expect(global.fetch).toHaveBeenCalledTimes(6)
    expect(clickSpy).toHaveBeenCalled() // manual-save anchor
    expect(ctx.downloadingIdx).toBeNull()
    clickSpy.mockRestore()
  })

  test('with no Worker configured, the chain drops to 5 attempts (direct + 4 proxies)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, blob: async () => ({}) })
    const clickSpy = jest
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const { ctx } = makeInstance({
      proxyBase: '',
      tweet: { author: { screen_name: 'jack' } },
      videos: [{}],
      saveBlob: jest.fn(),
    })
    await ctx.downloadVideo({ id: '20', url: 'https://video.twimg.com/x.mp4' }, 0)
    expect(global.fetch).toHaveBeenCalledTimes(5)
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})
