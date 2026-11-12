import { queryApi, QueryError, type DrivingData, type FoundPlaceData } from './queries'
import type { RouteSegment } from '../lib/map/routeTraffic'
export { QueryError as ApiProblem }
export type RouteResult = {
  segments?: RouteSegment[]
  distance: number
  duration: number
  taxiFare: number | null
  tollFare: number | null
  path: [number, number][]
  information?: DrivingData['route']
  checkedAt?: string
  geometryReason?: string | null
}
export type FoodPlace = {
  id: string
  name: string
  category: string
  address: string
  phone: string
  url: string
  lat: number
  lng: number
  meters: number | null
}
export async function fetchDirections(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  signal: AbortSignal,
) {
  return parseDirections(
    await queryApi<DrivingData>(
      '/locations/routes/driving',
      {
        origin_latitude: origin.lat,
        origin_longitude: origin.lon,
        destination_latitude: destination.lat,
        destination_longitude: destination.lon,
        include_geometry: true,
      },
      signal,
    ),
  )
}
export function parseDirections(data: DrivingData): RouteResult {
  const value = data.route?.status === 'available' ? data.route.value : null
  if (!value || !Number.isFinite(value.duration_seconds) || !Number.isFinite(value.distance_meters))
    throw new QueryError('현재 자동차 경로를 확인하지 못했어요.', 502)
  const segments: RouteSegment[] = (value.geometry?.coordinates || []).map((line) => ({
    path: line.map(([lng, lat]) => [lat, lng]),
    state: 0,
  }))
  // Do not draw a fictional line between disconnected MultiLineString parts.
  const path = segments.flatMap((segment) => segment.path)
  return {
    duration: value.duration_seconds,
    distance: value.distance_meters,
    taxiFare: value.taxi_fare_krw,
    tollFare: value.toll_fare_krw,
    path,
    segments,
    information: data.route,
    checkedAt: data.checked_at,
    geometryReason: value.geometry_reason,
  }
}
export type ShopKind = 'food' | 'cafe'
export const SHOP_KINDS = { food: { label: '음식점' }, cafe: { label: '카페' } }
export function foundPlace(place: FoundPlaceData): FoodPlace {
  return {
    id: place.place_id,
    name: place.name,
    category: place.category_name?.split('>').at(-1)?.trim() || '장소',
    address: place.road_address || place.address || '',
    lat: place.coordinates.latitude,
    lng: place.coordinates.longitude,
    phone: place.phone || '',
    url: place.provider_url && /^https?:\/\//i.test(place.provider_url) ? place.provider_url : '',
    meters: place.distance_meters,
  }
}
export const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60))
export const kilometers = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`
