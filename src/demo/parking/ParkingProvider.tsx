import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ParkingContext } from './context'
import { createParkingStore } from './store'
import { mockParkingSource } from './source'
import type { ParkingSource } from './types'
export default function ParkingProvider({
  children,
  source = mockParkingSource,
  refreshInterval = 30000,
}: {
  children: ReactNode
  source?: ParkingSource
  refreshInterval?: number
}) {
  const store = useMemo(
    () => createParkingStore(source, refreshInterval),
    [source, refreshInterval],
  )
  return <ParkingContext.Provider value={store}>{children}</ParkingContext.Provider>
}
