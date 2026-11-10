import type { MapRoadSegment } from '../live/store'
import { roadSpeedColor, ROAD_SPEED_COLORS } from '../live/roadStyle'
import type { RouteSegment } from './traffic'

export const UNKNOWN_ROUTE_COLOR = '#c9d0d8'
export const ROUTE_OUTLINE_COLOR = '#ffffff'
export const ROUTE_ROAD_COLORS = ROAD_SPEED_COLORS.map((item, index) =>
  index === 3 ? { color: UNKNOWN_ROUTE_COLOR, label: '미확인' } : item,
)
export type ColoredRouteSegment = { path: [number, number][]; color: string }

type Point = { x: number; y: number }
type Edge = { a: Point; b: Point; length: number; id: string }
const CELL = 64
const TOLERANCE = 8
const ALIGNMENT = Math.cos((15 * Math.PI) / 180)
const METERS = (Math.PI * 6371000) / 180
const project = ([lat, lng]: [number, number]): Point => ({
  x: (lng - 127) * METERS * Math.cos((37.5665 * Math.PI) / 180),
  y: (lat - 37.5665) * METERS,
})
const between = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

function currentSpeed(road: MapRoadSegment, now: number) {
  const info = road.information
  const collected = Date.parse(road.receivedAt)
  if (
    !road.live ||
    info?.status !== 'available' ||
    info.freshness === 'stale' ||
    info.reason_code === 'COLLECTION_FAILED' ||
    !Number.isFinite(collected) ||
    collected > now ||
    now - collected > 30 * 60000 ||
    road.speed === null ||
    !Number.isFinite(road.speed) ||
    road.speed < 0
  )
    return null
  return road.speed
}

/** A conservative geometric overlap, not a shared-ID or lane-level correspondence.
 * Crossings, competing nearby links and missing observations stay unknown.
 * A small spatial grid keeps repeated route samples off the full road collection.
 */
export function colorRouteByRoads(
  routes: RouteSegment[],
  roads: MapRoadSegment[],
  now = Date.now(),
): ColoredRouteSegment[] {
  const cells = new Map<string, Edge[]>()
  const speeds = new Map<string, number | null>()
  for (const road of roads) {
    const speed = currentSpeed(road, now)
    speeds.set(road.id, speeds.has(road.id) && speeds.get(road.id) !== speed ? null : speed)
    const points = road.path.map(project)
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (!Number.isFinite(length) || !length) continue
      // Subdivide long diagonals before indexing their bounding rectangles.
      const count = Math.ceil(length / CELL)
      for (let step = 0; step < count; step++) {
        const edge: Edge = {
          a: between(a, b, step / count),
          b: between(a, b, (step + 1) / count),
          length: length / count,
          id: road.id,
        }
        const left = Math.floor((Math.min(edge.a.x, edge.b.x) - TOLERANCE) / CELL)
        const right = Math.floor((Math.max(edge.a.x, edge.b.x) + TOLERANCE) / CELL)
        const top = Math.floor((Math.min(edge.a.y, edge.b.y) - TOLERANCE) / CELL)
        const bottom = Math.floor((Math.max(edge.a.y, edge.b.y) + TOLERANCE) / CELL)
        for (let x = left; x <= right; x++)
          for (let y = top; y <= bottom; y++) {
            const key = `${x},${y}`
            const bucket = cells.get(key) || []
            bucket.push(edge)
            cells.set(key, bucket)
          }
      }
    }
  }
  const matches = (point: Point, dx: number, dy: number, length: number) => {
    const ids = new Set<string>()
    const edges = cells.get(`${Math.floor(point.x / CELL)},${Math.floor(point.y / CELL)}`) || []
    for (const edge of edges) {
      const ex = edge.b.x - edge.a.x,
        ey = edge.b.y - edge.a.y
      if (Math.abs(dx * ex + dy * ey) / (length * edge.length) < ALIGNMENT) continue
      const t = ((point.x - edge.a.x) * ex + (point.y - edge.a.y) * ey) / edge.length ** 2
      // Do not extend an observation past either end of its actual geometry.
      if (t < -1e-6 || t > 1 + 1e-6) continue
      if (Math.hypot(point.x - edge.a.x - t * ex, point.y - edge.a.y - t * ey) <= TOLERANCE)
        ids.add(edge.id)
    }
    return ids
  }
  const output: ColoredRouteSegment[] = []
  for (const route of routes) {
    let previous: ColoredRouteSegment | undefined
    const append = (a: [number, number], b: [number, number], color: string) => {
      if (previous?.color === color) previous.path.push(b)
      else {
        previous = { path: [a, b], color }
        output.push(previous)
      }
    }
    for (let i = 1; i < route.path.length; i++) {
      const start = route.path[i - 1],
        end = route.path[i]
      const a = project(start),
        b = project(end)
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy)
      if (!Number.isFinite(length) || !length) continue
      if (!cells.size) {
        append(start, end, UNKNOWN_ROUTE_COLOR)
        continue
      }
      const count = Math.ceil(length / 10)
      const coordinate = (t: number): [number, number] => [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]
      for (let step = 0; step < count; step++) {
        const ids = [step / count, (step + 0.5) / count, (step + 1) / count].map((t) =>
          matches(between(a, b, t), dx, dy, length),
        )
        // All samples must identify the same single road. Even an unobserved
        // competing road makes the correspondence ambiguous.
        const id = ids[0].values().next().value
        const speed =
          id && ids.every((found) => found.size === 1 && found.has(id)) ? speeds.get(id) : null
        append(
          coordinate(step / count),
          coordinate((step + 1) / count),
          speed == null ? UNKNOWN_ROUTE_COLOR : roadSpeedColor(speed),
        )
      }
    }
  }
  return output
}
