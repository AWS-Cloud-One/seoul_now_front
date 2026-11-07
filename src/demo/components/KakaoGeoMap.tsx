import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadKakaoSdk } from '../kakaoSdk'
import { useDemo } from '../useDemo'
import { useParkingData } from '../parking/useParkingData'
import { DEPARTURES, placeById } from '../domain.js'
import { SEOUL_VIEW_BOUNDS } from '../data/seoulBoundary'
import { fetchRoadTraffic, useLive, startLive, type MapRoadSegment } from '../live/store'
import {
  getMapOverlay,
  MAP_OVERLAY_EVENT,
  MAP_FOCUS_EVENT,
  PARKING_SELECT_EVENT,
  type MapOverlay,
} from './shell/useRoute'
import type { ParkingFacility } from '../parking/facilities'
import type { MapRecord as RecordData } from '../mapLayers'
import markerIcons from '../data/icons.json'
import MapRecord from './MapRecord'
import { livePopulationRecord } from '../live/populationLabels'
import { populationHeat, containsPopulationPoint } from '../live/populationHeat'
import { roadSpeedColor } from '../live/roadStyle'
import Icon from './Icon'
import { routeTrafficColor } from '../routing/traffic'
import { arrowHtml, endpointHtml, routeArrows } from '../routing/mapSymbols'

type Drawable = { setMap(map: kakao.maps.Map | null): void }
const position = (lat: number, lng: number) => new kakao.maps.LatLng(lat, lng)
const svg = (name: keyof typeof markerIcons) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
  markerIcons[name] +
  '</svg>'
