// Session restore of open trips (sessionStorage). Keys and schema must stay compatible
// with trips saved by earlier versions.
import { newState, normalizeTrip, validSavedTrip } from '../lib/domain.js'
import { normalizeResult } from './apiState'
import type { Store, Trip } from '../types/trip'

export const STORAGE_KEY = 'seoul-next-stop-trips-v2'

// Results made by the removed local mock engine carry no server place snapshot and cannot
// be shown any more. Keep the trip (title, chat, conditions) and drop only those results.
function serverResultsOnly(trip: Trip): Trip {
  const groups = trip.groups.filter((group) => group.api)
  const general = trip.general?.api ? trip.general : null
  const kept = new Set([...groups, ...(general ? [general] : [])].map((result) => result.id))
  const current = trip.current && kept.has(trip.current) ? trip.current : null
  const shown = groups.find((group) => group.id === current) || general
  return {
    ...trip,
    groups,
    general,
    current,
    selected: shown?.entries.some((entry) => entry.id === trip.selected)
      ? trip.selected
      : (shown?.entries[0]?.id ?? null),
    retainedResult:
      trip.retainedResult && kept.has(trip.retainedResult.id) ? trip.retainedResult : null,
  }
}

export function loadStore(): Store {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.schema === 2 && Array.isArray(saved.trips)) {
      const trips: Trip[] = saved.trips
        .filter(validSavedTrip)
        .map(normalizeTrip)
        .map((trip: Trip) =>
          serverResultsOnly({
            ...trip,
            groups: trip.groups.map(normalizeResult),
            general: trip.general ? normalizeResult(trip.general) : null,
          }),
        )
      if (trips.length)
        return {
          schema: 2,
          trips,
          activeTripId: trips.some((t) => t.trip === saved.activeTripId)
            ? saved.activeTripId
            : trips[0].trip,
        }
    }
    const legacy = JSON.parse(sessionStorage.getItem('seoul-next-stop-v1') || 'null')
    if (validSavedTrip(legacy)) {
      const trip = serverResultsOnly(normalizeTrip(legacy))
      return { schema: 2, trips: [trip], activeTripId: trip.trip }
    }
  } catch {
    /* Private browsing and corrupt storage fall back to a new trip. */
  }
  const trip = newState()
  return { schema: 2, trips: [trip], activeTripId: trip.trip }
}
export function initialPage() {
  if (new URLSearchParams(window.location.search).get('view') === 'map') return 'preview'
  try {
    return sessionStorage.getItem('seoul-start-screen-entered') === '1'
      ? sessionStorage.getItem('seoul-entry-page') === 'main'
        ? 'main'
        : 'preview'
      : 'start'
  } catch {
    return 'start'
  }
}
