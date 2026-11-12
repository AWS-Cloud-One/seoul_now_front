import type L from '../../vendor/leaflet.js'
import type { Layers, Result } from '../../types/trip'
export type RoadRecord = {
  information?: import('../../api/contracts').Information<import('../../api/queries').TrafficValue>
  lat?: number
  lng?: number
  live?: boolean
  name: string
  speed: number | null
  classes: string[]
  direction: string
  travelSeconds: number | null
  receivedAt: string
  measurementTime: string | null
}
export type ParkingRecord = import('../../types/parking').ParkingLot
export type ParkingLocation = { lat: number; lng: number; records: ParkingRecord[] }
export type PopulationRecord = {
  information?: import('../../api/contracts').Information<
    import('../../api/queries').PopulationValue
  >
  live?: boolean
  lat?: number
  lng?: number
  properties: {
    name: string
    min: number | null
    max: number | null
    congestion: string
    observedAt: string
  }
}
export type MapRecord =
  | { kind: 'road'; data: RoadRecord }
  | { kind: 'population'; data: PopulationRecord }
  | { kind: 'parking'; data: ParkingLocation }
  | { kind: 'parking-cluster'; data: { location: ParkingLocation; record: ParkingRecord }[] }
  | { kind: 'origin'; data: { name: string } }
export function createMapLayers(
  map: ReturnType<typeof L.map>,
  options: {
    overview?: boolean
    parkingRecords?: ParkingRecord[]
    data: unknown
    layers: Layers
    result: Result | null
    selected: string | null
    onRecord: (record: MapRecord, latlng: [number, number] | { lat: number; lng: number }) => void
    onParkingHint: (visible: boolean, zoom: () => void) => void
  },
): {
  highlightParking(id: string | null): void
  update(): void
  updateParking(records: ParkingRecord[]): void
  destroy(): void
}
