import { useCallback, useEffect, useState } from 'react'

export type Route = 'home' | 'recommend' | 'chat' | 'directions' | 'parking' | 'saved'
const ROUTES: Route[] = ['home', 'recommend', 'chat', 'directions', 'parking', 'saved']

function read(): Route {
  const name = window.location.hash.replace(/^#\/?/, '').split('/')[0] as Route
  return ROUTES.includes(name) ? name : 'home'
}

/** Hash based routing keeps the map mounted while the browser back button still works. */
export function useRoute() {
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const change = () => setRoute(read())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const go = useCallback((next: Route) => {
    if (read() !== next) window.location.hash = `/${next}`
  }, [])
  return [route, go] as const
}

export const MAP_FOCUS_EVENT = 'sn:map-focus'
export const PARKING_SELECT_EVENT = 'sn:parking-select'
export function focusMap(lat: number, lng: number, zoom = 16) {
  window.dispatchEvent(new CustomEvent(MAP_FOCUS_EVENT, { detail: { lat, lng, zoom } }))
}

/** Fit several points (e.g. origin and destination) into the visible map. */
export function fitMap(points: [number, number][]) {
  window.dispatchEvent(new CustomEvent('sn:map-fit', { detail: { points } }))
}

export function distanceMeters(a: [number, number], b: [number, number]) {
  const rad = (v: number) => (v * Math.PI) / 180
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

export const FOOD_SELECT_EVENT = 'sn:food-select'
export const MAP_OVERLAY_EVENT = 'sn:map-overlay'
export type MapOverlay = {
  parkingBase?: { name: string; lat: number; lng: number } | null
  origin?: { name: string; lat: number; lon: number } | null
  routeSegments?: import('../lib/map/routeTraffic').RouteSegment[] | null
  destination?: { name: string; lat: number; lng: number } | null
  /** [lat, lng] pairs of the driving route. */
  route: [number, number][] | null
  food: { id: string; name: string; lat: number; lng: number }[] | null
  traffic: import('../state/live/store').RoadSegment[] | null
}
let overlay: MapOverlay = { route: null, food: null, traffic: null }
export const getMapOverlay = () => overlay
/** Detail-panel sections publish what should be drawn on the shared map. */
export function setMapOverlay(patch: Partial<MapOverlay>) {
  overlay = { ...overlay, ...patch }
  window.dispatchEvent(new CustomEvent(MAP_OVERLAY_EVENT, { detail: overlay }))
}
