// Boot fail-safe helpers, split out of main.js so they can be unit-tested
// without importing Vue or triggering a real mount.
//
// The contract: index.html ships <div id="app" v-cloak> (hidden by critical CSS)
// and a hidden #boot-fallback block. Vue removes the v-cloak attribute on a
// successful mount. So "still has v-cloak" == "never mounted", and in that case
// we reveal the fallback instead of leaving the user on a blank page.

// Reveal the static boot-failure fallback. Returns true if the element existed.
export function revealFallback(doc = document) {
  const fb = doc.getElementById('boot-fallback')
  if (fb) fb.hidden = false
  return !!fb
}

// Did the Vue app mount? True once Vue has stripped v-cloak from #app.
export function appMounted(doc = document) {
  const app = doc.getElementById('app')
  return !!app && !app.hasAttribute('v-cloak')
}

// Arm a watchdog that reveals the fallback if the app hasn't mounted by `delay`.
// Returns the timer id (so callers/tests can clear it).
export function startBootWatchdog(delay = 4000, doc = document, timer = setTimeout) {
  return timer(() => {
    if (!appMounted(doc)) revealFallback(doc)
  }, delay)
}
