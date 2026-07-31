// xDownload — Vue app options (setup / data / computed / mounted / methods).
//
// Formerly the inline <script> in public/index.html. Now a real ES module so:
//   • Vue is bundled from our own origin (no unpkg SPOF), and
//   • tests import { appOptions, PROXY_BASE, ADSENSE_SLOT } directly instead of
//     regex/vm-extracting the inline script.
// The DOM template still lives in index.html and is compiled at runtime by the
// esm-bundler Vue build (see vite.config.js alias). Mounting happens in main.js.
import { computed, watch } from 'vue'
import { useLocalStorage, usePreferredDark } from '@vueuse/core'


// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — your own video proxy (recommended)
//
// Twitter's CDN (video.twimg.com) sends no CORS headers, so the browser can't
// read the video bytes to save them. The Cloudflare Worker in /worker serves
// this app AND exposes a /proxy endpoint that re-serves twimg video with CORS,
// giving reliable one-click downloads and in-page playback.
//
// Set this to the origin where the Worker is deployed (no trailing slash).
// Leave it as '' to fall back to public CORS proxies + manual save.
export const PROXY_BASE = window.location.origin
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE ADSENSE
//   ADSENSE_SLOT : the ad-unit slot ID from your AdSense dashboard.
//   Create an ad unit (Ads → By ad unit → Display ads), copy its slot ID here,
//   and set the SAME value on the <ins data-ad-slot="…"> above. Until then the
//   placeholder '1111111111' keeps the unit dormant so dev/preview stays clean.
export const ADSENSE_SLOT = '5120476027'
// ─────────────────────────────────────────────────────────────────────────────

