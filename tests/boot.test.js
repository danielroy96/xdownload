/**
 * Tests for src/boot.js — the boot fail-safe that keeps a failed Vue mount from
 * leaving users on a blank page. Mirrors the markup index.html ships.
 *
 * @vitest-environment jsdom
 */
import { revealFallback, appMounted, startBootWatchdog } from '../src/boot.js'

// Recreate the relevant slice of index.html: a cloaked #app and a hidden fallback.
function seedDom({ cloaked = true } = {}) {
  document.body.innerHTML = `
    <div id="app"${cloaked ? ' v-cloak' : ''}></div>
    <div id="boot-fallback" hidden></div>
  `
}

describe('boot fail-safe', () => {
  test('appMounted is false while #app still carries v-cloak', () => {
    seedDom({ cloaked: true })
    expect(appMounted()).toBe(false)
  })

  test('appMounted is true once Vue has stripped v-cloak', () => {
    seedDom({ cloaked: false })
    expect(appMounted()).toBe(true)
  })

  test('revealFallback un-hides the fallback block', () => {
    seedDom()
    expect(document.getElementById('boot-fallback').hidden).toBe(true)
    expect(revealFallback()).toBe(true)
    expect(document.getElementById('boot-fallback').hidden).toBe(false)
  })

  test('revealFallback is a no-op (returns false) when there is no fallback', () => {
    document.body.innerHTML = '<div id="app"></div>'
    expect(revealFallback()).toBe(false)
  })

  test('watchdog reveals the fallback when the app never mounts', () => {
    vi.useFakeTimers()
    try {
      seedDom({ cloaked: true }) // still cloaked => never mounted
      startBootWatchdog(4000)
      expect(document.getElementById('boot-fallback').hidden).toBe(true)
      vi.advanceTimersByTime(4000)
      expect(document.getElementById('boot-fallback').hidden).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  test('watchdog leaves the fallback hidden when the app mounts in time', () => {
    vi.useFakeTimers()
    try {
      seedDom({ cloaked: false }) // v-cloak already removed => mounted
      startBootWatchdog(4000)
      vi.advanceTimersByTime(4000)
      expect(document.getElementById('boot-fallback').hidden).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
