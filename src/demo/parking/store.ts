import { normalizeParkingResponse } from './normalize'
import { parkingFacilities } from './facilities'
import type { ParkingScope, ParkingSnapshot, ParkingSource } from './types'

export function createParkingStore(source: ParkingSource, refreshInterval = 30000) {
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
    preview: {
      snapshot: initial('preview'),
      listeners: new Set<() => void>(),
      version: 0,
      controller: undefined as AbortController | undefined,
      timer: undefined as ReturnType<typeof setInterval> | undefined,
    },
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
      const response = await source.load(scope, controller.signal)
      if (entry.version !== version || controller.signal.aborted) return
      publish(scope, {
        lots: parkingFacilities(normalizeParkingResponse(response)),
        status: 'success',
        error: null,
        refreshing: false,
      })
    } catch {
      if (entry.version !== version || controller.signal.aborted) return
      publish(scope, {
        status: 'error',
        error: '주차장 정보를 갱신하지 못했어요.',
        refreshing: false,
      })
    }
  }
  return {
    kind: source.kind,
    getSnapshot: (scope: ParkingScope) => entries[scope].snapshot,
    refresh,
    subscribe(scope: ParkingScope, listener: () => void) {
      const entry = entries[scope]
      entry.listeners.add(listener)
      if (entry.listeners.size === 1) {
        void refresh(scope)
        if (refreshInterval > 0)
          entry.timer = setInterval(() => {
            void refresh(scope)
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
