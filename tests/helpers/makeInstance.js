// Build a component instance for unit tests directly from the real app options
// module (src/app.js). This replaces the old regex/vm extraction of the inline
// <script> from index.html — now that the app is a proper ES module we just
// import it.
//
// `ctx` is a plain `this` context that behaves like a Vue instance:
//   • setup() is invoked and its returned refs are exposed as auto-unwrapped
//     properties (get/set proxy to ref.value), exactly as Vue does — so a method
//     doing `this.cookieNoticeAck = '1'` writes through to the VueUse ref (and
//     thus to localStorage);
//   • data() properties are spread in;
//   • computed getters are bound as lazy properties;
//   • methods are bound to the context.
// Extra overrides (spies, seeded state) can be merged in last.
import { isRef } from 'vue'
import { appOptions } from '../../src/app.js'

export { appOptions as options }

export function makeInstance(overrides = {}) {
  const ctx = { $refs: {}, $nextTick: (fn) => fn && fn() }

  // setup() refs → auto-unwrapped properties.
  if (typeof appOptions.setup === 'function') {
    const setupState = appOptions.setup() || {}
    for (const [key, val] of Object.entries(setupState)) {
      if (isRef(val)) {
        Object.defineProperty(ctx, key, {
          get: () => val.value,
          set: (v) => { val.value = v },
          enumerable: true,
          configurable: true,
        })
      } else {
        ctx[key] = val
      }
    }
  }

  Object.assign(ctx, appOptions.data())

  // computed getters → lazy (recomputed) properties.
  for (const [key, fn] of Object.entries(appOptions.computed || {})) {
    Object.defineProperty(ctx, key, {
      get: () => fn.call(ctx),
      enumerable: true,
      configurable: true,
    })
  }

  for (const [name, fn] of Object.entries(appOptions.methods)) {
    ctx[name] = fn.bind(ctx)
  }

  Object.assign(ctx, overrides)
  return { ctx, options: appOptions }
}
