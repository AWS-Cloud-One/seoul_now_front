import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// Newer Node versions expose a broken global Web Storage that shadows jsdom's implementation.
// Fall back to a small in-memory Storage when the global one is unusable.
class MemoryStorage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  let usable: boolean
  try {
    usable = typeof globalThis[name]?.clear === 'function'
  } catch {
    usable = false
  }
  if (!usable)
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true })
}
