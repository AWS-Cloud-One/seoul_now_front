// A destination handed to the 길찾기 tab by another screen (e.g. "여기까지 길찾기" on a place).
export type DirectionsTarget = {
  id: string
  name: string
  lat: number
  lon: number
  sub: string
  /** Set when the destination is one of the Seoul real-time city-data places. */
  liveCode?: string
}
let pending: DirectionsTarget | null = null
export function openDirectionsTo(target: DirectionsTarget) {
  pending = target
}
/** Read once by the 길찾기 tab when it opens. */
export function takeDirectionsTarget() {
  const value = pending
  pending = null
  return value
}
