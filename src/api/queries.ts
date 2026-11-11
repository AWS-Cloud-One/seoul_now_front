import { apiClient } from './client'
import type {
  ApiPlace,
  Coordinates,
  Information,
  JsonValue,
  ParkingSummary,
  ParkingSourceRecord,
} from './contracts'
export class QueryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = '',
    readonly retryAt = 0,
  ) {
    super(message)
  }
}
export async function queryApi<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  signal: AbortSignal,
): Promise<T> {
  return (await queryApiResponse<T>(path, query, signal)).data
}
export async function queryApiResponse<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  signal: AbortSignal,
) {
  const response = await apiClient.request<T>(path, { query, signal })
  if (!response.ok || !response.envelope.data)
    throw new QueryError(
      response.envelope.error?.message || '조회 응답을 확인할 수 없어요.',
      response.status,
      response.envelope.error?.code,
      Date.now() + (response.retryAfterSeconds || 0) * 1000,
    )
  return { ...response, data: response.envelope.data }
}
export type Position = [number, number]
export type MapQuery = { bbox: [number, number, number, number]; level: number }
export const SEOUL_QUERY: MapQuery = { bbox: [126.76, 37.41, 127.19, 37.71], level: 9 }
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
export type MapGeometry = MapQuery & {
  layer: string
  geometry_version: string
  coverage: string
  feature_collection: {
    type: 'FeatureCollection'
    features: {
      type: 'Feature'
      id: string
      geometry: Geometry
      properties: {
        name: string | null
        link_id?: string
        area_code?: string
        parking_id?: string
        direction?: string | null
        identity_status?: 'verified' | 'unverified'
      }
    }[]
  }
}
export type TrafficValue = { speed_kmh: number | null; travel_seconds: number | null }
export type PopulationValue = {
  min_people: number | null
  max_people: number | null
  congestion: 'relaxed' | 'normal' | 'slightly_crowded' | 'crowded' | null
  is_replacement: boolean | null
}
export type MapStatus = MapQuery & {
  layer: string
  geometry_version: string
  status: 'ok' | 'partial'
  items: {
    link_id?: string
    area_code?: string
    traffic?: Information<TrafficValue>
    population?: Information<PopulationValue>
  }[]
}
export type DrivingData = {
  origin: Coordinates
  destination: Coordinates
  checked_at: string
  route: Information<{
    duration_seconds: number
    distance_meters: number
    geometry: { type: 'MultiLineString'; coordinates: Position[][] } | null
    geometry_reason: string | null
    taxi_fare_krw: number | null
    toll_fare_krw: number | null
  }>
}
export type FoundPlaceData = Omit<ApiPlace, 'purpose'> & {
  source: string
  collected_at: string
  distance_meters: number | null
}
export type Page<T> = {
  items: T[]
  next_cursor: string | null
  has_more?: boolean
  total_count?: number
  checked_at?: string
  radius_meters?: number
}
export type ParkingFacilityData = ParkingSummary['items'][number]
export type ParkingSearchItem = {
  facility: ParkingFacilityData
  hourly_base_comparison_krw: number | null
  fee_status: 'free' | 'paid' | 'unknown' | 'conflict'
  fee_reason: string | null
}
export type ParkingDetail = {
  parking_id: string
  identity_status: 'verified' | 'unverified'
  checked_at: string
  records: ParkingSourceRecord[]
  availability: Information<null>
}
export type AreaOverview = {
  area_code: string
  name: string
  checked_at: string
  scope: 'population_observation_area'
  population: Information<PopulationValue>
  roads: Information<{ items: { link_id: string; traffic: Information<TrafficValue> }[] }>
  parking: Information<{ registered_facility_count: number; availability: 'unsupported' }>
  weather: Information<Record<string, JsonValue>>
  commerce: Information<Record<string, JsonValue>>
}
