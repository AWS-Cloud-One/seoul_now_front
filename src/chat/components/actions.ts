import { focusMap, setMapOverlay, type MapOverlay } from '../../hooks/useRoute'
import { openDirectionsTo } from '../../state/directionsTarget'
import type { ApiPlace } from '../../api/contracts'
import { selectRecommendation } from '../state/recommendations'
import type { ChatController, SendOptions } from '../state/controller'

export const COMPOSER_ID = 'chat-input'

/**
 * Temporary follow-up buttons (until the server issues actions, P5 BE-02): they only put a
 * sentence and its target into the composer. The user still sends it as a normal message.
 */
export function prefill(
  controller: ChatController,
  text: string,
  target: SendOptions['target'] = null,
  reply: SendOptions['replyTo'] = null,
) {
  controller.setComposer({ text, target, ...(reply ? { reply } : {}) })
  requestAnimationFrame(() => document.getElementById(COMPOSER_ID)?.focus())
}

export function showOnMap(
  lat: number,
  lng: number,
  onShowMap?: () => void,
  place?: MapOverlay['recommendation'],
  resultId?: string,
) {
  if (resultId) selectRecommendation(resultId)
  setMapOverlay({
    lookup: null,
    recommendation: place ?? { id: `${lat},${lng}`, name: '선택한 장소', rank: null, lat, lng },
    route: null,
    routeSegments: null,
    destination: null,
    food: null,
  })
  onShowMap?.()
  requestAnimationFrame(() => focusMap(lat, lng, 16))
}

export function directionsTo(
  place: Pick<ApiPlace, 'place_id' | 'name' | 'coordinates' | 'road_address' | 'address'>,
) {
  openDirectionsTo({
    id: place.place_id,
    name: place.name,
    lat: place.coordinates.latitude,
    lon: place.coordinates.longitude,
    sub: place.road_address || place.address || '',
  })
  setMapOverlay({ lookup: null, recommendation: null, route: null, routeSegments: null })
  window.location.hash = '/directions'
}

/** Show an exact point returned by a read, independent of the selected recommendation. */
export function showLookupOnMap(point: NonNullable<MapOverlay['lookup']>, onShowMap?: () => void) {
  setMapOverlay({
    lookup: point,
    recommendation: null,
    route: null,
    routeSegments: null,
    destination: null,
    food: null,
  })
  onShowMap?.()
  requestAnimationFrame(() => focusMap(point.lat, point.lng, 17))
}
