import { estimatedWalkMinutes } from './walking'
import { useDemo } from '../useDemo'
import { placeById } from '../domain.js'
import { distanceMeters } from '../components/shell/useRoute'
import { useParkingData } from './useParkingData'

/** Resolve the user's choice against the latest source, never substitute a nearest lot. */
export function useSelectedParking(placeId: string | null | undefined) {
  const { active } = useDemo()
  const { lots } = useParkingData('map')
  const place = placeById(placeId)
  const id = placeId ? active.parkingSelections?.[placeId] : undefined
  const lot = id ? lots.find((item) => item.memberIds.includes(id)) : undefined
  if (!place || !lot || lot.lat === null || lot.lng === null) return null
  const meters = Math.round(distanceMeters([place.lat, place.lon], [lot.lat, lot.lng]))
  return { lot, meters, minutes: estimatedWalkMinutes(meters) }
}
