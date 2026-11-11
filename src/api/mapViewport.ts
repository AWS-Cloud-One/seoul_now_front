import type { MapQuery } from './queries'

// Share the query contract across Kakao and Leaflet; never round only the CDN key.
export function containsViewport(outer: MapQuery, inner: MapQuery) {
  return (
    outer.level === inner.level &&
    outer.bbox[0] <= inner.bbox[0] &&
    outer.bbox[1] <= inner.bbox[1] &&
    outer.bbox[2] >= inner.bbox[2] &&
    outer.bbox[3] >= inner.bbox[3]
  )
}

export function bufferedViewport(query: MapQuery): MapQuery {
  const [w, s, e, n] = query.bbox
  const dx = (e - w) * 0.1,
    dy = (n - s) * 0.1
  const down = (v: number) => Math.floor(v * 100000) / 100000
  const up = (v: number) => Math.ceil(v * 100000) / 100000
  return {
    level: query.level,
    bbox: [
      Math.max(-180, down(w - dx)),
      Math.max(-90, down(s - dy)),
      Math.min(180, up(e + dx)),
      Math.min(90, up(n + dy)),
    ],
  }
}
