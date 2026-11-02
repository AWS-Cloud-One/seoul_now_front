import { placeById, validateConditions } from './domain.js'
import type { SavedTrip } from './types'

export const SAVED_TRIPS_KEY = 'seoul-saved-trips-v1'
function validSavedTrip(value: unknown): value is SavedTrip {
  if (!value || typeof value !== 'object') return false
  const saved = value as Partial<SavedTrip>
  try {
    const result = saved.result
    return (
      typeof saved.id === 'string' &&
      typeof saved.sourceTripId === 'string' &&
      typeof saved.title === 'string' &&
      typeof saved.savedAt === 'string' &&
      Number.isFinite(Date.parse(saved.savedAt)) &&
      typeof saved.general === 'boolean' &&
      (saved.selectedId === null || typeof saved.selectedId === 'string') &&
      !!saved.layers &&
      ['roads', 'parking', 'population'].every(
        (key) => typeof saved.layers?.[key as keyof typeof saved.layers] === 'boolean',
      ) &&
      !!result &&
      typeof result.id === 'string' &&
      Number.isFinite(Date.parse(result.time)) &&
      Array.isArray(result.conditions.ages) &&
      !validateConditions(result.conditions) &&
      Array.isArray(result.entries) &&
      result.entries.length > 0 &&
      result.entries.every(
        (entry) =>
          !!entry &&
          typeof entry.id === 'string' &&
          !!placeById(entry.id) &&
          (entry.eta === null || Number.isFinite(entry.eta)) &&
          typeof entry.reason === 'string' &&
          typeof entry.sourceStatus === 'string' &&
          Number.isFinite(Date.parse(entry.queryTime)),
      )
    )
  } catch {
    return false
  }
}
export function loadSavedTrips(): SavedTrip[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY) || 'null')
    if (stored?.schema !== 1 || !Array.isArray(stored.items)) return []
    return stored.items.filter(validSavedTrip)
  } catch {
    return []
  }
}
export function persistSavedTrips(items: SavedTrip[]) {
  // Write before updating React state: a failed/quota-limited write must never report success.
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify({ schema: 1, items }))
}
