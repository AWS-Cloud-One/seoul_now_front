import type { ReactNode } from 'react'
import { AppStateContext, useAppStateController } from './appState'
import ParkingProvider from './parking/ParkingProvider'
import type { ParkingSource } from '../types/parking'
export default function AppStateProvider({
  children,
  parkingSource,
}: {
  children: ReactNode
  parkingSource?: ParkingSource
}) {
  const controller = useAppStateController()
  return (
    <AppStateContext.Provider value={controller}>
      <ParkingProvider source={parkingSource}>{children}</ParkingProvider>
    </AppStateContext.Provider>
  )
}
