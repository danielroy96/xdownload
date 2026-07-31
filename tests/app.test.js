/**
 * Tests for the Vue app options in src/app.js.
 *
 * The app's logic is imported directly from the real module, so these tests
 * track the shipped code. Methods are exercised against a `this` context built
 * from the component's own setup()/data()/computed/methods, exactly as Vue would
 * (see tests/helpers/makeInstance).
 *
 * Mocking uses Vitest throughout: `vi.stubGlobal` for `fetch` and `vi.spyOn` for
 * DOM APIs. vitest.config.js enables unstubGlobals + restoreMocks, so stubs and
 * spies are torn down automatically between tests — no manual cleanup here.
 *
 * @vitest-environment jsdom
 */
import { nextTick } from 'vue'
import { appOptions as options, PROXY_BASE, ADSENSE_SLOT } from '../src/app.js'
import { makeInstance } from './helpers/makeInstance.js'

// ── Mocking helpers ───────────────────────────────────────────────────────────

// Replace global.fetch with a mock that resolves to `value` (or runs `impl`).
// Returns the mock so a test can assert on how it was called.
function mockFetch(valueOrImpl) {
  const fn = typeof valueOrImpl === 'function'
    ? vi.fn(valueOrImpl)
    : vi.fn().mockResolvedValue(valueOrImpl)
  vi.stubGlobal('fetch', fn)
  return fn
}

// Replace global.fetch with a mock that rejects (network failure / abort).
function mockFetchReject(err) {
  const fn = vi.fn().mockRejectedValue(err)
  vi.stubGlobal('fetch', fn)
  return fn
}

// A fake fxtwitter response: an HTTP-level `ok` plus a JSON body.
function mockFxtwitter(body, ok = true) {
  return mockFetch({ ok, json: async () => body })
}

