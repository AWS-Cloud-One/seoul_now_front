import L from './vendor/leaflet.js'
import { placeById } from './domain.js'
import { normalizeParkingResponse } from './parking/normalize'
import { parkingAvailability, parkingBadge } from './parking/display'
const PARKING_ICON =
  '<svg class="parking-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.2 5.5h11.6a1.5 1.5 0 0 1 1.4 1l1.1 3.2c.9.3 1.5 1.1 1.5 2.100V17a1 1 0 0 1-1 1h-1.500a1 1 0 0 1-1-1v-1H5.700v1a1 1 0 0 1-1 1H3.200a1 1 0 0 1-1-1v-4.200c0-1 .6-1.800 1.500-2.100l1.100-3.200a1.500 1.500 0 0 1 1.400-1Zm.4 2-.8 2.300h12.400l-.8-2.300ZM6.500 14.300a1.400 1.400 0 1 0 0-2.800 1.400 1.400 0 0 0 0 2.800Zm11 0a1.400 1.400 0 1 0 0-2.800 1.400 1.400 0 0 0 0 2.800Z"/></svg>'
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
export function createMapLayers(
  map,
  {
    data: SEOUL_MAP_DATA,
    overview = false,
    parkingRecords,
    layers,
    result,
    selected,
    onRecord,
    onParkingHint,
  },
) {
  const NEARBY_RADIUS_METERS = 800
  const POPULATION_COLORS = {
    여유: '#679dd5',
    보통: '#dfbb58',
    '약간 붐빔': '#e58b44',
    붐빔: '#cf5c70',
  }
  const roadColor = (road) =>
    road.speed == null
      ? '#8999aa'
      : road.speed < 20
        ? '#d9544e'
        : road.speed < 40
          ? '#c58e24'
          : '#208973'
  function groupParking(records) {
    const positions = new Map()
    for (const p of records) {
      if (p.lat === null || p.lng === null) continue
      const key = `${p.lat},${p.lng}`
      if (!positions.has(key)) positions.set(key, { lat: p.lat, lng: p.lng, records: [] })
      positions.get(key).records.push(p)
    }
    return [...positions.values()]
  }
  let PARKING_LOCATIONS = groupParking(
    parkingRecords ?? normalizeParkingResponse(SEOUL_MAP_DATA.parking),
  )
  const POPULATION_AREAS = SEOUL_MAP_DATA.population.features
    .map((feature) => {
      const polygons =
        feature.geometry.type === 'MultiPolygon'
          ? feature.geometry.coordinates
          : [feature.geometry.coordinates]
      const points = polygons.flat(2)
      const bbox = [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ]
      return {
        feature,
        polygons,
        bbox,
        level: Object.keys(POPULATION_COLORS).indexOf(feature.properties.congestion),
      }
    })
    .sort((a, b) => a.level - b.level)
  function pointInRing(lng, lat, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i],
        [xj, yj] = ring[j]
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  function areaContains(area, latlng) {
    return area.polygons.some(
      (rings) =>
        pointInRing(latlng.lng, latlng.lat, rings[0]) &&
        !rings.slice(1).some((ring) => pointInRing(latlng.lng, latlng.lat, ring)),
    )
  }
  function intersectsMapBox(bbox, bounds) {
    const [w, s, e, n] = bbox
    return (
      e >= bounds.getWest() &&
      w <= bounds.getEast() &&
      n >= bounds.getSouth() &&
      s <= bounds.getNorth()
    )
  }
  function distanceToPlace(lat, lng, place) {
    const radians = Math.PI / 180,
      dLat = (lat - place.lat) * radians,
      dLng = (lng - place.lon) * radians
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * radians) * Math.cos(place.lat * radians) * Math.sin(dLng / 2) ** 2
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  }
  function isNearPlaces(lat, lng, places) {
    return places.some((place) => distanceToPlace(lat, lng, place) <= NEARBY_RADIUS_METERS)
  }
  function areaNearPlace(area, place) {
    if (areaContains(area, { lat: place.lat, lng: place.lon })) return true
    // Project just this local neighborhood into meters to test polygon edges.
    const sy = (Math.PI * 6371000) / 180,
      sx = sy * Math.cos((place.lat * Math.PI) / 180),
      r2 = NEARBY_RADIUS_METERS ** 2
    const [w, s, e, n] = area.bbox
    if (
      w > place.lon + NEARBY_RADIUS_METERS / sx ||
      e < place.lon - NEARBY_RADIUS_METERS / sx ||
      s > place.lat + NEARBY_RADIUS_METERS / sy ||
      n < place.lat - NEARBY_RADIUS_METERS / sy
    )
      return false
    for (const polygon of area.polygons)
      for (const ring of polygon)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = (ring[j][0] - place.lon) * sx,
            ay = (ring[j][1] - place.lat) * sy,
            bx = (ring[i][0] - place.lon) * sx,
            by = (ring[i][1] - place.lat) * sy
          const dx = bx - ax,
            dy = by - ay,
            length = dx * dx + dy * dy
          const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0
          if ((ax + t * dx) ** 2 + (ay + t * dy) ** 2 <= r2) return true
        }
    return false
  }
  function mapNeighborhood(result) {
    // Match the displayed results, including a retained result during a new search.
    const places = (result?.entries || [])
      .map((entry) => placeById(entry.id, result))
      .filter(Boolean)
    return {
      places,
      parking: PARKING_LOCATIONS,
      population: POPULATION_AREAS,
    }
  }
  function parkingGrid(map, zoom, locations, cache) {
    if (cache.has(zoom)) return cache.get(zoom)
    const cell = zoom < 15 ? 108 : zoom < 17 ? 84 : 64,
      groups = new Map()
    for (const location of locations) {
      const point = map.project([location.lat, location.lng], zoom),
        key = `${zoom}:${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(location)
    }
    const grid = [...groups.entries()].map(([key, locations]) => ({
      key,
      locations,
      lat: locations.reduce((n, p) => n + p.lat, 0) / locations.length,
      lng: locations.reduce((n, p) => n + p.lng, 0) / locations.length,
    }))
    cache.set(zoom, grid)
    if (cache.size > 4) cache.delete(cache.keys().next().value)
    return grid
  }

  const neighborhood = mapNeighborhood(result),
    parkingCache = new Map()
  const panes = [
    ['observed-population', 390],
    ['observed-roads', 420],
    ['registered-parking', 580],
  ]
  for (const [name, z] of panes) {
    ;(map.getPane(name) || map.createPane(name)).style.zIndex = String(z)
  }
  const heatPane = map.getPane('observed-population')
  heatPane.style.pointerEvents = 'none'
  const heat = L.DomUtil.create('canvas', 'population-heat-canvas leaflet-zoom-hide', heatPane)
  heat.setAttribute('aria-hidden', 'true')
  const mask = document.createElement('canvas'),
    scopeMask = document.createElement('canvas')
  const roadRenderer = L.canvas({ pane: 'observed-roads', padding: 0.2, tolerance: 4 })
  const roadLayer = L.layerGroup().addTo(map),
    parkingLayer = L.layerGroup().addTo(map)
  const roadItems = new Map(),
    parkingItems = new Map()
  const parkingMembers = new Map()
  let highlightedParking = null
  let focusedParkingMarker = null
  let focusedParkingKey = ''
  function highlightParking(id) {
    highlightedParking = id
    const location =
      layers.parking && id
        ? PARKING_LOCATIONS.find((item) =>
            item.records.some((record) => record.id === id || record.memberIds?.includes(id)),
          )
        : undefined
    const record = location?.records.find((item) => item.id === id || item.memberIds?.includes(id))
    const markerId = record?.id
    for (const [key, marker] of parkingItems) {
      const individual =
        parkingMembers.get(key)?.size === 1 && parkingMembers.get(key)?.has(markerId)
      const element = marker.getElement()
      element?.classList.remove('is-selected')
      element?.setAttribute('aria-pressed', 'false')
      if (element) element.style.visibility = individual ? 'hidden' : ''
      marker.setZIndexOffset(0)
    }
    if (!location || !record) {
      focusedParkingMarker?.remove()
      focusedParkingMarker = null
      focusedParkingKey = ''
      return
    }
    const key = JSON.stringify([id, location.lat, location.lng, record.name, record.address])
    if (key === focusedParkingKey && focusedParkingMarker) return
    focusedParkingMarker?.remove()
    focusedParkingKey = key
    const label = record.name + (record.address ? ' · ' + record.address : ' · 주소 정보 없음')
    focusedParkingMarker = L.marker([location.lat, location.lng], {
      icon: L.divIcon({
        className: 'sn-focused-parking',
        html: PARKING_ICON,
        iconSize: [40, 48],
        iconAnchor: [20, 48],
      }),
      title: label,
      zIndexOffset: 1500,
      keyboard: true,
    }).addTo(map)
    focusedParkingMarker.getElement()?.setAttribute('aria-label', '살펴보는 주차장: ' + label)
    focusedParkingMarker.getElement()?.setAttribute('aria-pressed', 'true')
    focusedParkingMarker.bindTooltip(
      '<strong>' +
        esc(record.name) +
        '</strong><span>' +
        esc(record.address || '주소 정보 없음') +
        '</span>',
      {
        permanent: true,
        direction: 'top',
        offset: [0, -48],
        className: 'sn-focused-parking-label',
      },
    )
    focusedParkingMarker.on('click', () => {
      const current = PARKING_LOCATIONS.find((item) =>
        item.records.some((item) => item.id === record.id),
      )
      if (current) onRecord({ kind: 'parking', data: current }, [current.lat, current.lng])
    })
  }
  const zoomToParking = () => {
    const focus =
      neighborhood.places.find((place) => place.id === selected) || neighborhood.places[0]
    if (focus)
      map.setView([focus.lat, focus.lon], 14, {
        animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
    else if (overview) map.setView(map.getCenter(), 14)
  }

  let frame = 0,
    destroyed = false,
    lastRoadStyle = '',
    lastHeatView = '',
    heatVisible = []
  function drawHeat() {
    heat.hidden = !layers.population || !neighborhood.population.length
    if (heat.hidden) {
      heatVisible = []
      lastHeatView = ''
      return
    }
    const size = map.getSize(),
      origin = map.containerPointToLayerPoint([0, 0]),
      zoom = map.getZoom(),
      center = map.getCenter()
    const view = [center.lat, center.lng, zoom, size.x, size.y].join(':')
    if (view === lastHeatView) return
    lastHeatView = view
    // Low-resolution offscreen raster keeps blur inexpensive on high-DPI displays.
    const pad = 90,
      scale = 0.75,
      width = Math.ceil((size.x + pad * 2) * scale),
      height = Math.ceil((size.y + pad * 2) * scale)
    scopeMask.width = mask.width = heat.width = width
    scopeMask.height = mask.height = heat.height = height
    heat.style.width = `${size.x + pad * 2}px`
    heat.style.height = `${size.y + pad * 2}px`
    L.DomUtil.setPosition(heat, origin.subtract([pad, pad]))
    const ctx = mask.getContext('2d'),
      output = heat.getContext('2d')
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    heatVisible = neighborhood.population.filter((area) =>
      intersectsMapBox(area.bbox, map.getBounds().pad(0.25)),
    )
    for (const area of heatVisible) {
      ctx.beginPath()
      for (const polygon of area.polygons)
        for (const ring of polygon) {
          ring.forEach(([lng, lat], i) => {
            const point = map.latLngToContainerPoint([lat, lng])
            if (i === 0) ctx.moveTo(point.x + pad, point.y + pad)
            else ctx.lineTo(point.x + pad, point.y + pad)
          })
          ctx.closePath()
        }
      ctx.fillStyle = POPULATION_COLORS[area.feature.properties.congestion] || '#a0abb9'
      ctx.globalAlpha = [0.35, 0.47, 0.6, 0.7][area.level] || 0.3
      ctx.fill('evenodd')
    }
    output.filter = `blur(${(zoom < 13 ? 14 : zoom < 15 ? 20 : 26) * scale}px)`
    output.drawImage(mask, 0, 0)
    output.filter = 'none'
  }
  function drawRoads(bounds, zoom) {
    const present = new Set(),
      weight = zoom < 12 ? 1.2 : zoom < 14 ? 1.8 : zoom < 16 ? 2.6 : 3.4,
      opacity = zoom < 13 ? 0.7 : 0.9
    const styleKey = String(weight),
      styleChanged = styleKey !== lastRoadStyle
    lastRoadStyle = styleKey
    if (layers.roads)
      for (const road of SEOUL_MAP_DATA.roads) {
        if (!intersectsMapBox(road.bbox, bounds)) continue
        present.add(road.id)
        if (roadItems.has(road.id)) {
          if (styleChanged) roadItems.get(road.id).setStyle({ weight, opacity })
          continue
        }
        const line = L.polyline(road.path, {
          pane: 'observed-roads',
          renderer: roadRenderer,
          color: roadColor(road),
          weight,
          opacity,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 1.2,
          bubblingMouseEvents: false,
        })
        line.bindTooltip(esc(road.name || '도로 정보'), {
          sticky: true,
          className: 'map-record-tooltip',
          direction: 'top',
        })
        line.on('click', (e) => onRecord({ kind: 'road', data: road }, e.latlng))
        line.addTo(roadLayer)
        roadItems.set(road.id, line)
      }
    for (const [id, line] of roadItems)
      if (!present.has(id)) {
        roadLayer.removeLayer(line)
        roadItems.delete(id)
      }
  }
  function drawParking(bounds, zoom) {
    const present = new Set()
    onParkingHint(false, zoomToParking)
    const nearby = layers.parking
      ? parkingGrid(map, zoom, neighborhood.parking, parkingCache).filter((group) =>
          bounds.contains([group.lat, group.lng]),
        )
      : []
    if (nearby.length)
      for (const group of nearby) {
        const { key, locations, lat, lng } = group
        present.add(key)
        if (parkingItems.has(key)) continue
        const count = locations.length,
          cluster = count > 1
        const label = cluster
          ? `주차장 ${count}개 · 눌러서 확대`
          : `${locations[0].records[0].name}${locations[0].records[0].available === null ? '' : ` · ${parkingAvailability(locations[0].records[0].available)}`}`
        const available = locations[0].records[0].available
        // Unknown vacancy is stated once in the legend/detail, not on every marker.
        const badge = cluster ? count : available === 0 ? '만차' : null
        const marker = L.marker([lat, lng], {
          pane: 'registered-parking',
          icon: L.divIcon({
            className: `registered-parking-marker ${cluster ? 'is-cluster' : ''} ${!cluster && available === null ? 'is-unknown' : ''} ${!cluster && available === 0 ? 'is-full' : ''}`,
            html: `${PARKING_ICON}${badge !== null ? `<b>${esc(badge)}</b>` : ''}`,
            iconSize: badge !== null ? [68, 34] : [34, 34],
            iconAnchor: badge !== null ? [34, 17] : [17, 17],
          }),
          title: label,
          keyboard: true,
          riseOnHover: true,
        }).addTo(parkingLayer)
        marker.getElement()?.setAttribute('aria-label', label)
        marker.bindTooltip(esc(label), {
          className: 'map-record-tooltip',
          direction: 'top',
          offset: [0, -15],
          permanent: false,
        })
        marker.on('click', () => {
          for (const item of parkingItems.values())
            item.getElement()?.classList.remove('is-selected')
          marker.getElement()?.classList.add('is-selected')
          if (cluster && zoom < 19) {
            map.flyToBounds(
              locations.map((p) => [p.lat, p.lng]),
              {
                paddingTopLeft: [60, 90],
                paddingBottomRight: [60, 160],
                maxZoom: Math.min(19, zoom + 3),
                animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
                duration: 0.55,
              },
            )
          } else if (cluster) {
            const items = locations.flatMap((p) =>
              p.records.map((r) => ({ location: p, record: r })),
            )
            onRecord({ kind: 'parking-cluster', data: items }, [lat, lng])
          } else onRecord({ kind: 'parking', data: locations[0] }, [lat, lng])
        })
        parkingItems.set(key, marker)
        parkingMembers.set(
          key,
          new Set(locations.flatMap((location) => location.records.map((record) => record.id))),
        )
      }
    for (const [key, marker] of parkingItems)
      if (!present.has(key)) {
        parkingLayer.removeLayer(marker)
        parkingItems.delete(key)
        parkingMembers.delete(key)
      }
  }
  function draw() {
    frame = 0
    if (destroyed) return
    const bounds = map.getBounds().pad(0.12),
      zoom = map.getZoom()
    drawHeat()
    drawRoads(bounds, zoom)
    drawParking(bounds, zoom)
    highlightParking(highlightedParking)
  }
  const schedule = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(draw)
  }
  const onAreaClick = (e) => {
    if (!layers.population || e.propagatedFrom) return
    const area = [...heatVisible].reverse().find((area) => areaContains(area, e.latlng))
    if (area) onRecord({ kind: 'population', data: area.feature }, e.latlng)
  }
  map.on('moveend zoomend resize', schedule)
  map.on('click', onAreaClick)
  draw()
  return {
    highlightParking,
    updateParking(records) {
      PARKING_LOCATIONS = groupParking(records)
      neighborhood.parking = PARKING_LOCATIONS
      parkingCache.clear()
      parkingLayer.clearLayers()
      parkingItems.clear()
      parkingMembers.clear()
      schedule()
    },
    update() {
      map.closePopup()
      schedule()
    },
    destroy() {
      destroyed = true
      focusedParkingMarker?.remove()
      focusedParkingMarker = null
      if (frame) cancelAnimationFrame(frame)
      map.off('moveend zoomend resize', schedule)
      map.off('click', onAreaClick)
      heat.remove()
      map.removeLayer(roadLayer)
      map.removeLayer(parkingLayer)
      map.removeLayer(roadRenderer)
      roadItems.clear()
      parkingItems.clear()
      parkingMembers.clear()
      parkingCache.clear()
    },
  }
}
