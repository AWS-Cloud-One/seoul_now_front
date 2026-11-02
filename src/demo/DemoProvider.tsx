import type { ReactNode } from 'react'
import { DemoContext, useDemoController } from './state'
import ParkingProvider from './parking/ParkingProvider'
import type { ParkingSource } from './parking/types'
export default function DemoProvider({
  children,
  parkingSource,
}: {
  children: ReactNode
  parkingSource?: ParkingSource
}) {
  const controller = useDemoController()
  return (
    <DemoContext.Provider value={controller}>
      <ParkingProvider source={parkingSource}>{children}</ParkingProvider>
    </DemoContext.Provider>
  )
}
