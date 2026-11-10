import { useCallback, useContext, useSyncExternalStore } from 'react'
import { ParkingContext } from './context'
import type { ParkingScope } from './types'
export function useParkingData(scope: ParkingScope) {
  const store = useContext(ParkingContext)
  if (!store) throw new Error('ParkingProvider is required')
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(scope, listener),
    [store, scope],
  )
  const getSnapshot = useCallback(() => store.getSnapshot(scope), [store, scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    ...snapshot,
    kind: store.kind,
    setViewport: store.setViewport,
    remember: store.remember,
    refresh: () => store.refresh(scope),
  }
}
