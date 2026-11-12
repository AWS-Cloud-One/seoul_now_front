import { QueryError, SEOUL_QUERY, type MapQuery } from '../../api/queries'
import type { ParkingLot } from '../../types/parking'
import { normalizeParkingResponse } from '../../api/parking/normalize'
import { parkingFacilities } from '../../lib/parking/facilities'
import type { ParkingScope, ParkingSnapshot, ParkingSource } from '../../types/parking'

export function createParkingStore(source: ParkingSource, refreshInterval = 30000) {
  let viewport = SEOUL_QUERY
  const remembered = new Map<string, ParkingLot>()
  const limited = new Map<ParkingScope, string>()
  let retryAt = 0
  function initial(scope: ParkingScope): ParkingSnapshot {
    try {
      if (source.initialData?.[scope] !== undefined)
        return {
          lots: parkingFacilities(normalizeParkingResponse(source.initialData[scope])),
          status: 'success',
          error: null,
          refreshing: false,
        }
    } catch {
      /* A malformed seed must not break rendering. The first request can recover. */
    }
    return { lots: [], status: 'idle', error: null, refreshing: false }
  }
  const entries = {
    map: {
      snapshot: initial('map'),
      listeners: new Set<() => void>(),
      version: 0,
      controller: undefined as AbortController | undefined,
      timer: undefined as ReturnType<typeof setInterval> | undefined,
    },
  }
  function publish(scope: ParkingScope, patch: Partial<ParkingSnapshot>) {
    const entry = entries[scope]
    entry.snapshot = { ...entry.snapshot, ...patch }
    entry.listeners.forEach((listener) => listener())
  }
  async function refresh(scope: ParkingScope) {
    if (retryAt > Date.now() || limited.get(scope) === JSON.stringify(viewport)) return
    const entry = entries[scope],
      version = ++entry.version
    entry.controller?.abort()
    const controller = new AbortController()
    entry.controller = controller
    publish(scope, {
      refreshing: true,
      status: entry.snapshot.status === 'idle' ? 'loading' : entry.snapshot.status,
    })
    try {
      const response = await source.load(scope, controller.signal, viewport)
      if (entry.version !== version || controller.signal.aborted) return
      const lots = normalizeParkingResponse(response).map((lot) => {
        const saved = remembered.get(lot.id)
        if (!saved?.api || !lot.api) return saved || lot
        // Keep fetched registration details, but don't let them freeze a map pin's old location.
        const merged: ParkingLot = {
          ...saved,
          name: lot.name,
          lat: lot.lat,
          lng: lot.lng,
          kind: lot.kind,
          api: {
            ...saved.api,
            facility: {
              ...saved.api.facility,
              name: lot.api.facility.name,
              coordinates: lot.api.facility.coordinates,
              identity_status: lot.api.facility.identity_status,
            },
          },
        }
        remembered.set(lot.id, merged)
        return merged
      })
      publish(scope, {
        lots: parkingFacilities([
          ...new Map([...lots, ...remembered.values()].map((lot) => [lot.id, lot])).values(),
        ]),
        status: 'success',
        error: null,
        refreshing: false,
      })
    } catch (error) {
      if (entry.version !== version || controller.signal.aborted) return
      if (error instanceof QueryError) {
        retryAt = error.retryAt
        if (error.code === 'MAP_RANGE_TOO_LARGE') limited.set(scope, JSON.stringify(viewport))
      }
      publish(scope, {
        status: 'error',
        error: error instanceof Error ? error.message : '주차장 정보를 갱신하지 못했어요.',
        refreshing: false,
      })
    }
  }
  return {
    kind: source.kind,
    setViewport(query: MapQuery) {
      if (JSON.stringify(viewport) === JSON.stringify(query)) return
      viewport = query
      if (entries.map.listeners.size) void refresh('map')
    },
    remember(lots: ParkingLot[]) {
      if (!lots.length) return
      for (const lot of lots) remembered.set(lot.id, lot)
      // Keep selected/search details across viewport changes; backend facility IDs are authoritative.
      publish('map', {
        lots: parkingFacilities([
          ...new Map(
            [...entries.map.snapshot.lots, ...remembered.values()].map((lot) => [lot.id, lot]),
          ).values(),
        ]),
      })
    },
    getSnapshot: (scope: ParkingScope) => entries[scope].snapshot,
    refresh,
    subscribe(scope: ParkingScope, listener: () => void) {
      const entry = entries[scope]
      entry.listeners.add(listener)
      if (entry.listeners.size === 1) {
        void refresh(scope)
        if (refreshInterval > 0)
          entry.timer = setInterval(() => {
            if (!document.hidden) void refresh(scope)
          }, refreshInterval)
      }
      return () => {
        entry.listeners.delete(listener)
        if (!entry.listeners.size) {
          clearInterval(entry.timer)
          entry.timer = undefined
          entry.version++
          entry.controller?.abort()
          entry.controller = undefined
        }
      }
    },
  }
}
