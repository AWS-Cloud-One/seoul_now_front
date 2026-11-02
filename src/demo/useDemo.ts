import { useContext } from 'react'
import { DemoContext } from './state'
import type { Trip } from './types'
export function useDemo() {
  const context = useContext(DemoContext)
  if (!context) throw new Error('DemoProvider is required')
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
