import { createContext } from 'react'
import type { createParkingStore } from './store'
export const ParkingContext = createContext<ReturnType<typeof createParkingStore> | null>(null)
