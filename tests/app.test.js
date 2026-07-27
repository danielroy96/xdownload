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

describe('Configuration guards', () => {
  test('the download proxy points at the live Worker, not a dead workers.dev', () => {
    const { PROXY_BASE } = loadApp()
    expect(PROXY_BASE).toBe('https://xdownload.info')
    // The classic breakage was a dead *.workers.dev subdomain — guard it.
    expect(PROXY_BASE).not.toMatch(/workers\.dev/)
    expect(PROXY_BASE).not.toMatch(/\/$/) // no trailing slash
  })

  test('the ad slot is the real one, not the placeholder', () => {
    const { ADSENSE_SLOT } = loadApp()
    expect(ADSENSE_SLOT).toBe('5120476027')
    expect(ADSENSE_SLOT.startsWith('1111')).toBe(false)
  })
})

describe('Initial state', () => {
  test('starts empty with the proxy base normalized', () => {
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

describe('Understanding pasted post URLs', () => {
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
  test.each(cases)('accepts %s', (input, expected) => {
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
  test.each(bad)('rejects a non-post link: %s', (input) => {
    const { ctx } = makeInstance()
    expect(ctx.parseTweetUrl(input)).toBeNull()
  })
})

describe('Building playback & download URLs', () => {
  test('routes a video through the download proxy', () => {
    const { ctx } = makeInstance()
    const url = ctx.proxied('https://video.twimg.com/a b.mp4')
    expect(url).toBe(
      'https://xdownload.info/proxy?url=' +
        encodeURIComponent('https://video.twimg.com/a b.mp4')
    )
  })

  test('includes the download filename when one is given', () => {
    const { ctx } = makeInstance()
    const url = ctx.proxied('https://video.twimg.com/x.mp4', 'jack_20.mp4')
    expect(url).toContain('&dl=jack_20.mp4')
  })

  test('plays through the proxy when one is configured', () => {
    const { ctx } = makeInstance()
    expect(ctx.playSrc({ url: 'https://video.twimg.com/x.mp4' })).toContain('/proxy?url=')
  })

  test('plays the video directly when no proxy is configured', () => {
    const { ctx } = makeInstance({ proxyBase: '' })
    expect(ctx.playSrc({ url: 'https://video.twimg.com/x.mp4' })).toBe('https://video.twimg.com/x.mp4')
  })
})

describe('Choosing the best video quality', () => {
  test('picks the highest-quality MP4', () => {
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

  test('never picks an unplayable HLS playlist', () => {
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

  test('understands the alternate "formats" field', () => {
    const { ctx } = makeInstance()
    const video = {
      url: 'https://video.twimg.com/fallback.mp4',
      formats: [{ url: 'https://video.twimg.com/f.mp4', bitrate: 1000 }],
    }
    expect(ctx.bestMp4Url(video)).toBe('https://video.twimg.com/f.mp4')
  })

  test('falls back to the base URL when no variants are listed', () => {
    const { ctx } = makeInstance()
    expect(ctx.bestMp4Url({ url: 'https://video.twimg.com/only.mp4' }))
      .toBe('https://video.twimg.com/only.mp4')
  })
})

describe('Naming the downloaded file', () => {
  test('names the file after the author and post', () => {
    const { ctx } = makeInstance({ tweet: { author: { screen_name: 'jack' } }, videos: [{}] })
    expect(ctx.buildFilename({ id: '999' }, 0)).toBe('jack_999.mp4')
  })

  test('numbers the files when a post has several videos', () => {
    const { ctx } = makeInstance({ tweet: { author: { screen_name: 'jack' } }, videos: [{}, {}] })
    expect(ctx.buildFilename({ id: '999' }, 1)).toBe('jack_999_2.mp4')
  })

  test('still builds a sensible name when data is missing', () => {
    const { ctx } = makeInstance({ tweet: { id: '42' }, videos: [{}] })
    expect(ctx.buildFilename({}, 0)).toBe('x_42.mp4')
  })
})

describe('Fetching a video safely', () => {
  test('accepts a genuine video response', async () => {
    const blob = { size: 500_000, type: 'video/mp4' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x.mp4')).resolves.toBe(blob)
  })

  test('rejects a failed (non-OK) response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, blob: async () => ({}) })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x.mp4')).resolves.toBeNull()
  })

  test('rejects a tiny blob — an error page pretending to be a video', async () => {
    const blob = { size: 512, type: 'text/html' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })

  test('rejects a non-video file', async () => {
    const blob = { size: 500_000, type: 'application/json' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })

  test('accepts octet-stream, which some proxies send instead of a video type', async () => {
    const blob = { size: 500_000, type: 'application/octet-stream' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBe(blob)
  })

  test('gives up quietly when the download fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted'))
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })
})

describe("Fetching a post's videos", () => {
  function mockJson(body, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body })
  }

  test('refuses an invalid URL without hitting the network', async () => {
    global.fetch = jest.fn()
    const { ctx } = makeInstance({ url: 'https://youtube.com/watch?v=x' })
    await ctx.fetchVideos()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(ctx.error).toMatch(/valid X post URL/)
    expect(ctx.loading).toBe(false)
  })

  test('loads the videos and confirms how many were found', async () => {
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

  test('warns when a post has no videos', async () => {
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
  ])('turns fxtwitter error %s into a friendly message', async (code, re) => {
    mockJson({ code }, true)
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(re)
    expect(ctx.loading).toBe(false)
  })

  test('shows a generic message for an unrecognized error', async () => {
    mockJson({ code: 500 }, false)
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/error 500/)
  })

  test('explains a dropped connection', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/Network error/)
  })
})

describe('Clearing the form', () => {
  test('resets everything back to the empty state', () => {
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

describe('Fetching videos — error resilience', () => {
  test('survives a non-JSON response with a friendly message', async () => {
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

  test('shows a timeout message when the API is slow', async () => {
    global.fetch = jest.fn().mockRejectedValue(abortError())
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/timed out/i)
    expect(ctx.loading).toBe(false)
  })

  test('sets a timeout on the request', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 200, tweet: { media: { videos: [] } } }) })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    const init = global.fetch.mock.calls[0][1]
    expect(init.signal).toBeDefined()
  })
})

describe('Paste-and-go', () => {
  function stubClipboard(impl) {
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { readText: impl },
      configurable: true,
    })
  }

  test('fetches straight from a copied URL', async () => {
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

  test('warns when the clipboard is empty', async () => {
    stubClipboard(async () => '   ')
    global.fetch = jest.fn()
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(ctx.toasts.some((t) => /empty/i.test(t.message))).toBe(true)
  })

  test('warns when clipboard access is blocked', async () => {
    stubClipboard(async () => { throw new Error('denied') })
    global.fetch = jest.fn()
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(ctx.toasts.some((t) => /clipboard/i.test(t.message))).toBe(true)
  })
})

describe('Cookie notice', () => {
  function runMounted(overrides = {}) {
    const { options } = loadApp()
    const ctx = { ...options.data(), $nextTick: (fn) => fn && fn(), ...overrides }
    options.mounted.call(ctx)
    return ctx
  }

  test('appears on a first visit', () => {
    localStorage.clear()
    const ctx = runMounted()
    expect(ctx.showCookieNotice).toBe(true)
  })

  test('stays hidden once accepted', () => {
    localStorage.setItem('cookieNoticeAck', '1')
    const ctx = runMounted()
    expect(ctx.showCookieNotice).toBe(false)
  })
})

describe('Accepting the cookie notice', () => {
  test('hides the notice and remembers the choice', () => {
    localStorage.clear()
    const { ctx } = makeInstance({ showCookieNotice: true })
    ctx.acceptCookies()
    expect(ctx.showCookieNotice).toBe(false)
    expect(localStorage.getItem('cookieNoticeAck')).toBe('1')
  })
})

describe('Toast notifications', () => {
  test('appears then disappears on its own', () => {
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

describe('Saving a file to disk', () => {
  test('triggers the browser download and cleans up afterwards', () => {
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

describe('Downloading a video (with fallbacks)', () => {
  test('saves as soon as one source works', async () => {
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

  test('tries every source, then offers a manual save', async () => {
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

  test('skips the Worker step when none is configured', async () => {
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