// An AbortError as fetch throws when a request times out / is aborted.
function abortError() {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

// ──────────────────────────────────────────────────────────────────────────────

describe('Configuration guards', () => {
  test('derives the download proxy from the serving origin, never a dead absolute URL', () => {
    // PROXY_BASE is now window.location.origin (jsdom is pinned to
    // https://xdownload.info/ in vitest.config.js), so the app and /proxy are
    // ALWAYS same-origin — it can never point at a dead absolute host again
    // (the workers.dev 1042 outage class).
    expect(PROXY_BASE).toBe(window.location.origin)
    expect(PROXY_BASE).toBe('https://xdownload.info')
    // The classic breakage was a dead *.workers.dev subdomain — guard it.
    expect(PROXY_BASE).not.toMatch(/workers\.dev/)
    expect(PROXY_BASE).not.toMatch(/\/$/) // no trailing slash
  })

  test('uses the real AdSense ad slot, not the dormant placeholder', () => {
    expect(ADSENSE_SLOT).toBe('5120476027')
    expect(ADSENSE_SLOT.startsWith('1111')).toBe(false)
  })
})

describe('Initial state', () => {
  test('starts empty with the proxy base normalized', () => {
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
    ['a plain x.com post link', 'https://x.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['a twitter.com link', 'https://twitter.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['a www.twitter.com link', 'https://www.twitter.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['a mobile.twitter.com link', 'https://mobile.twitter.com/jack/status/20', { username: 'jack', tweetId: '20' }],
    ['a link with no scheme (https is prepended)', 'x.com/user_1/status/1234567890', { username: 'user_1', tweetId: '1234567890' }],
    ['a link with a trailing /video/1 and query', 'https://x.com/jack/status/20/video/1?s=20', { username: 'jack', tweetId: '20' }],
    ['a link with surrounding whitespace', '   https://x.com/jack/status/20  ', { username: 'jack', tweetId: '20' }],
  ]
  test.each(cases)('accepts %s', (_label, input, expected) => {
    const { ctx } = makeInstance()
    expect(ctx.parseTweetUrl(input)).toEqual(expected)
  })

  const bad = [
    ['a non-X URL', 'https://youtube.com/watch?v=abc'],
    ['a profile link with no /status/', 'https://x.com/jack'],
    ['a status link with no id', 'https://x.com/jack/status/'],
    ['a string that is not a URL', 'not a url at all'],
    ['a link missing the username segment', 'https://x.com/status/20'],
  ]
  test.each(bad)('rejects %s', (_label, input) => {
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

  test('appends the download filename when one is given', () => {
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
  test('picks the highest-bitrate MP4', () => {
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

  test('never picks an unplayable HLS (.m3u8) playlist, even if higher bitrate', () => {
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
  test('names the file after the author and post id', () => {
    const { ctx } = makeInstance({ tweet: { author: { screen_name: 'jack' } }, videos: [{}] })
    expect(ctx.buildFilename({ id: '999' }, 0)).toBe('jack_999.mp4')
  })

  test('numbers the files when a post has several videos', () => {
    const { ctx } = makeInstance({ tweet: { author: { screen_name: 'jack' } }, videos: [{}, {}] })
    expect(ctx.buildFilename({ id: '999' }, 1)).toBe('jack_999_2.mp4')
  })

  test('still builds a sensible name when author/id are missing', () => {
    const { ctx } = makeInstance({ tweet: { id: '42' }, videos: [{}] })
    expect(ctx.buildFilename({}, 0)).toBe('x_42.mp4')
  })
})

describe('Fetching a candidate video safely', () => {
  test('accepts a genuine video response', async () => {
    const blob = { size: 500_000, type: 'video/mp4' }
    mockFetch({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x.mp4')).resolves.toBe(blob)
  })

  test('rejects a failed (non-OK) response', async () => {
    mockFetch({ ok: false, blob: async () => ({}) })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x.mp4')).resolves.toBeNull()
  })

  test('rejects a tiny blob — an error page masquerading as a video', async () => {
    mockFetch({ ok: true, blob: async () => ({ size: 512, type: 'text/html' }) })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })

  test('rejects a non-video content type', async () => {
    mockFetch({ ok: true, blob: async () => ({ size: 500_000, type: 'application/json' }) })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })

  test('accepts octet-stream, which some proxies send instead of a video type', async () => {
    const blob = { size: 500_000, type: 'application/octet-stream' }
    mockFetch({ ok: true, blob: async () => blob })
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBe(blob)
  })

  test('gives up quietly when the fetch throws', async () => {
    mockFetchReject(new Error('aborted'))
    const { ctx } = makeInstance()
    await expect(ctx.tryFetchVideo('https://x/x')).resolves.toBeNull()
  })
})

describe("Fetching a post's videos from fxtwitter", () => {
  test('refuses an invalid URL without hitting the network', async () => {
    const fetchMock = mockFetch(undefined)
    const { ctx } = makeInstance({ url: 'https://youtube.com/watch?v=x' })
    await ctx.fetchVideos()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.error).toMatch(/valid X post URL/)
    expect(ctx.loading).toBe(false)
  })

  test('loads the videos and reports how many were found', async () => {
    const fetchMock = mockFxtwitter({
      code: 200,
      tweet: {
        author: { screen_name: 'jack' },
        media: { videos: [{ url: 'https://video.twimg.com/a.mp4' }] },
      },
    })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.fxtwitter.com/jack/status/20')
    expect(ctx.videos).toHaveLength(1)
    expect(ctx.error).toBeNull()
    expect(ctx.toasts.some((t) => /1 video found/.test(t.message))).toBe(true)
  })

  test('warns when a post contains no videos', async () => {
    mockFxtwitter({ code: 200, tweet: { media: { videos: [] } } })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.videos).toEqual([])
    expect(ctx.toasts.some((t) => /No videos/.test(t.message))).toBe(true)
  })

  test.each([
    ['a deleted/unknown post (404)', 404, /not found/i],
    ['a protected account (401)', 401, /protected account/i],
    ['a restricted post (403)', 403, /restricted/i],
  ])('turns %s into a friendly message', async (_label, code, re) => {
    mockFxtwitter({ code }, true)
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(re)
    expect(ctx.loading).toBe(false)
  })

  test('shows a generic message for an unrecognized error code', async () => {
    mockFxtwitter({ code: 500 }, false)
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/error 500/)
  })

  test('explains a dropped connection as a network error', async () => {
    mockFetchReject(new TypeError('Failed to fetch'))
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

describe("Fetching a post's videos — error resilience", () => {
  test('survives a non-JSON response with a friendly message (not a raw SyntaxError)', async () => {
    mockFetch({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
    })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/unexpected response/i)
    expect(ctx.error).not.toMatch(/SyntaxError|token/)
    expect(ctx.loading).toBe(false)
  })

  test('shows a timeout message when the API is slow (request aborts)', async () => {
    mockFetchReject(abortError())
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(ctx.error).toMatch(/timed out/i)
    expect(ctx.loading).toBe(false)
  })

  test('time-boxes the request with an AbortController signal', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ code: 200, tweet: { media: { videos: [] } } }) })
    const { ctx } = makeInstance({ url: 'https://x.com/jack/status/20' })
    await ctx.fetchVideos()
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined()
  })
})

describe('Paste-and-go from the clipboard', () => {
  function stubClipboard(readText) {
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    })
  }

  test('fetches straight from a copied post URL', async () => {
    stubClipboard(async () => 'https://x.com/jack/status/20')
    const fetchMock = mockFxtwitter({
      code: 200,
      tweet: { media: { videos: [{ url: 'https://video.twimg.com/a.mp4' }] } },
    })
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(ctx.url).toBe('https://x.com/jack/status/20')
    expect(fetchMock).toHaveBeenCalled()
    expect(ctx.videos).toHaveLength(1)
  })

  test('warns when the clipboard is empty', async () => {
    stubClipboard(async () => '   ')
    const fetchMock = mockFetch(undefined)
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.toasts.some((t) => /empty/i.test(t.message))).toBe(true)
  })

  test('warns when clipboard access is blocked', async () => {
    stubClipboard(async () => { throw new Error('denied') })
    const fetchMock = mockFetch(undefined)
    const { ctx } = makeInstance()
    await ctx.pasteAndFetch()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.toasts.some((t) => /clipboard/i.test(t.message))).toBe(true)
  })
})

describe('Cookie notice (localStorage-backed via VueUse)', () => {
  // State is read at setup() time, so seed storage BEFORE makeInstance().
  test('appears on a first visit', () => {
    window.localStorage.clear()
    const { ctx } = makeInstance()
    expect(ctx.showCookieNotice).toBe(true)
  })

  test('stays hidden once accepted (persisted across a reload)', () => {
    window.localStorage.clear()
    window.localStorage.setItem('cookieNoticeAck', '1')
    const { ctx } = makeInstance()
    expect(ctx.showCookieNotice).toBe(false)
  })
})

describe('Accepting the cookie notice', () => {
  test('hides the notice and remembers the choice in localStorage', async () => {
    window.localStorage.clear()
    const { ctx } = makeInstance()
    expect(ctx.showCookieNotice).toBe(true)
    ctx.acceptCookies()
    // Computed flips reactively off the storage-backed ref…
    expect(ctx.showCookieNotice).toBe(false)
    // …and the VueUse ref flushes the '1' convention through to storage.
    await nextTick()
    expect(window.localStorage.getItem('cookieNoticeAck')).toBe('1')
  })
})

describe('Toast notifications', () => {
  test('appears then disappears on its own after 4s', () => {
    vi.useFakeTimers()
    try {
      const { ctx } = makeInstance()
      ctx.toast('hello', 'success', 'bi-check')
      expect(ctx.toasts).toHaveLength(1)
      expect(ctx.toasts[0]).toMatchObject({ message: 'hello', type: 'success', icon: 'bi-check' })
      vi.advanceTimersByTime(4000)
      expect(ctx.toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Saving a blob to disk', () => {
  test('triggers the browser download and cleans up the object URL afterwards', () => {
    vi.useFakeTimers()
    try {
      const createObjectURL = vi.fn(() => 'blob:fake')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', { ...global.URL, createObjectURL, revokeObjectURL })
      const clickSpy = vi
        .spyOn(window.HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {})

      const { ctx } = makeInstance()
      ctx.saveBlob({ size: 1 }, 'jack_20.mp4')

      expect(createObjectURL).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
      expect(document.querySelector('a')).toBeNull() // anchor removed after click
      vi.advanceTimersByTime(60_000)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Downloading a video (with the fallback chain)', () => {
  test('saves as soon as the first source (the Worker proxy) works', async () => {
    const blob = { size: 500_000, type: 'video/mp4' }
    const fetchMock = mockFetch({ ok: true, blob: async () => blob })
    const saveBlob = vi.fn()
    const { ctx } = makeInstance({
      tweet: { author: { screen_name: 'jack' } },
      videos: [{}],
      saveBlob,
    })
    await ctx.downloadVideo({ id: '20', url: 'https://video.twimg.com/x.mp4' }, 0)
    // First strategy is the Worker proxy — one fetch, then save.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/proxy?url=')
    expect(saveBlob).toHaveBeenCalledWith(blob, 'jack_20.mp4')
    expect(ctx.downloadingIdx).toBeNull()
  })

  test('tries every source, then offers a manual save', async () => {
    const fetchMock = mockFetch({ ok: false, blob: async () => ({}) })
    const clickSpy = vi
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const { ctx } = makeInstance({
      tweet: { author: { screen_name: 'jack' } },
      videos: [{}],
      saveBlob: vi.fn(),
    })
    await ctx.downloadVideo({ id: '20', url: 'https://video.twimg.com/x.mp4' }, 0)
    // Worker + direct + 4 public proxies = 6 attempts.
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(clickSpy).toHaveBeenCalled() // manual-save anchor
    expect(ctx.downloadingIdx).toBeNull()
  })

  test('skips the Worker step (5 attempts) when no proxy is configured', async () => {
    const fetchMock = mockFetch({ ok: false, blob: async () => ({}) })
    const clickSpy = vi
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const { ctx } = makeInstance({
      proxyBase: '',
      tweet: { author: { screen_name: 'jack' } },
      videos: [{}],
      saveBlob: vi.fn(),
    })
    await ctx.downloadVideo({ id: '20', url: 'https://video.twimg.com/x.mp4' }, 0)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(clickSpy).toHaveBeenCalled()
  })
})
