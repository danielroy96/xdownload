// xDownload — application bootstrap.
//
// The ONLY module that touches Vue and the DOM. It imports Vue (bundled from our
// own origin via Vite — no unpkg/CDN single-point-of-failure), the app options,
// and the page styles, then mounts.
//
// The `vue` specifier is aliased to `vue/dist/vue.esm-bundler.js` in
// vite.config.js so the runtime template compiler ships — that's what lets the
// in-DOM template inside <div id="app"> (in index.html) compile at mount time,
// exactly as the old vue.global.js build did. See the plan/CLAUDE notes.
import { createApp } from 'vue'
import { appOptions } from './app.js'
import { revealFallback, startBootWatchdog } from './boot.js'
import './styles/page.css'

// ── Boot with a fail-safe ────────────────────────────────────────────────────
// Historically a failed framework load left users staring at a blank page. Now:
//   • #app carries `v-cloak`, hidden by critical CSS until Vue removes it on a
//     successful mount (also prevents a flash of the raw, uncompiled template);
//   • if mount() throws, OR #app still has v-cloak after a grace period (mount
//     silently never happened), we reveal the static #boot-fallback block in
//     index.html so the user gets a message + a refresh path instead of nothing.
try {
  createApp(appOptions).mount('#app')
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('xDownload failed to mount:', err)
  revealFallback()
}

startBootWatchdog(4000)
