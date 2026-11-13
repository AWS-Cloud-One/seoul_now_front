import { useSyncExternalStore } from 'react'
import type { ContextCard } from '../api/types'

// Keep the exact card snapshot: the same place can have different facts in another result.
type Selection = { card: ContextCard; resultId: string }
let selection: Selection | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const usePlaceDetails = () => useSyncExternalStore(subscribe, () => selection)
export function openPlaceDetails(card: ContextCard, resultId: string) {
  selection = { card, resultId }
  listeners.forEach((listener) => listener())
}
export function closePlaceDetails() {
  selection = null
  listeners.forEach((listener) => listener())
}
