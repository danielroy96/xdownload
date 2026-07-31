// Vitest setup (runs before every test file).
//
// Node 26 ships an experimental global `localStorage` that throws unless started
// with --localstorage-file, and it shadows jsdom's own implementation. The app
// (src/app.js) uses bare `localStorage` for the cookie-notice ack, so install a
// simple in-memory Storage on globalThis + window for the tests. Harmless in the
// node (worker) environment, which never touches it.
class MemoryStorage {
  #store = new Map()
  get length() { return this.#store.size }
  clear() { this.#store.clear() }
  getItem(k) { return this.#store.has(String(k)) ? this.#store.get(String(k)) : null }
  setItem(k, v) { this.#store.set(String(k), String(v)) }
  removeItem(k) { this.#store.delete(String(k)) }
  key(i) { return [...this.#store.keys()][i] ?? null }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true })
}
