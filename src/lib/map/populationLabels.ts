import type { LivePlace } from '../../state/live/store'
import type { MapRecord } from './mapLayers'

export function livePopulationRecord(
  place: LivePlace,
  lat = place.lat,
  lng = place.lng,
): MapRecord {
  return {
    kind: 'population',
    data: {
      live: !place.saved,
      information: place.information,
      lat,
      lng,
      properties: {
        name: place.name,
        min: place.populationMin,
        max: place.populationMax,
        congestion: place.level,
        observedAt: place.sourceTime || '',
      },
    },
  }
}
