import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ParkingContext } from './context'
import { createParkingStore } from './store'
import { apiParkingSource } from '../../api/parking/source'
import type { ParkingSource } from '../../types/parking'
export default function ParkingProvider({
  children,
  source = apiParkingSource,
  refreshInterval = 60000,
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
