import type { ApiResponse } from './client'
import type { MapGeometry, MapQuery } from './queries'
import { containsViewport } from './mapViewport'

export const GEOMETRY_TTL_MS = 300000
const MAX_ENTRIES = 24
const MAX_BYTES = 8 * 1024 * 1024 // Serialized payload budget, not a JS heap measurement.
type Entry = { data: MapGeometry; expires: number; bytes: number }
type Flight = {
  controller: AbortController
  promise: Promise<MapGeometry>
  users: number
  settled: boolean
}
const entries = new Map<string, Entry>()
const flights = new Map<string, Flight>()
const generations = new Map<string, number>()
let bytes = 0
let epoch = 0

export const geometryKey = (layer: string, query: MapQuery) =>
  JSON.stringify([layer, query.bbox, query.level])

function remove(key: string) {
  const entry = entries.get(key)
  if (entry) bytes -= entry.bytes
  entries.delete(key)
}

export function findGeometry(layer: string, viewport: MapQuery) {
  const exact = geometryKey(layer, viewport)
  const match = entries.has(exact)
    ? ([exact, entries.get(exact)!] as const)
    : [...entries.entries()]
        .reverse()
        .find(
          ([, entry]) =>
            layer !== 'population' &&
            entry.data.layer === layer &&
            containsViewport(entry.data, viewport),
        )
  if (!match) return undefined
  const [key, entry] = match
  entries.delete(key)
  entries.set(key, entry)
  // An expired entry can still retain the stable query bounds, but never serves its data.
  return {
    query: { bbox: entry.data.bbox, level: entry.data.level },
    data: performance.now() < entry.expires ? entry.data : undefined,
  }
}

export function geometryGeneration(layer: string) {
  return `${epoch}:${generations.get(layer) ?? 0}`
}

export function invalidateGeometry(layer: string) {
  generations.set(layer, (generations.get(layer) ?? 0) + 1)
  for (const [key, entry] of entries) if (entry.data.layer === layer) remove(key)
}

export function storeGeometry(
  data: MapGeometry,
  response: ApiResponse<MapGeometry>,
  generation: string,
) {
  if (generation !== geometryGeneration(data.layer)) return
  const generated = Date.parse(response.envelope.server_time)
  const wallAge = Date.now() - generated
  const age = response.cache?.ageSeconds
  const remaining =
    age !== null && age !== undefined && Number.isFinite(age)
      ? Math.min(
          GEOMETRY_TTL_MS - age * 1000 - (response.cache?.elapsedMs ?? 0),
          wallAge >= 0 ? GEOMETRY_TTL_MS - wallAge : GEOMETRY_TTL_MS,
        )
      : Number.isFinite(wallAge) && wallAge >= 0
        ? GEOMETRY_TTL_MS - wallAge
        : 0
  // Age, when visible, avoids extending a CDN hit for a fresh five minutes.
  // Until CORS exposes Age, use the existing envelope clock; future/invalid clocks fail closed.
  if (remaining <= 0) return
  const size = new TextEncoder().encode(JSON.stringify(data)).byteLength
  if (size > MAX_BYTES) return
  const key = geometryKey(data.layer, data)
  remove(key)
  entries.set(key, { data, bytes: size, expires: performance.now() + remaining })
  bytes += size
  while (entries.size > MAX_ENTRIES || bytes > MAX_BYTES) remove(entries.keys().next().value!)
}

export function shareGeometry(
  key: string,
  signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<MapGeometry>,
) {
  signal.throwIfAborted()
  let flight = flights.get(key)
  if (!flight || flight.controller.signal.aborted) {
    const controller = new AbortController()
    const created: Flight = { controller, users: 0, settled: false, promise: undefined! }
    created.promise = Promise.resolve()
      .then(() => load(controller.signal))
      .finally(() => {
        created.settled = true
        if (flights.get(key) === created) flights.delete(key)
      })
    flights.set(key, created)
    flight = created
  }
  const current = flight
  current.users++
  return new Promise<MapGeometry>((resolve, reject) => {
    let finished = false
    const finish = () => {
      if (finished) return false
      finished = true
      signal.removeEventListener('abort', abort)
      current.users--
      if (!current.users && !current.settled) current.controller.abort()
      return true
    }
    const abort = () => {
      if (finish()) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    current.promise.then(
      (value) => {
        if (finish()) resolve(value)
      },
      (error) => {
        if (finish()) reject(error)
      },
    )
  })
}

export function clearGeometryCache() {
  epoch++
  for (const flight of flights.values()) flight.controller.abort()
  flights.clear()
  entries.clear()
  generations.clear()
  bytes = 0
}