export const appOptions = {
  // ── Persistent state (VueUse) ───────────────────────────────────────────────
  // The cookie-notice acknowledgement is backed by localStorage via VueUse's
  // useLocalStorage: a ref transparently synced to storage that degrades safely
  // when storage is unavailable (private mode / blocked / SSR) — no bare
  // `localStorage` access and no manual try/catch. We keep the historical '1'
  // string convention so visitors who already accepted aren't re-prompted.
  setup() {
    const cookieNoticeAck = useLocalStorage('cookieNoticeAck', '')

    // ── Dark mode ────────────────────────────────────────────────────────────
    // `theme` is the persisted preference: 'auto' follows the OS and live-updates
    // when the OS setting changes; 'light'/'dark' are explicit manual overrides
    // that stick until the user toggles again (independent of the OS). Default
    // 'auto' so a first-time visitor automatically matches their system theme.
    const theme = useLocalStorage('theme', 'auto')
    // Reactive mirror of the OS `prefers-color-scheme: dark` media query (VueUse
    // degrades to `false` where matchMedia is unavailable — e.g. jsdom/tests).
    const systemDark = usePreferredDark()
    // The RESOLVED theme actually shown: the manual choice when set, else the OS.
    const isDark = computed(() =>
      theme.value === 'auto' ? systemDark.value : theme.value === 'dark'
    )

    // Reflect the resolved theme onto <html data-theme> so the swapped brand.css
    // vars apply to the WHOLE document (navbar, footer, boot fallback), not just
    // inside Vue's #app root. `immediate` reconciles with whatever the early
    // inline <head> script set on first paint. We deliberately don't touch
    // Bootstrap's own `data-bs-theme` here — that's also set by the inline script
    // and kept in sync from index.html's mounted-side, keeping this logic pure
    // and unit-testable (no Bootstrap assumptions).
    watch(isDark, (dark) => {
      const el = document.documentElement
      el.setAttribute('data-theme', dark ? 'dark' : 'light')
      el.setAttribute('data-bs-theme', dark ? 'dark' : 'light')
    }, { immediate: true })

    return { cookieNoticeAck, theme, systemDark, isDark }
  },

  data() {
    return {
      url: '',
      loading: false,
      error: null,
      tweet: null,
      videos: [],
      downloadingIdx: null,
      toasts: [],
      _toastId: 0,
      proxyBase: PROXY_BASE.replace(/\/+$/, '')   // trailing slash trimmed
    }
  },

  computed: {
    // Show the cookie notice until the visitor has acknowledged it once. Derived
    // from the storage-backed ack ref, so it's correct on first paint and across
    // reloads without a mounted() hook reading storage.
    showCookieNotice() {
      return this.cookieNoticeAck !== '1'
    }
  },

  // ── AdSense init ────────────────────────────────────────────────────────────
  // The <ins> ad unit lives inside this Vue root, so we activate it after the
  // template has rendered. `push({})` tells AdSense to fill the slot. We skip it
  // while ADSENSE_SLOT is still the placeholder so dev/preview doesn't hit
  // AdSense with an invalid slot (which logs console errors).
  mounted() {
    if (ADSENSE_SLOT.startsWith('1111')) return
    this.$nextTick(() => {
      document.querySelectorAll('ins.adsbygoogle').forEach(() => {
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({})
        } catch (e) {
          /* AdSense not loaded (blocked / offline) — ignore */
        }
      })
    })
  },

  methods: {
    // ── Cookie notice ─────────────────────────────────────────────────────────
    // Persist the acknowledgement; the VueUse ref writes it to localStorage and
    // the showCookieNotice computed flips to false reactively.
    acceptCookies() {
      this.cookieNoticeAck = '1'
    },

    // ── Theme toggle ──────────────────────────────────────────────────────────
    // A manual toggle overrides the OS setting: persist the OPPOSITE of what's
    // currently showing. From then on the app shows that explicit choice
    // regardless of the OS, until the user toggles again — i.e. dark mode can be
    // driven independently of the system theme. (The isDark watcher in setup()
    // applies it to <html> and useLocalStorage persists it.)
    toggleTheme() {
      this.theme = this.isDark ? 'light' : 'dark'
    },

    // ── URL parsing ──────────────────────────────────────────────────────────
    parseTweetUrl(raw) {
      const url = raw.trim().replace(/^(?!https?:\/\/)/, 'https://')
      // Handles: x.com, twitter.com, mobile.twitter.com, www. prefix, /video/N suffix
      const m = url.match(
        /https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/
      )
      return m ? { username: m[1], tweetId: m[2] } : null
    },

    // ── Clear ──────────────────────────────────────────────────────────────
    // Reset the input and any results/errors back to the empty state.
    clearInput() {
      this.url = ''
      this.tweet = null
      this.videos = []
      this.error = null
    },

    // ── Paste & Fetch ─────────────────────────────────────────────────────────
    // When the field is empty, the primary button reads the clipboard, drops the
    // URL into the input, and fetches — one tap from a copied link to results.
    async pasteAndFetch() {
      let text
      try {
        text = await navigator.clipboard.readText()
      } catch {
        // Clipboard blocked (permission denied / insecure context) — let the
        // user paste manually.
        this.toast('Couldn’t read the clipboard — paste the URL manually', 'warning', 'bi-clipboard')
        this.$refs.urlInput?.focus()
        return
      }

      if (!text || !text.trim()) {
        this.toast('Clipboard is empty — copy a post URL first', 'warning', 'bi-clipboard')
        this.$refs.urlInput?.focus()
        return
      }

      this.url = text.trim()
      await this.fetchVideos()
    },

    // ── Fetch ────────────────────────────────────────────────────────────────
    async fetchVideos() {
      const trimmed = this.url.trim()
      if (!trimmed) return

      this.loading = true
      this.error = null
      this.tweet = null
      this.videos = []

      const parsed = this.parseTweetUrl(trimmed)
      if (!parsed) {
        this.error = 'That doesn\'t look like a valid X post URL. Expected format: https://x.com/username/status/123…'
        this.loading = false
        return
      }

      // Time-box the lookup so a hung request can't leave the button spinning
      // forever (mirrors the per-attempt timeout in tryFetchVideo).
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(
          `https://api.fxtwitter.com/${parsed.username}/status/${parsed.tweetId}`,
          { signal: controller.signal }
        )

        // fxtwitter answers with JSON; a rate-limit / outage page can be HTML,
        // which would make res.json() throw an unfriendly SyntaxError. Treat any
        // non-JSON body as a generic service error instead.
        let data
        try {
          data = await res.json()
        } catch {
          throw new Error('The lookup service returned an unexpected response. Please try again shortly.')
        }

        if (!res.ok || data.code !== 200) {
          const msg = {
            404: 'Post not found. It may have been deleted or the account may be private or suspended.',
            401: 'This post is from a protected account.',
            403: 'Access to this post is restricted.',
          }[data.code] || `Could not load post (error ${data.code ?? res.status}).`
          throw new Error(msg)
        }

        this.tweet = data.tweet
        this.videos = data.tweet?.media?.videos ?? []

        if (this.videos.length === 0) {
          this.toast('No videos in this post', 'warning', 'bi-camera-video-off')
        } else {
          this.toast(
            `${this.videos.length} video${this.videos.length !== 1 ? 's' : ''} found`,
            'success',
            'bi-check-circle-fill'
          )
        }

      } catch (err) {
        if (err?.name === 'AbortError') {
          this.error = 'The request timed out. Please try again.'
        } else if (err instanceof TypeError) {
          this.error = 'Network error — please check your connection and try again.'
        } else {
          this.error = err.message || 'Something went wrong. Please try again.'
        }
      } finally {
        clearTimeout(timer)
        this.loading = false
      }
    },

    // Build the proxied URL for a twimg resource via the configured Worker.
    // `dl` (optional) sets a download filename via Content-Disposition.
    proxied(targetUrl, dl) {
      let u = `${this.proxyBase}/proxy?url=${encodeURIComponent(targetUrl)}`
      if (dl) u += `&dl=${encodeURIComponent(dl)}`
      return u
    },

    // URL used for in-page playback. Routes through the Worker when configured
    // so playback is reliable (twimg can 403 hot-linked <video> by referer);
    // otherwise uses the direct URL, which works in most real browsers.
    playSrc(video) {
      return this.proxyBase ? this.proxied(video.url) : video.url
    },

    // ── Download ─────────────────────────────────────────────────────────────
    //
    // Twitter's CDN (video.twimg.com) sends NO CORS headers, so the page can't
    // read the raw bytes directly (the response is "opaque"). To produce the
    // download UX users expect — one click, file lands in Downloads — we fetch
    // the video through a proxy that re-serves it with `Access-Control-Allow-
    // Origin`, read the result into a Blob, and trigger a same-origin save.
    //
    // When PROXY_BASE is set we use your own Cloudflare Worker first — reliable,
    // unmetered by third parties, and never blocked. We then fall back through a
    // direct fetch and a few public proxies (best-effort), and finally to a
    // referrer-free <a download> so the user can always save manually. Each
    // attempt has a timeout so a dead proxy can't stall the chain.
    async downloadVideo(video, idx) {
      this.downloadingIdx = idx
      try {
        // Prefer the highest-bitrate direct MP4 (never the .m3u8 HLS playlist).
        const src = this.bestMp4Url(video)
        const filename = this.buildFilename(video, idx)

        // Turnstile token minted by the widget. Our Worker /proxy verifies it
        // server-side (siteverify) before serving a download. Sent as a header
        // so it stays out of the URL / access logs. Empty if the widget hasn't
        // solved yet — then our Worker 403s and we fall through to the other
        // strategies, exactly as when the Worker is unreachable.
        const token = this.turnstileToken()
        const proxyHeaders = token ? { 'cf-turnstile-response': token } : {}

        // Ordered list of fetch strategies: { url, headers }. First success wins.
        const strategies = [
          ...(this.proxyBase ? [{ url: this.proxied(src, filename), headers: proxyHeaders }] : []), // your Worker (preferred)
          { url: src },                                                       // direct (same-origin / CORS-enabled / local file)
          { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(src)}` },
          { url: `https://thingproxy.freeboard.io/fetch/${src}` },
          { url: `https://corsproxy.io/?url=${encodeURIComponent(src)}` },
          { url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(src)}` },
        ]

        for (const s of strategies) {
          const blob = await this.tryFetchVideo(s.url, s.headers || {})
          if (blob) {
            this.saveBlob(blob, filename)
            this.toast('Video saved to your downloads', 'success', 'bi-check-circle-fill')
            return
          }
        }

        // Every fetch path failed — hand off to the browser. rel="noreferrer"
        // avoids twimg's hot-link 403, so the video opens and can be saved via
        // the native player's right-click → "Save Video As".
        const a = document.createElement('a')
        a.href = src
        a.download = filename
        a.target = '_blank'
        a.rel = 'noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        this.toast(
          'Opening the video in a new tab — right-click it and choose “Save Video As”',
          'info',
          'bi-download'
        )
      } finally {
        this.downloadingIdx = null
        // Turnstile tokens are single-use: once our Worker redeems one at
        // siteverify it can't be reused. Reset the widget so the NEXT download
        // gets a fresh token instead of a "timeout-or-duplicate" rejection.
        this.resetTurnstile()
      }
    },

    // ── Turnstile helpers ─────────────────────────────────────────────────────
    // Current token from the rendered widget (empty string if unsolved/expired).
    turnstileToken() {
      try {
        return window.turnstile?.getResponse() || ''
      } catch {
        return ''
      }
    },

    // Clear the widget's redeemed token so a retry mints a fresh one.
    resetTurnstile() {
      try {
        window.turnstile?.reset()
      } catch { /* widget not rendered yet — nothing to reset */ }
    },

    // Fetch a candidate URL and return a Blob only if it's a real video file.
    // Returns null on any failure so the caller can fall through to the next.
    // `headers` carries the Turnstile token on our own Worker /proxy attempt.
    async tryFetchVideo(url, headers = {}, timeoutMs = 25000) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal, headers })
        if (!res.ok) return null
        const blob = await res.blob()
        // Reject HTML/JSON error pages some proxies return with a 200 status.
        if (blob.size < 100_000) return null
        if (blob.type && !/(video|octet-stream|mp4|mpeg)/i.test(blob.type)) return null
        return blob
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },

    // Trigger a same-origin Blob download.
    saveBlob(blob, filename) {
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    },

    // Pick the best progressive MP4 url, falling back to video.url.
    bestMp4Url(video) {
      const variants = (video.variants || video.formats || [])
        .filter(v => v.url && /\.mp4(\?|$)/.test(v.url))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
      return variants[0]?.url || video.url
    },

    // Build a descriptive, filesystem-safe filename.
    buildFilename(video, idx) {
      const handle = this.tweet?.author?.screen_name || 'x'
      const id = video.id || this.tweet?.id || 'video'
      const suffix = this.videos.length > 1 ? `_${idx + 1}` : ''
      return `${handle}_${id}${suffix}.mp4`
    },

    // ── Toast helper ─────────────────────────────────────────────────────────
    toast(message, type = 'info', icon = 'bi-info-circle-fill') {
      const id = ++this._toastId
      this.toasts.push({ id, message, type, icon })
      setTimeout(() => {
        const i = this.toasts.findIndex(t => t.id === id)
        if (i !== -1) this.toasts.splice(i, 1)
      }, 4000)
    }
  }
}