function overview(map: kakao.maps.Map) {
  const bounds = new kakao.maps.LatLngBounds(
    position(...SEOUL_VIEW_BOUNDS[0]),
    position(...SEOUL_VIEW_BOUNDS[1]),
  )
  const mobile = matchMedia('(max-width:900px)').matches
  const panel = document.querySelector<HTMLElement>('.sn-panel')
  map.setBounds(
    bounds,
    36,
    28,
    mobile ? Math.min(panel?.offsetHeight || 0, window.innerHeight * 0.45) : 36,
    28,
  )
}
export default function KakaoGeoMap({
  preview = false,
}: {
  preview?: boolean
  parkingHintRequested?: boolean
}) {
  const { active, result, layers, patchUI, selectPlace, saveMap, notify } = useDemo()
  const parking = useParkingData('map')
  const live = useLive()
  const populationPlaces = live.places.some((place) => !place.stale) || !live.savedPlaces.length
    ? live.places
    : live.savedPlaces
  const root = useRef<HTMLDivElement>(null)
  const instance = useRef<kakao.maps.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tick, setTick] = useState(0)
  const updateRoads = useRef<(() => void) | null>(null)
  const [overlay, setOverlay] = useState<MapOverlay>(getMapOverlay)
  const [cityTraffic, setCityTraffic] = useState<MapRoadSegment[]>([])
  const findRoad = useRef<((point: kakao.maps.LatLng) => MapRoadSegment | undefined) | null>(null)
  const showRoadTraffic = layers.roads && !overlay.route?.length
  const [focused, setFocused] = useState<string | null>(
    active.parkingSelections?.[active.selected || ''] || null,
  )
  const [record, setRecord] = useState<RecordData | null>(null)
  const [popupHost] = useState(() => {
    const element = document.createElement('div')
    element.className = 'sn-kakao-record-anchor'
    return element
  })
  useEffect(() => {
    const map = instance.current,
      container = root.current
    if (!ready || !map || !container || !record) return
    if (record.kind === 'population' && !layers.population) return
    if (record.kind === 'road' && !showRoadTraffic) return
    const locationData = record.kind === 'parking-cluster' ? record.data[0]?.location : record.data
    if (!locationData || !('lat' in locationData) || !('lng' in locationData)) return
    const { lat, lng } = locationData
    if (lat === undefined || lng === undefined) return
    const location = position(lat, lng)
    const pinGap = record.kind === 'parking' ? 54 : 16
    const popup = new kakao.maps.CustomOverlay({
      map,
      position: location,
      content: popupHost,
      xAnchor: 0,
      yAnchor: 0,
      clickable: true,
      zIndex: 100,
    })
    const placePopup = () => {
      const rect = container.getBoundingClientRect()
      const panel = document.querySelector<HTMLElement>('.sn-panel')?.getBoundingClientRect()
      const bottom =
        matchMedia('(max-width:900px)').matches && panel
          ? Math.min(rect.height, Math.max(0, panel.top - rect.top))
          : rect.height
      const point = map.getProjection().containerPointFromCoords(location)
      const visible = point.x >= 0 && point.x <= rect.width && point.y >= 0 && point.y <= bottom
      popupHost.style.setProperty('visibility', visible ? 'visible' : 'hidden')
      if (!visible) return
      const width = Math.min(300, rect.width - 24)
      popupHost.style.setProperty('width', `${width}px`)
      const above = point.y - pinGap - 10,
        below = bottom - point.y - 20
      const onTop = above >= 300 || above >= below
      popupHost.style.setProperty(
        '--sn-popup-max-height',
        `${Math.max(64, Math.min(360, onTop ? above : below))}px`,
      )
      const height = popupHost.offsetHeight
      const left = Math.max(12, Math.min(rect.width - width - 12, point.x - width / 2))
      popupHost.style.setProperty(
        'transform',
        `translate(${left - point.x}px, ${onTop ? -height - pinGap : 16}px)`,
      )
      popupHost.setAttribute('data-side', onTop ? 'above' : 'below')
    }
    const close = () => setRecord(null)
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const observer = new ResizeObserver(placePopup)
    observer.observe(container)
    observer.observe(popupHost)
    const panel = document.querySelector('.sn-panel')
    if (panel) observer.observe(panel)
    kakao.maps.event.addListener(map, 'center_changed', placePopup)
    kakao.maps.event.addListener(map, 'zoom_changed', placePopup)
    kakao.maps.event.addListener(map, 'idle', placePopup)
    window.addEventListener('keydown', keyboard)
    placePopup()
    return () => {
      observer.disconnect()
      popup.setMap(null)
      kakao.maps.event.removeListener(map, 'center_changed', placePopup)
      kakao.maps.event.removeListener(map, 'zoom_changed', placePopup)
      kakao.maps.event.removeListener(map, 'idle', placePopup)
      window.removeEventListener('keydown', keyboard)
    }
  }, [ready, record, popupHost, layers.population, showRoadTraffic])
  useEffect(() => {
    const map = instance.current
    if (!ready || !map) return
    const click = (event: { latLng: kakao.maps.LatLng }) => {
      const lat = event.latLng.getLat(),
        lng = event.latLng.getLng()
      const road = findRoad.current?.(event.latLng)
      if (road) {
        setRecord({ kind: 'road', data: { ...road, lat, lng } })
        return
      }
      const place = layers.population
        ? [...populationPlaces].reverse().find((area) => containsPopulationPoint(area.ring, lat, lng))
        : undefined
      setRecord(place ? livePopulationRecord(place, lat, lng) : null)
    }
    kakao.maps.event.addListener(map, 'click', click)
    return () => kakao.maps.event.removeListener(map, 'click', click)
  }, [ready, layers.population, populationPlaces])
  const onView = useEffectEvent(() => {
    const map = instance.current
    if (!map) return
    const center = map.getCenter()
    const zoom = 20 - map.getLevel()
    saveMap({
      center: [center.getLat(), center.getLng()],
      zoom,
      resultId: result?.id,
    })
    updateRoads.current?.()
    setTick((value) => value + 1)
  })
  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | undefined
    let map: kakao.maps.Map | undefined
    let viewTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleView = () => {
      clearTimeout(viewTimer)
      viewTimer = setTimeout(onView, 150)
    }
    const container = root.current
    loadKakaoSdk(import.meta.env.VITE_KAKAO_MAP_APP_KEY!.trim())
      .then(() => {
        if (cancelled || !root.current) return
        map = new kakao.maps.Map(root.current, { center: position(37.5665, 126.978), level: 9 })
        map.setMaxLevel(matchMedia('(max-width:900px)').matches ? 10 : 9)
        map.setMinLevel(1)
        instance.current = map
        overview(map)
        kakao.maps.event.addListener(map, 'idle', scheduleView)
        observer = new ResizeObserver(() => {
          if (!map) return
          const center = map.getCenter()
          map.relayout()
          map.setCenter(center)
          scheduleView()
        })
        observer.observe(root.current)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled)
          setError('카카오 지도를 불러오지 못했어요. JavaScript 키와 등록 도메인을 확인해 주세요.')
      })
    return () => {
      cancelled = true
      clearTimeout(viewTimer)
      observer?.disconnect()
      if (map) kakao.maps.event.removeListener(map, 'idle', scheduleView)
      instance.current = null
      container?.replaceChildren()
    }
  }, [attempt])
  useEffect(() => {
    const stop = startLive()
    return stop
  }, [])
  useEffect(() => {
    if (!ready || !showRoadTraffic) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const roads = await fetchRoadTraffic(controller.signal)
        if (!controller.signal.aborted) setCityTraffic(roads)
      } catch {
        // Retain the last successful observation if a refresh fails.
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [ready, showRoadTraffic])
  useEffect(() => {
    if (!ready || !instance.current || !active.selected) return
    const place = placeById(active.selected)
    if (place) {
      instance.current.setLevel(4)
      instance.current.panTo(position(place.lat, place.lon))
    }
  }, [ready, active.selected])
  useEffect(() => {
    if (!ready || !instance.current || !live.selected) return
    const place = live.places.find((item) => item.code === live.selected)
    if (place) {
      instance.current.setLevel(5)
      instance.current.panTo(position(place.lat, place.lng))
    }
  }, [ready, live.selected, live.places])
  useEffect(() => {
    const update = (event: Event) => setOverlay((event as CustomEvent<MapOverlay>).detail)
    const focus = (event: Event) => {
      const value = (event as CustomEvent<{ lat: number; lng: number; zoom: number }>).detail
      const map = instance.current
      if (map) {
        map.setLevel(Math.max(1, 20 - value.zoom))
        map.panTo(position(value.lat, value.lng))
      }
    }
    const fit = (event: Event) => {
      const map = instance.current
      if (!map) return
      const points = (event as CustomEvent<{ points: [number, number][] }>).detail.points
      const bounds = new kakao.maps.LatLngBounds()
      points.forEach((p) => bounds.extend(position(...p)))
      map.setBounds(bounds, 60, 60, 120, 60)
    }
    const pick = (event: Event) => setFocused((event as CustomEvent<{ id: string }>).detail.id)
    window.addEventListener(MAP_OVERLAY_EVENT, update)
    window.addEventListener(MAP_FOCUS_EVENT, focus)
    window.addEventListener('sn:map-fit', fit)
    window.addEventListener(PARKING_SELECT_EVENT, pick)
    return () => {
      window.removeEventListener(MAP_OVERLAY_EVENT, update)
      window.removeEventListener(MAP_FOCUS_EVENT, focus)
      window.removeEventListener('sn:map-fit', fit)
      window.removeEventListener(PARKING_SELECT_EVENT, pick)
    }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFocused(active.parkingSelections?.[active.selected || ''] || null),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [active.parkingSelections, active.selected])
  useEffect(() => {
    const map = instance.current
    if (!ready || !map) return
    const items: Drawable[] = []
    const line = (path: [number, number][], color: string, weight = 4, zIndex = 5) => {
      const item = new kakao.maps.Polyline({
        map,
        path: path.map((p) => position(...p)),
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: 1,
        zIndex,
      })
      items.push(item)
    }
    if (live.boundary?.length) {
      const world = [
        [30, 118],
        [30, 137],
        [44, 137],
        [44, 118],
      ] as [number, number][]
      const mask = new kakao.maps.Polygon({
        map,
        path: [world, ...live.boundary].map((ring) => ring.map((p) => position(...p))),
        strokeWeight: 0,
        fillColor: '#6b7280',
        fillOpacity: 0.58,
        zIndex: 10,
      })
      items.push(mask)
    }
    if (overlay.route?.length) {
      line(overlay.route, '#294c3c', 15, 14)
      line(overlay.route, routeTrafficColor(0), 11, 15)
      for (const segment of overlay.routeSegments || [])
        if (segment.path.length > 1) line(segment.path, routeTrafficColor(segment.state), 11, 16)
    }
    return () => items.forEach((item) => item.setMap(null))
  }, [ready, live.boundary, overlay.route, overlay.routeSegments])
  useEffect(() => {
    const map = instance.current
    if (!ready || !map || !showRoadTraffic) return
    const roads = cityTraffic.map((road) => {
      let south = Infinity
      let west = Infinity
      let north = -Infinity
      let east = -Infinity
      for (const [lat, lng] of road.path) {
        south = Math.min(south, lat)
        west = Math.min(west, lng)
        north = Math.max(north, lat)
        east = Math.max(east, lng)
      }
      return {
        ...road,
        south,
        west,
        north,
        east,
        points: road.path.map(([lat, lng]) => position(lat, lng)),
        color: roadSpeedColor(road.speed),
      }
    })
    const lines = new Map<string, kakao.maps.Polyline>()
    let loadedBounds: kakao.maps.LatLngBounds | undefined
    let loadedZoom = 0
    let previousZoom: number | undefined
    let visibleRoads: typeof roads = []
    const update = () => {
      const bounds = map.getBounds()
      const sw = bounds.getSouthWest()
      const ne = bounds.getNorthEast()
      const zoom = 20 - map.getLevel()
      const strokeWeight = zoom < 12 ? 1.2 : zoom < 14 ? 1.8 : zoom < 16 ? 2.6 : 3.4
      const strokeOpacity = zoom < 13 ? 0.7 : 0.9
      // Keep nearby roads loaded so small pans don't rebuild paths.
      if (zoom > loadedZoom || !loadedBounds?.contain(sw) || !loadedBounds.contain(ne)) {
        const latPad = (ne.getLat() - sw.getLat()) * 0.25
        const lngPad = (ne.getLng() - sw.getLng()) * 0.25
        const south = sw.getLat() - latPad
        const west = sw.getLng() - lngPad
        const north = ne.getLat() + latPad
        const east = ne.getLng() + lngPad
        loadedBounds = new kakao.maps.LatLngBounds(position(south, west), position(north, east))
        loadedZoom = zoom
        const paths = new Map<string, kakao.maps.LatLng[][]>()
        visibleRoads = roads.filter(
          (road) => road.north >= south && road.south <= north && road.east >= west && road.west <= east,
        )
        for (const road of visibleRoads) {
          if (!paths.has(road.color)) paths.set(road.color, [])
          paths.get(road.color)!.push(road.points)
        }
        for (const [color, line] of lines) {
          if (paths.has(color)) continue
          line.setMap(null)
          lines.delete(color)
        }
        for (const [strokeColor, path] of paths) {
          const line = lines.get(strokeColor)
          if (line) {
            line.setPath(path)
          } else {
            lines.set(
              strokeColor,
              new kakao.maps.Polyline({
                map,
                path,
                strokeColor,
                strokeWeight,
                strokeOpacity,
                endArrow: false,
                zIndex: 7,
              }),
            )
          }
        }
      }
      if (zoom !== previousZoom) {
        lines.forEach((line) => line.setOptions({ strokeWeight, strokeOpacity }))
        previousZoom = zoom
      }
    }
    findRoad.current = (location) => {
      const projection = map.getProjection()
      const point = projection.containerPointFromCoords(location)
      const sw = projection.coordsFromContainerPoint(new kakao.maps.Point(point.x - 7, point.y + 7))
      const ne = projection.coordsFromContainerPoint(new kakao.maps.Point(point.x + 7, point.y - 7))
      const south = sw.getLat()
      const west = sw.getLng()
      const north = ne.getLat()
      const east = ne.getLng()
      let nearest: MapRoadSegment | undefined
      let distanceSquared = 49
      for (const road of visibleRoads) {
        if (road.north < south || road.south > north || road.east < west || road.west > east)
          continue
        let start = projection.containerPointFromCoords(road.points[0])
        for (const vertex of road.points.slice(1)) {
          const end = projection.containerPointFromCoords(vertex)
          const dx = end.x - start.x
          const dy = end.y - start.y
          const length = dx * dx + dy * dy
          const offset = (point.x - start.x) * dx + (point.y - start.y) * dy
          const t = length ? Math.max(0, Math.min(1, offset / length)) : 0
          const distance = (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2
          if (distance < distanceSquared) {
            nearest = road
            distanceSquared = distance
          }
          start = end
        }
      }
      return nearest
    }
    const label = document.createElement('span')
    label.className = 'map-record-tooltip'
    label.style.pointerEvents = 'none'
    const tooltip = new kakao.maps.CustomOverlay({
      position: map.getCenter(),
      content: label,
      yAnchor: 1.35,
      clickable: false,
      zIndex: 70,
    })
    const hideTooltip = () => tooltip.setMap(null)
    const hover = ({ latLng }: { latLng: kakao.maps.LatLng }) => {
      const road = findRoad.current?.(latLng)
      if (!road) return hideTooltip()
      label.textContent = road.name
      tooltip.setPosition(latLng)
      if (!tooltip.getMap()) tooltip.setMap(map)
    }
    kakao.maps.event.addListener(map, 'mousemove', hover)
    kakao.maps.event.addListener(map, 'click', hideTooltip)
    kakao.maps.event.addListener(map, 'zoom_changed', hideTooltip)
    const container = root.current
    container?.addEventListener('pointerleave', hideTooltip)
    updateRoads.current = update
    update()
    return () => {
      updateRoads.current = null
      findRoad.current = null
      hideTooltip()
      kakao.maps.event.removeListener(map, 'mousemove', hover)
      kakao.maps.event.removeListener(map, 'click', hideTooltip)
      kakao.maps.event.removeListener(map, 'zoom_changed', hideTooltip)
      container?.removeEventListener('pointerleave', hideTooltip)
      lines.forEach((line) => line.setMap(null))
    }
  }, [ready, showRoadTraffic, cityTraffic])
  useEffect(() => {
    const map = instance.current,
      container = root.current
    if (!ready || !map || !container || !layers.population) return
    const projection = map.getProjection()
    const canvas = populationHeat(
      populationPlaces,
      container.clientWidth,
      container.clientHeight,
      20 - map.getLevel(),
      (point) => projection.containerPointFromCoords(position(...point)),
    )
    const heat = new kakao.maps.CustomOverlay({
      map,
      position: map.getCenter(),
      content: canvas,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 8,
      clickable: false,
    })
    return () => heat.setMap(null)
  }, [ready, tick, layers.population, populationPlaces])
  useEffect(() => {
    if (ready && overlay.route?.length && instance.current) {
      const bounds = new kakao.maps.LatLngBounds()
      overlay.route.forEach((p) => bounds.extend(position(...p)))
      instance.current.setBounds(bounds, 70, 60, 180, 60)
    }
  }, [ready, overlay.route])
  useEffect(() => {
    const map = instance.current
    if (!ready || !map) return
    const items: Drawable[] = []
    const add = (lat: number, lng: number, content: HTMLElement, zIndex = 20, yAnchor = 0.5) => {
      const item = new kakao.maps.CustomOverlay({
        map,
        position: position(lat, lng),
        content,
        clickable: true,
        zIndex,
        yAnchor,
      })
      items.push(item)
    }
    const pin = (
      name: string,
      icon: keyof typeof markerIcons,
      click: () => void,
      selected = false,
    ) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sn-kakao-place-pin' + (selected ? ' is-selected' : '')
      button.setAttribute('aria-label', name)
      button.innerHTML = svg(icon)
      const label = document.createElement('span')
      label.className = 'sn-kakao-pin-label'
      label.textContent = name
      button.append(label)
      button.onclick = click
      return button
    }
    const departure =
      !preview && result?.conditions.departure ? DEPARTURES[result.conditions.departure] : null
    const endpoint = (kind: 'origin' | 'destination', name: string) => {
      const node = document.createElement('div')
      node.className = 'sn-route-endpoint-host'
      node.setAttribute('role', 'img')
      node.setAttribute('aria-label', (kind === 'origin' ? '출발 · ' : '도착 · ') + name)
      node.innerHTML = endpointHtml(kind)
      return node
    }
    if (departure && !overlay.origin) {
      const node = endpoint('origin', '출발지')
      add(departure.lat, departure.lon, node, 30, 1)
    }
    if (overlay.origin) {
      const origin = overlay.origin
      const node = endpoint('origin', origin.name)
      add(origin.lat, origin.lon, node, 60, 1)
    }
    const routeEnd = overlay.route?.at(-1)
    const destination =
      overlay.destination ||
      (routeEnd ? { lat: routeEnd[0], lng: routeEnd[1], name: '목적지' } : null)
    if (destination) {
      const node = endpoint('destination', destination.name)
      add(destination.lat, destination.lng, node, 55, 1)
    }
    if (overlay.route?.length && root.current) {
      const projection = map.getProjection()
      for (const mark of routeArrows(
        overlay.route,
        (point) => projection.containerPointFromCoords(position(...point)),
        root.current.clientWidth,
        root.current.clientHeight,
      )) {
        const node = document.createElement('div')
        node.className = 'sn-route-arrow-host'
        node.setAttribute('aria-hidden', 'true')
        node.innerHTML = arrowHtml(mark.angle)
        add(mark.lat, mark.lng, node, 25)
      }
    }
    if (!preview)
      for (const entry of result?.entries || []) {
        const place = placeById(entry.id)
        if (!place) continue
        const icons: Record<string, keyof typeof markerIcons> = {
          카페: 'coffee',
          식사: 'food',
          산책: 'walk',
          전시: 'art',
        }
        const node = pin(
          place.name,
          icons[place.category] || 'pin',
          () => selectPlace(place.id),
          active.selected === place.id,
        )
        node.onmouseenter = () => patchUI({ hover: place.id })
        node.onmouseleave = () => patchUI({ hover: null })
        add(place.lat, place.lon, node, 40, 1)
      }
    if (layers.parking) {
      const bounds = map.getBounds(),
        projection = map.getProjection()
      const facilities = parking.lots
      const selected = facilities.find((lot) => lot.memberIds.includes(focused || ''))
      const openChoices = (group: ParkingFacility[]) =>
        setRecord({
          kind: 'parking-cluster',
          data: group.map((lot) => ({
            location: { lat: lot.lat!, lng: lot.lng!, records: [lot] },
            record: lot,
          })),
        })
      const groups = new Map<string, ParkingFacility[]>()
      const anchors: { key: string; x: number; y: number }[] = []
      const level = map.getLevel()
      const selectedKey = 'selected'
      if (selected && selected.lat !== null && selected.lng !== null) {
        const pixel = projection.containerPointFromCoords(position(selected.lat, selected.lng))
        anchors.push({ key: selectedKey, x: pixel.x, y: pixel.y })
        groups.set(selectedKey, [selected])
      }
      for (const lot of facilities) {
        if (lot.lat === null || lot.lng === null || !bounds.contain(position(lot.lat, lot.lng)))
          continue
        if (lot === selected) continue
        const pixel = projection.containerPointFromCoords(position(lot.lat, lot.lng))
        const nearby = anchors.find(
          (anchor) =>
            Math.abs(anchor.x - pixel.x) < (level >= 5 ? 90 : 76) &&
            Math.abs(anchor.y - pixel.y) < (anchor.key === selectedKey ? 60 : 46),
        )
        const key = nearby?.key || `${lot.lat},${lot.lng}`
        if (!nearby) anchors.push({ key, x: pixel.x, y: pixel.y })
        const group = groups.get(key) || []
        group.push(lot)
        groups.set(key, group)
      }
      for (const [key, group] of groups) {
        if (key === selectedKey) continue
        const lat = group[0].lat!,
          lng = group[0].lng!
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'sn-kakao-parking'
        button.innerHTML = svg('car')
        if (group.length > 1) {
          const count = document.createElement('b')
          count.textContent = String(group.length)
          button.append(count)
        }
        button.setAttribute(
          'aria-label',
          group.length > 1
            ? '주차장 ' + group.length + '곳'
            : group[0].name + ' · ' + (group[0].address || '주소 미확인'),
        )
        button.onclick = () => {
          if (group.length > 1) {
            if (level < 5 || group.every((lot) => lot.lat === lat && lot.lng === lng)) {
              openChoices(group)
              return
            }
            map.setLevel(Math.max(1, map.getLevel() - 2))
            map.panTo(position(lat, lng))
          } else {
            const lot = group[0]
            window.dispatchEvent(new CustomEvent(PARKING_SELECT_EVENT, { detail: { id: lot.id } }))
            setRecord({ kind: 'parking', data: { lat: lot.lat!, lng: lot.lng!, records: [lot] } })
          }
        }
        add(lat, lng, button)
      }
      const lot = selected
      if (lot?.lat !== null && lot?.lat !== undefined && lot.lng !== null) {
        const choices = groups.get(selectedKey) ?? [lot]
        const node = pin(
          lot.name,
          'car',
          () => {
            if (choices.length > 1) openChoices(choices)
            else setRecord({ kind: 'parking', data: { lat: lot.lat!, lng: lot.lng!, records: [lot] } })
          },
          true,
        )
        node.classList.add('sn-kakao-selected-parking')
        node.setAttribute('aria-label', `선택한 주차장 ${lot.name}${choices.length > 1 ? `, 가까운 위치 ${choices.length}곳` : ''}`)
        if (choices.length > 1) {
          const count = document.createElement('b')
          count.className = 'sn-kakao-parking-count'
          count.textContent = String(choices.length)
          node.append(count)
        }
        const address = document.createElement('span')
        address.className = 'sn-kakao-address'
        address.textContent = lot.address || '주소 미확인'
        node.querySelector('.sn-kakao-pin-label')?.append(address)
        add(lot.lat, lot.lng, node, 60, 1)
      }
    }
    for (const food of overlay.food || [])
      add(
        food.lat,
        food.lng,
        pin(food.name, 'food', () =>
          window.dispatchEvent(new CustomEvent('sn:food-select', { detail: { id: food.id } })),
        ),
        35,
        1,
      )
    return () => items.forEach((item) => item.setMap(null))
  }, [
    ready,
    tick,
    result,
    preview,
    active.selected,
    layers.parking,
    parking.lots,
    focused,
    overlay.food,
    overlay.destination,
    overlay.origin,
    overlay.route,
    patchUI,
    selectPlace,
  ])
  return (
    <>
      <div
        id="real-map"
        className="real-map sn-kakao-map"
        ref={root}
        role="region"
        aria-label="카카오 서울 지도"
      />
      <div className="sn-map-controls" role="group" aria-label="지도 조작">
        <button
          aria-label="지도 확대"
          onClick={() => instance.current?.setLevel(instance.current.getLevel() - 1)}
        >
          <Icon name="plus" />
        </button>
        <button
          aria-label="지도 축소"
          onClick={() => instance.current?.setLevel(instance.current.getLevel() + 1)}
        >
          <Icon name="minus" />
        </button>
        <button
          aria-label="내 위치 보기"
          onClick={() =>
            navigator.geolocation?.getCurrentPosition(
              (p) => {
                instance.current?.setLevel(4)
                instance.current?.panTo(position(p.coords.latitude, p.coords.longitude))
              },
              () => notify('현재 위치를 확인하지 못했어요.'),
            )
          }
        >
          <Icon name="locate" />
        </button>
        <button
          aria-label="서울 전체 보기"
          onClick={() => instance.current && overview(instance.current)}
        >
          <Icon name="fit" />
        </button>
      </div>
      {error && (
        <div className="sn-kakao-error" role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setError('')
              setReady(false)
              setAttempt((value) => value + 1)
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      {!ready && !error && (
        <div className="sn-kakao-loading" role="status">
          카카오 지도를 불러오는 중이에요…
        </div>
      )}
      {record &&
        (record.kind !== 'population' || layers.population) &&
        (record.kind !== 'road' || showRoadTraffic) &&
        createPortal(
          <div
            className="sn-kakao-record"
            role="dialog"
            aria-label={
              record.kind === 'road'
                ? '도로 교통 정보'
                : record.kind === 'population'
                  ? '관측 인구 정보'
                  : '선택한 주차장 정보'
            }
          >
            <button
              className="sn-kakao-record-close"
              aria-label="지도 정보 닫기"
              onClick={() => setRecord(null)}
            >
              ×
            </button>
            <MapRecord
              record={record}
              parkingError={parking.error}
              onSelectParking={(next) => {
                if (next.kind === 'parking' && next.data.records[0]) {
                  window.dispatchEvent(new CustomEvent(PARKING_SELECT_EVENT, {
                    detail: { id: next.data.records[0].id },
                  }))
                }
                setRecord(next)
              }}
            />
          </div>,
          popupHost,
        )}
    </>
  )
}
