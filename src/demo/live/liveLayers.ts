import L from '../vendor/leaflet.js'
import { LEVEL_COLORS, type LivePlace, type LiveState, type RoadSegment } from './store'
type LeafletMap = ReturnType<typeof L.map>

const TRAFFIC_COLORS: Record<string, string> = {
  원활: '#1f9d6b',
  서행: '#e0a21b',
  정체: '#d4443b',
}
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Greys out everything outside Seoul and draws live hotspot areas on the shared map. */
export function createLiveLayers(map: LeafletMap, options: { onSelect: (code: string) => void }) {
  const maskPane = map.getPane('seoul-mask') || map.createPane('seoul-mask')
  maskPane.style.zIndex = '330'
  maskPane.style.pointerEvents = 'none'
  const placePane = map.getPane('live-places') || map.createPane('live-places')
  placePane.style.zIndex = '410'
  const trafficPane = map.getPane('live-traffic') || map.createPane('live-traffic')
  trafficPane.style.zIndex = '430'
  trafficPane.style.pointerEvents = 'none'
  const maskRenderer = L.canvas({ pane: 'seoul-mask', padding: 1 })
  let mask: { remove(): void } | null = null
  let maskSource: unknown = null
  const places = L.layerGroup().addTo(map)
  const traffic = L.layerGroup().addTo(map)
  let lastPlaces: LivePlace[] = []
  let lastSelected: string | null = null
  let visible = true

  function drawMask(boundary: [number, number][][] | null) {
    if (boundary === maskSource) return
    maskSource = boundary
    mask?.remove()
    mask = null
    if (!boundary?.length) return
    const world: [number, number][] = [
      [30, 118],
      [30, 137],
      [44, 137],
      [44, 118],
    ]
    mask = L.polygon([world, ...boundary], {
      pane: 'seoul-mask',
      renderer: maskRenderer,
      stroke: false,
      fillColor: '#6b7280',
      fillOpacity: 0.62,
      fillRule: 'evenodd',
      interactive: false,
    }).addTo(map)
  }
  function drawPlaces() {
    places.clearLayers()
    if (!visible) return
    for (const place of lastPlaces) {
      const color = LEVEL_COLORS[place.level]
      const selected = place.code === lastSelected
      const polygon = L.polygon(place.ring, {
        pane: 'live-places',
        color,
        weight: selected ? 3 : 0,
        opacity: selected ? 1 : 0,
        fillColor: color,
        fillOpacity: selected ? 0.12 : 0,
      }).addTo(places)
      polygon.on('click', () => options.onSelect(place.code))
      const pin = L.marker([place.lat, place.lng], {
        pane: 'live-places',
        icon: L.divIcon({
          className: `sn-live-pin ${selected ? 'is-selected' : ''}`,
          html: selected ? `<span style="background:${color}"></span>` : '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        title: `${place.name} · ${place.level}`,
        keyboard: true,
        zIndexOffset: selected ? 500 : 0,
      }).addTo(places)
      pin.on('click', () => options.onSelect(place.code))
      pin.bindTooltip(`${esc(place.name)} · ${esc(place.level)}`, {
        direction: 'top',
        offset: [0, -10],
        className: 'destination-label',
        permanent: selected,
      })
    }
  }
  map.on('zoomend', drawPlaces)
  return {
    update(state: LiveState, show: boolean) {
      drawMask(state.boundary)
      const changed =
        state.places !== lastPlaces || state.selected !== lastSelected || show !== visible
      lastPlaces = state.places
      lastSelected = state.selected
      visible = show
      if (changed) drawPlaces()
    },
    focus(code: string | null) {
      const place = lastPlaces.find((p) => p.code === code)
      if (place)
        map.fitBounds(place.ring, {
          paddingTopLeft: [40, 80],
          paddingBottomRight: [40, 120],
          maxZoom: 16,
        })
    },
    setTraffic(segments: RoadSegment[] | null) {
      traffic.clearLayers()
      for (const segment of segments || []) {
        const color = TRAFFIC_COLORS[segment.level] || '#8999aa'
        L.polyline(segment.path, {
          pane: 'live-traffic',
          color: '#ffffff',
          weight: 9,
          opacity: 0.85,
          interactive: false,
        }).addTo(traffic)
        L.polyline(segment.path, {
          pane: 'live-traffic',
          color,
          weight: 5,
          opacity: 0.95,
        })
          .bindTooltip(
            `${esc(segment.name)} · ${esc(segment.level)}${segment.speed !== null ? ` ${segment.speed}km/h` : ''}`,
            { sticky: true, className: 'destination-label' },
          )
          .addTo(traffic)
      }
    },
    destroy() {
      map.off('zoomend', drawPlaces)
      mask?.remove()
      places.remove()
      traffic.remove()
    },
  }
}
