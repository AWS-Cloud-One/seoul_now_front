import { closePlaceDetails, openPlaceDetails, usePlaceDetails } from '../state/placeDetails'
import { PlaceDetails } from './PlaceDetails'
import { showOnMap } from './actions'

/** Mounted beside the map, so a marker can open details even after the card unmounts. */
export function PlaceDetailsHost({ onShowMap }: { onShowMap?: () => void }) {
  const selected = usePlaceDetails()
  const place = selected?.card.place.value
  if (!selected || !place) return null
  return (
    <PlaceDetails
      card={selected.card}
      onClose={closePlaceDetails}
      onShowMap={() =>
        showOnMap(
          place.coordinates.latitude,
          place.coordinates.longitude,
          onShowMap,
          {
            id: place.place_id,
            name: place.name,
            rank: selected.card.rank,
            lat: place.coordinates.latitude,
            lng: place.coordinates.longitude,
            onOpenDetail: () => openPlaceDetails(selected.card, selected.resultId),
          },
          selected.resultId,
        )
      }
    />
  )
}
