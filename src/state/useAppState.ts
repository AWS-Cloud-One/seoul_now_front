import { useContext } from 'react'
import { AppStateContext } from './appState'
import type { Trip } from '../types/trip'
export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('AppStateProvider is required')
  return context
}
export function tripTitle(trip: Trip) {
  return (
    trip.title ||
    (trip.conditions.departure
      ? `${trip.conditions.departure} · ${trip.conditions.purposes.join('·') || '나들이'}`
      : '새 여행')
  )
}
