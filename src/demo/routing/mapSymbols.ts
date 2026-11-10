export const endpointHtml = (kind: 'origin' | 'destination') =>
  `<span class="sn-route-endpoint is-${kind}"><svg viewBox="0 0 40 50" aria-hidden="true"><path d="M20 2C10 2 3 9 3 19c0 10 17 28 17 28s17-18 17-28C37 9 30 2 20 2Z"/><text x="20" y="22" text-anchor="middle">${kind === 'origin' ? '출발' : '도착'}</text></svg></span>`
export const arrowHtml = (angle: number, size = 10) =>
  `<svg class="sn-route-arrow" style="transform:rotate(${angle}deg);width:${size}px;height:${size}px" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2 8 5 2 8 3.5 5Z" /></svg>`

// Covers the Seoul service area and its surrounding map viewport.
export const ROUTE_BACKDROP = {
  path: [
    [30, 118],
    [30, 137],
    [44, 137],
    [44, 118],
  ] as [number, number][],
  color: '#ffffff',
  opacity: 0.45,
}

/** Both map providers use the same zoom convention here (Kakao: 20 - level). */
export function routeLineWidths(zoom: number) {
  const line = Math.min(11, Math.max(3, 3 + (zoom - 12) * 1.6))
  return { line, outline: line + (line > 7 ? 4 : 2), arrow: line - 1 }
}

/** Place direction marks at screen-space intervals, pointing toward the next route point. */
export function routeArrows(
  path: [number, number][],
  project: (point: [number, number]) => { x: number; y: number },
  width: number,
  height: number,
) {
  const pixels = path.map(project)
  const marks: { lat: number; lng: number; angle: number }[] = []
  let travelled = 0,
    next = 24
  for (let i = 1; i < path.length; i++) {
    const a = pixels[i - 1],
      b = pixels[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    while (next <= travelled + length) {
      const ratio = (next - travelled) / length
      const x = a.x + (b.x - a.x) * ratio,
        y = a.y + (b.y - a.y) * ratio
      if (x >= 0 && x <= width && y >= 0 && y <= height)
        marks.push({
          lat: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * ratio,
          lng: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * ratio,
          angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
        })
      next += 18
      if (marks.length >= 1400) return marks
    }
    travelled += length
  }
  return marks
}
