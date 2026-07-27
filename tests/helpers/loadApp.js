// Loads the REAL Vue app options object out of public/index.html so tests
// exercise the shipped code, not a copy that could drift out of sync.
//
// The app is a single-file, bundler-free Vue 3 app: its logic lives in a plain
// inline <script> that does `const { createApp } = Vue` then
// `createApp({...}).mount('#app')`. We read that <script>, stub a global `Vue`
// whose `createApp` captures the options object (and returns a fake with a
// no-op `.mount`), and eval the script. What we get back — data(), methods,
// mounted() — is exactly what runs in production.
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const INDEX_HTML = path.join(__dirname, '..', '..', 'public', 'index.html')

// Pull out the inline application <script> (the one that references createApp).
// There are two <script> tags: the AdSense loader (async, has src=) and the
// Vue CDN (has src=). The app script is the only inline one containing
// `createApp(`.
function extractAppScript(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  for (const [, attrs, body] of scripts) {
    if (!/\bsrc=/.test(attrs) && /createApp\s*\(/.test(body)) return body
  }
  throw new Error('Could not find the inline Vue app <script> in index.html')
}

// Evaluate the app script against the current global (jsdom) context, capturing
// the options passed to createApp(). Returns { options, PROXY_BASE, ADSENSE_SLOT }.
function loadApp() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8')
  const body = extractAppScript(html)

  let captured = null
  const fakeVue = {
    createApp(options) {
      captured = options
      return { mount() { /* no-op: we don't need a real mount for unit tests */ } }
    },
  }

  // Run in the same global context jsdom set up (document, navigator, etc.),
  // but inject our Vue stub. `new Function` scopes `Vue` without leaking it.
  // eslint-disable-next-line no-new-func
  const run = new Function('Vue', body)
  run(fakeVue)

  if (!captured) throw new Error('createApp was not called by the app script')

  // Surface the module-level consts the script defines for assertions.
  const PROXY_BASE = extractConst(body, 'PROXY_BASE')
  const ADSENSE_SLOT = extractConst(body, 'ADSENSE_SLOT')

  return { options: captured, PROXY_BASE, ADSENSE_SLOT }
}

function extractConst(body, name) {
  const m = body.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']*)'`))
  return m ? m[1] : undefined
}

// Build a fresh component instance: a `this` context that merges data() with
// the methods (bound to that context), so `this.foo()` works like in Vue.
// Extra overrides (refs, spies) can be merged in via `overrides`.
function makeInstance(overrides = {}) {
  const { options } = loadApp()
  const ctx = { ...options.data(), $refs: {}, $nextTick: (fn) => fn && fn() }
  for (const [name, fn] of Object.entries(options.methods)) {
    ctx[name] = fn.bind(ctx)
  }
  Object.assign(ctx, overrides)
  return { ctx, options }
}

module.exports = { loadApp, makeInstance, extractAppScript, INDEX_HTML }
