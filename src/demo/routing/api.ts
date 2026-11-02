import { distanceMeters } from '../components/shell/useRoute'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export type RouteResult = {
  distance: number
  duration: number
  taxiFare: number | null
  tollFare: number | null
  /** [lat, lng] pairs ready for the map. */
  path: [number, number][]
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
  meters: number
}
export class ApiProblem extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function getJson(path: string, params: Record<string, string | number>, signal: AbortSignal) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  let response: Response
  try {
    response = await fetch(`${BASE}${path}?${query}`, { signal })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiProblem('서버에 연결하지 못했어요.', 0)
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.json()).detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiProblem(
      typeof detail === 'string' && detail ? detail : '요청에 실패했어요.',
      response.status,
    )
  }
  return response.json()
}

export async function fetchDirections(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  signal: AbortSignal,
): Promise<RouteResult> {
  const data = await getJson(
    '/kakao/directions',
    {
      origin_lat: origin.lat,
      origin_lon: origin.lon,
      destination_lat: destination.lat,
      destination_lon: destination.lon,
    },
    signal,
  )
  return parseDirections(data)
}

export function parseDirections(data: {
  summary?: {
    distance?: number
    duration?: number
    fare?: { taxi?: number; toll?: number }
  }
  coordinates?: [number, number][]
}): RouteResult {
  const summary = data.summary
  if (typeof summary?.distance !== 'number' || typeof summary.duration !== 'number')
    throw new ApiProblem('경로 응답을 해석하지 못했어요.', 502)
  return {
    distance: summary.distance,
    duration: summary.duration,
    taxiFare: summary.fare?.taxi ?? null,
    tollFare: summary.fare?.toll ?? null,
    path: (data.coordinates || []).map(([lng, lat]) => [lat, lng]),
  }
}

export type ShopKind = 'food' | 'cafe'
export const SHOP_KINDS: Record<ShopKind, { label: string; query: string; group: string }> = {
  food: { label: '음식점', query: '맛집', group: 'FD6' },
  cafe: { label: '카페', query: '카페', group: 'CE7' },
}
export async function fetchNearbyShops(
  kind: ShopKind,
  center: { lat: number; lon: number },
  radius: number,
  signal: AbortSignal,
): Promise<FoodPlace[]> {
  const data = await getJson(
    '/kakao/places',
    { query: SHOP_KINDS[kind].query, lat: center.lat, lon: center.lon },
    signal,
  )
  return parseFood(data, center, radius, SHOP_KINDS[kind].group)
}
export type FoundPlace = {
  id: string
  name: string
  category: string
  address: string
  lat: number
  lng: number
}
/** Free-text place search (any name), nearest to central Seoul first. */
export async function searchPlaces(query: string, signal: AbortSignal): Promise<FoundPlace[]> {
  const data = await getJson('/kakao/places', { query, lat: 37.5665, lon: 126.978 }, signal)
  return parseFound(data)
}
export function parseFound(data: { documents?: Record<string, string>[] }): FoundPlace[] {
  return (data.documents || [])
    .map((doc) => ({
      id: doc.id,
      name: doc.place_name,
      category: (doc.category_name || '').split('>').slice(-1)[0].trim() || '장소',
      address: doc.road_address_name || doc.address_name || '',
      lat: Number(doc.y),
      lng: Number(doc.x),
    }))
    .filter((place) => place.id && Number.isFinite(place.lat) && Number.isFinite(place.lng))
}
export async function fetchNearbyFood(
  center: { lat: number; lon: number },
  radius: number,
  signal: AbortSignal,
): Promise<FoodPlace[]> {
  const data = await getJson(
    '/kakao/places',
    { query: '맛집', lat: center.lat, lon: center.lon },
    signal,
  )
  return parseFood(data, center, radius)
}

export function parseFood(
  data: { documents?: Record<string, string>[] },
  center: { lat: number; lon: number },
  radius: number,
  group = 'FD6',
): FoodPlace[] {
  return (data.documents || [])
    .filter((doc) => doc.category_group_code === group)
    .map((doc) => {
      const lat = Number(doc.y)
      const lng = Number(doc.x)
      return {
        id: doc.id,
        name: doc.place_name,
        category: (doc.category_name || '').split('>').slice(-1)[0].trim() || '음식점',
        address: doc.road_address_name || doc.address_name || '',
        phone: doc.phone || '',
        url: doc.place_url || '',
        lat,
        lng,
        meters: Math.round(distanceMeters([center.lat, center.lon], [lat, lng])),
      }
    })
    .filter(
      (place) => Number.isFinite(place.lat) && Number.isFinite(place.lng) && place.meters <= radius,
    )
    .sort((a, b) => a.meters - b.meters)
}

export const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60))
export const kilometers = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`
