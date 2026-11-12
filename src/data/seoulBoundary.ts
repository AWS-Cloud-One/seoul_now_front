import districts from './seoul-boundary.json'

/** Visual fallback from southkorea/seoul-maps, JUSO 2015 (Apache-2.0). API boundaries take precedence. */
export const SEOUL_BOUNDARY: [number, number][][] = districts.features.map((feature) =>
  feature.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
)
const points = SEOUL_BOUNDARY.flat()
export const SEOUL_VIEW_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
  [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
]
