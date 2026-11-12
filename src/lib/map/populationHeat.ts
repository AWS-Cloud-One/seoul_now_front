import type { Level, LivePlace } from '../../state/live/store'

export const POPULATION_HEAT_COLORS: Record<Level, string> = {
  여유: '#679dd5',
  보통: '#dfbb58',
  '약간 붐빔': '#e58b44',
  붐빔: '#cf5c70',
  '정보 없음': '#a0abb9',
}

export function containsPopulationPoint(ring: [number, number][], lat: number, lng: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [aLat, aLng] = ring[i]
    const [bLat, bLng] = ring[j]
    if (aLat > lat !== bLat > lat && lng < aLng + ((bLng - aLng) * (lat - aLat)) / (bLat - aLat)) {
      inside = !inside
    }
  }
  return inside
}

/** The original map's blurred polygon mask, projected onto the current map viewport. */
export function populationHeat(
  places: LivePlace[],
  width: number,
  height: number,
  zoom: number,
  project: (point: [number, number]) => { x: number; y: number },
) {
  const pad = 90,
    scale = 0.75
  const heat = document.createElement('canvas'),
    mask = document.createElement('canvas')
  heat.width = mask.width = Math.ceil((width + pad * 2) * scale)
  heat.height = mask.height = Math.ceil((height + pad * 2) * scale)
  heat.style.width = `${width + pad * 2}px`
  heat.style.height = `${height + pad * 2}px`
  heat.style.pointerEvents = 'none'
  heat.className = 'sn-population-heat'
  heat.setAttribute('aria-hidden', 'true')
  const context = mask.getContext('2d'),
    output = heat.getContext('2d')
  if (!context || !output) return heat
  context.setTransform(scale, 0, 0, scale, 0, 0)
  const opacity = { 여유: 0.35, 보통: 0.47, '약간 붐빔': 0.6, 붐빔: 0.7, '정보 없음': 0.3 }
  for (const place of places) {
    const rings = (place.polygons || [[place.ring]]).flat()
    const points = rings.flatMap((ring) => ring.map(project))
    if (
      !points.length ||
      Math.max(...points.map((p) => p.x)) < -pad ||
      Math.min(...points.map((p) => p.x)) > width + pad ||
      Math.max(...points.map((p) => p.y)) < -pad ||
      Math.min(...points.map((p) => p.y)) > height + pad
    )
      continue
    context.beginPath()
    for (const ring of rings) {
      ring.map(project).forEach((point, i) => {
        if (i === 0) context.moveTo(point.x + pad, point.y + pad)
        else context.lineTo(point.x + pad, point.y + pad)
      })
      context.closePath()
    }
    context.fillStyle = POPULATION_HEAT_COLORS[place.level]
    context.globalAlpha = opacity[place.level]
    context.fill('evenodd')
  }
  output.filter = `blur(${(zoom < 13 ? 14 : zoom < 15 ? 20 : 26) * scale}px)`
  output.drawImage(mask, 0, 0)
  return heat
}
