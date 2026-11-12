import { mapGeometry } from '../mapLayers'
import { SEOUL_QUERY } from '../queries'
import { apiParkingLot } from './parkingApi'
import type { ParkingSource } from '../../types/parking'

export const apiParkingSource: ParkingSource = {
  kind: 'api',
  async load(_scope, signal, query = SEOUL_QUERY) {
    const data = await mapGeometry('parking', query, signal)
    return data.feature_collection.features.flatMap((feature) =>
      feature.geometry.type === 'Point'
        ? [
            apiParkingLot({
              parking_id: feature.id,
              name: feature.properties.name || '이름 미확인',
              identity_status: feature.properties.identity_status || 'unverified',
              coordinates: {
                latitude: feature.geometry.coordinates[1],
                longitude: feature.geometry.coordinates[0],
              },
              distance_meters: 0,
              records: [],
              availability: {
                value: null,
                status: 'unsupported',
                freshness: 'not_applicable',
                source: null,
                observed_at: null,
                collected_at: null,
                reason_code: 'NOT_SUPPORTED',
              },
            }),
          ]
        : [],
    )
  },
}
