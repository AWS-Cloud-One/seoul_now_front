import KakaoGeoMap from './KakaoGeoMap'
import {
  arrowHtml,
  endpointHtml,
  routeArrows,
  routeLineWidths,
  ROUTE_COLOR,
} from '../../lib/map/routeSymbols'
import { SEOUL_VIEW_BOUNDS } from '../../data/seoulBoundary'
import markerIcons from '../../data/icons.json'
import { useRoadTraffic } from '../../hooks/useRoadTraffic'
import { SEOUL_QUERY, type MapQuery } from '../../api/queries'
import { useParkingData } from '../../hooks/useParkingData'
import { resolveParkingPopup } from '../../lib/parking/popup'
import { isolatePopupScroll } from '../../lib/map/popupScroll'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from '../../vendor/leaflet.js'
import { createMapLayers } from '../../lib/map/mapLayers.js'
import type { MapRecord as RecordData } from '../../lib/map/mapLayers'
import type { Result } from '../../types/trip'
import { placeById } from '../../lib/domain.js'
import { DEPARTURES } from '../../lib/departures'
import { useAppState } from '../../state/useAppState'
import MapRecord from './MapRecord'
import Icon from '../common/Icon'
import {
  takePendingFocus,
  PARKING_SELECT_EVENT,
  getMapOverlay,
  useMapOverlay,
  distanceMeters,
  type MapOverlay,
} from '../../hooks/useRoute'
import { createLiveLayers } from '../../lib/map/liveLayers'
import { livePopulationRecord } from '../../lib/map/populationLabels'
import { startLive, useLive } from '../../state/live/store'
/** On phones the bottom sheet covers the map, so keep markers above it. */
function bottomPadding() {
  const sheet = document.querySelector<HTMLElement>('.sn-panel')
  if (matchMedia('(max-width:900px)').matches && sheet) return sheet.offsetHeight + 24
  return 220
}
function fitSeoul(instance: ReturnType<typeof L.map>) {
  instance.fitBounds(SEOUL_VIEW_BOUNDS, {
    paddingTopLeft: [28, 36],
    paddingBottomRight: [
      28,
      matchMedia('(max-width:900px)').matches
        ? Math.min(bottomPadding(), instance.getSize().y * 0.45)
        : 36,
    ],
    maxZoom: 11,
    animate: false,
  })
}

const BOUNDS = [
  [37.4, 126.72],
  [37.77, 127.25],
]
const inside = (point: { lat: number; lon: number }) =>
  point.lat >= 37.4 && point.lat <= 37.77 && point.lon >= 126.72 && point.lon <= 127.25
function LeafletGeoMap({
  preview = false,
  parkingHintRequested = false,
}: {
  preview?: boolean
  parkingHintRequested?: boolean
}) {
  const { active, result, layers, ui, patchUI, selectPlace, saveMap, notify } = useAppState()
  const parkingData = useParkingData('map')
  const overlay = useMapOverlay()
  const parkingTarget = overlay.recommendation ?? overlay.destination
  const live = useLive()
  const liveLayers = useRef<ReturnType<typeof createLiveLayers> | null>(null)
  const confirmedParking = active.parkingSelections?.[active.selected || ''] || null
  const parkingFocus = useRef<string | null>(confirmedParking)
  const parkingController = useRef<ReturnType<typeof createMapLayers> | null>(null)
  const currentParking = useEffectEvent(() =>
    parkingTarget
      ? parkingData.lots.filter(
          (lot) =>
            lot.lat !== null &&
            lot.lng !== null &&
            distanceMeters([lot.lat, lot.lng], [parkingTarget.lat, parkingTarget.lng]) <= 500,
        )
      : parkingData.lots,
  )
  const root = useRef<HTMLDivElement>(null)
  const map = useRef<ReturnType<typeof L.map> | null>(null)
  const markers = useRef<Map<string, ReturnType<typeof L.marker>>>(new Map())
  const [status, setStatus] = useState('서울 지도를 불러오는 중이에요…')
  const [zoom, setZoom] = useState(12)
  const routeLines = useRef<ReturnType<typeof L.polyline>[]>([])
  useEffect(() => {
    const weight = routeLineWidths(zoom).line
    routeLines.current.forEach((line) => line.setStyle({ weight }))
  }, [zoom])
  const [viewport, setViewport] = useState<MapQuery>(SEOUL_QUERY)
  const { roads: cityTraffic, error: roadError } = useRoadTraffic(viewport, layers.roads)
  const retryTiles = useRef<() => void>(() => {})
  const [popup, setPopup] = useState<{ record: RecordData; host: HTMLDivElement } | null>(null)
  const [parkingHint, setParkingHint] = useState(false)
  const zoomToParking = useRef<() => void>(() => {})
  const resultSnapshot = JSON.stringify(preview ? null : result)
  const mapResult = useMemo<Result | null>(() => JSON.parse(resultSnapshot), [resultSnapshot])
  const departure = preview ? null : (result?.conditions || active.conditions).departure
  const selectedLatitude = placeById(active.selected, result)?.lat
  const selectedLongitude = placeById(active.selected, result)?.lon
  const onView = useEffectEvent(() => {
    const instance = map.current
    if (instance) {
      const center = instance.getCenter()
      const bounds = instance.getBounds()
      const query: MapQuery = {
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map(
          (v: number) => Number(v.toFixed(5)),
        ) as MapQuery['bbox'],
        level: Math.max(1, 20 - instance.getZoom()),
      }
      setViewport((old) => (JSON.stringify(old) === JSON.stringify(query) ? old : query))
      parkingData.setViewport(query)
      saveMap({
        center: [center.lat, center.lng],
        zoom: instance.getZoom(),
        resultId: result?.id,
      })
      setZoom(instance.getZoom())
    }
  })
  const onOpenDetail = useEffectEvent((id: string) => selectPlace(id))
  const onHover = useEffectEvent((id: string | null) => patchUI({ hover: id }))
  useEffect(() => {
    const instance = map.current
    const place =
      selectedLatitude === undefined || selectedLongitude === undefined
        ? null
        : { lat: selectedLatitude, lon: selectedLongitude }
    if (!instance || !place) return
    if (!matchMedia('(max-width:900px)').matches) {
      // Desktop: bring the chosen destination into view without zooming out.
      instance.setView([place.lat, place.lon], Math.max(instance.getZoom(), 15), { animate: false })
      // The place card floats bottom-right; if it would cover the marker, slide the map up/left.
      const card = document.querySelector('.sn-summary-card')
      if (card) {
        const mapBox = instance.getContainer().getBoundingClientRect()
        const box = card.getBoundingClientRect()
        const point = instance.latLngToContainerPoint([place.lat, place.lon])
        const pad = 36
        const x = point.x + mapBox.left
        const y = point.y + mapBox.top
        if (
          x > box.left - pad &&
          x < box.right + pad &&
          y > box.top - pad &&
          y < box.bottom + pad
        ) {
          instance.panBy([0, y - (box.top - pad)], { animate: false })
        }
      }
      return
    }
    const sheet = document.querySelector<HTMLElement>('.sn-panel')
    const target = instance.project([place.lat, place.lon], instance.getZoom())
    // Shift the view so the selected marker sits in the visible area above the sheet.
    const shifted = instance.unproject(
      [target.x, target.y + (sheet?.offsetHeight ?? 300) / 2],
      instance.getZoom(),
    )
    instance.panTo(shifted, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
  }, [active.selected, selectedLatitude, selectedLongitude])
  useEffect(() => {
    let group: ReturnType<typeof L.layerGroup> | null = null
    const draw = (overlay: MapOverlay) => {
      const instance = map.current
      if (!instance) return
      group?.remove()
      group = null
      routeLines.current = []
      if (
        !overlay.route?.length &&
        !overlay.food?.length &&
        !overlay.recommendation &&
        !overlay.lookup
      )
        return
      group = L.layerGroup().addTo(instance)
      if (overlay.lookup) {
        const point = overlay.lookup
        const label = document.createElement('span')
        label.textContent = point.name
        L.marker([point.lat, point.lng], {
          icon: L.divIcon({
            className: 'sn-recommendation-leaflet',
            html: label.outerHTML,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
          }),
          title: `${point.kind === 'parking' ? '주차장' : '장소'} 위치 ${point.name}`,
          zIndexOffset: 2100,
        })
          .addTo(group)
          .on('click', () => window.dispatchEvent(new Event('sn:open-chat')))
      }
      if (overlay.recommendation) {
        const place = overlay.recommendation
        const label = document.createElement('span')
        label.textContent = `${place.rank ? `${place.rank} · ` : ''}${place.name}`
        L.marker([place.lat, place.lng], {
          icon: L.divIcon({
            className: 'sn-recommendation-leaflet',
            html: label.outerHTML,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
          }),
          title: `선택한 장소 ${place.name}`,
          zIndexOffset: 2000,
        })
          .addTo(group)
          .on('click', () => {
            if (place.onOpenDetail) place.onOpenDetail()
            else window.dispatchEvent(new Event('sn:open-recommendation'))
          })
      }
      if (overlay.route?.length) {
        if (!instance.getPane('sn-route')) instance.createPane('sn-route').style.zIndex = '450'
        for (const path of overlay.routeSegments?.length
          ? overlay.routeSegments.map((segment) => segment.path)
          : [overlay.route]) {
          if (path.length < 2) continue
          routeLines.current.push(
            L.polyline(path, {
              pane: 'sn-route',
              color: ROUTE_COLOR,
              weight: routeLineWidths(instance.getZoom()).line,
              opacity: 1,
              interactive: false,
            }).addTo(group),
          )
        }
        if (overlay.origin) {
          const origin = overlay.origin
          L.marker([origin.lat, origin.lon], {
            icon: L.divIcon({
              className: 'sn-route-endpoint-host',
              html: endpointHtml('origin'),
              iconSize: [40, 50],
              iconAnchor: [20, 50],
            }),
            title: '출발 · ' + origin.name,
            zIndexOffset: 1800,
          }).addTo(group)
        }
        const destination = overlay.destination
        const end = destination
          ? ([destination.lat, destination.lng] as [number, number])
          : overlay.route.at(-1)!
        L.marker(end, {
          icon: L.divIcon({
            className: 'sn-route-endpoint-host',
            html: endpointHtml('destination'),
            iconSize: [40, 50],
            iconAnchor: [20, 50],
          }),
          title: '도착 · ' + (destination?.name || '목적지'),
          zIndexOffset: 1800,
        }).addTo(group)
        instance.fitBounds(overlay.route, {
          paddingTopLeft: [64, 84],
          paddingBottomRight: [64, bottomPadding()],
          animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
        })
      }
      for (const food of overlay.food || []) {
        const marker = L.marker([food.lat, food.lng], {
          icon: L.divIcon({
            className: 'sn-food-marker',
            html: '<span></span>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
          title: food.name,
          keyboard: true,
        }).addTo(group)
        marker.bindTooltip(food.name, {
          direction: 'top',
          offset: [0, -12],
          className: 'destination-label',
        })
        marker.on('click', () =>
          window.dispatchEvent(new CustomEvent('sn:food-select', { detail: { id: food.id } })),
        )
      }
    }
    const listener = (event: Event) => draw((event as CustomEvent<MapOverlay>).detail)
    window.addEventListener('sn:map-overlay', listener)
    draw(getMapOverlay())
    const traffic = (event: Event) => {
      const overlay = (event as CustomEvent<MapOverlay>).detail
      liveLayers.current?.setTraffic(overlay.traffic)
    }
    window.addEventListener('sn:map-overlay', traffic)
    return () => {
      window.removeEventListener('sn:map-overlay', listener)
      window.removeEventListener('sn:map-overlay', traffic)
      group?.remove()
      routeLines.current = []
    }
  }, [])
  const initialView = useRef(preview ? undefined : active.workspaceView?.map)
  const firstLayout = useRef(true)
  const onRecord = useEffectEvent(
    (record: RecordData, latlng: [number, number] | { lat: number; lng: number }) => {
      if (!map.current) return
      if (record.kind === 'parking') {
        const id = (record.data as { records?: { id: string }[] }).records?.[0]?.id
        if (id) window.dispatchEvent(new CustomEvent('sn:parking-select', { detail: { id } }))
      }
      const host = document.createElement('div')
      const releaseScroll = isolatePopupScroll(host)
      const sdkPopup = L.popup({
        className: 'map-record-popup',
        minWidth: 210,
        maxWidth: 285,
        maxHeight: 350,
        autoPanPaddingTopLeft: [20, 90],
        autoPanPaddingBottomRight: [70, 200],
      })
        .setLatLng(latlng)
        .setContent(host)
      sdkPopup.on('remove', () => {
        releaseScroll()
        setPopup((previous) => (previous?.host === host ? null : previous))
      })
      sdkPopup.openOn(map.current)
      setPopup({ record, host })
    },
  )
  useEffect(() => {
    if (!root.current) return
    const instance = L.map(root.current, {
      zoomControl: false,
      minZoom: matchMedia('(max-width:900px)').matches ? 10 : 11,
      maxZoom: 19,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 1,
      fadeAnimation: false,
      zoomAnimation: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    map.current = instance
    const view = initialView.current
    instance.setView(view?.center || [37.5665, 126.978], view?.zoom || 12, { animate: false })
    instance.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>',
    )
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      noWrap: true,
      keepBuffer: 3,
      updateWhenIdle: false,
    })
    let failed = false
    tiles.on('loading', () => {
      failed = false
    })
    tiles.on('tileerror', () => {
      failed = true
      setStatus('일부 지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')
    })
    tiles.on('load', () =>
      setStatus(failed ? '일부 지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.' : ''),
    )
    retryTiles.current = () => {
      setStatus('서울 지도를 다시 불러오는 중이에요…')
      tiles.redraw()
    }
    tiles.addTo(instance)
    liveLayers.current = createLiveLayers(instance, {
      onSelect: (place, point) => onRecord(livePopulationRecord(place), point),
    })
    const stopLive = startLive()
    instance.on('moveend zoomend', onView)
    onView()
    const resize = () => {
      if (root.current?.clientWidth && root.current.clientHeight) {
        instance.setMinZoom(matchMedia('(max-width:900px)').matches ? 10 : 11)
        instance.invalidateSize({ pan: false })
        root.current
          .closest<HTMLElement>('.map-panel')
          ?.style.setProperty(
            '--map-menu-height',
            `${Math.max(150, root.current.clientHeight - 140)}px`,
          )
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(root.current)
    resize()
    const pending = takePendingFocus()
    if (pending) instance.setView([pending.lat, pending.lng], pending.zoom)
    else if (!view?.center) fitSeoul(instance)
    return () => {
      stopLive()
      liveLayers.current?.destroy()
      liveLayers.current = null
      observer.disconnect()
      instance.off()
      instance.remove()
      retryTiles.current = () => {}
      map.current = null
    }
  }, [])
  useEffect(() => {
    const focus = (event: Event) => {
      const { lat, lng, zoom } = (event as CustomEvent<{ lat: number; lng: number; zoom: number }>)
        .detail
      map.current?.setView([lat, lng], zoom, {
        animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
    }
    const fit = (event: Event) => {
      const { points } = (event as CustomEvent<{ points: [number, number][] }>).detail
      if (points.length < 2) return
      map.current?.flyToBounds(points, {
        paddingTopLeft: [40, 80],
        paddingBottomRight: [60, 150],
        maxZoom: 16,
        animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
    }
    window.addEventListener('sn:map-focus', focus)
    window.addEventListener('sn:map-fit', fit)
    return () => {
      window.removeEventListener('sn:map-focus', focus)
      window.removeEventListener('sn:map-fit', fit)
    }
  }, [])
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const originCoordinates = mapResult?.conditions.origin?.coordinates
    const origin = originCoordinates
      ? { lat: originCoordinates.latitude, lon: originCoordinates.longitude }
      : departure
        ? DEPARTURES[departure]
        : null
    const group = L.layerGroup().addTo(instance)
    const currentMarkers = markers.current
    currentMarkers.clear()
    const coordinates: number[][] = []
    if (origin && inside(origin)) {
      coordinates.push([origin.lat, origin.lon])
      const dot = document.createElement('span')
      dot.setAttribute('aria-hidden', 'true')
      const originMarker = L.marker([origin.lat, origin.lon], {
        icon: L.divIcon({
          className: 'demo-origin-marker',
          html: dot,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 1600,
        title: `출발지 · ${departure}`,
      }).addTo(group)
      originMarker.bindTooltip('출발지', {
        permanent: true,
        direction: 'left',
        offset: [-14, 0],
        className: 'demo-origin-label',
      })
      originMarker.on('click', () =>
        onRecord({ kind: 'origin', data: { name: departure! } }, [origin.lat, origin.lon]),
      )
    }
    for (const entry of mapResult?.entries || []) {
      const place = placeById(entry.id, mapResult)
      if (!place) continue
      coordinates.push([place.lat, place.lon])
      const number = document.createElement('span')
      number.className = 'destination-symbol'
      const categoryIcons: Record<string, keyof typeof markerIcons> = {
        카페: 'coffee',
        식사: 'food',
        산책: 'walk',
        전시: 'art',
      }
      const symbol = markerIcons[categoryIcons[place.category] || 'pin']
      number.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        symbol +
        '</svg>'
      const marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: 'destination-marker',
          html: number,
          iconSize: [40, 52],
          iconAnchor: [20, 52],
        }),
        title: `${place.name} · 가상 예시`,
        zIndexOffset: 1000,
        keyboard: true,
        autoPanOnFocus: false,
      }).addTo(group)
      const label = document.createElement('span')
      label.textContent = place.name
      marker.bindTooltip(label, {
        permanent: true,
        direction: 'top',
        offset: [0, -54],
        className: 'destination-label',
      })
      const element: HTMLElement | undefined = marker.getElement()
      element?.setAttribute('aria-label', `${place.name} 지도 마커`)
      element?.setAttribute('data-map-place', place.id)
      marker.on('click', () => onOpenDetail(place.id))
      marker.on('mouseover', () => onHover(place.id))
      marker.on('mouseout', () => onHover(null))
      element?.addEventListener('focus', () => onHover(place.id))
      element?.addEventListener('blur', () => onHover(null))
      currentMarkers.set(place.id, marker)
    }
    const restored =
      firstLayout.current &&
      initialView.current?.center &&
      (!initialView.current.resultId || initialView.current.resultId === mapResult?.id)
    firstLayout.current = false
    if (coordinates.length && !restored)
      instance.fitBounds(coordinates, {
        paddingTopLeft: [64, 84],
        paddingBottomRight: [64, bottomPadding()],
        maxZoom: 12,
        animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
    return () => {
      instance.removeLayer(group)
      currentMarkers.clear()
    }
  }, [mapResult, departure])
  useEffect(() => {
    liveLayers.current?.update(live, layers.population)
  }, [live, layers.population])
  useEffect(() => {
    if (live.selected) liveLayers.current?.focus(live.selected)
  }, [live.selected])
  const roads = layers.roads,
    parking = layers.parking,
    population = layers.population
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    let controller: ReturnType<typeof createMapLayers> | undefined
    let cancelled = false
    void Promise.resolve({ roads: cityTraffic, population: { features: [] }, parking: [] })
      .then((data) => {
        if (cancelled) return
        controller = createMapLayers(instance, {
          data,
          overview: preview,
          parkingRecords: currentParking(),
          layers: { roads, parking, population },
          result: mapResult,
          selected: null,
          onRecord,
          onParkingHint: (visible, zoom) => {
            zoomToParking.current = zoom
            queueMicrotask(() => {
              if (!cancelled) setParkingHint(visible)
            })
          },
        })
      })
      .then(() => {
        if (!cancelled && controller) {
          parkingController.current = controller
          controller.highlightParking(parkingFocus.current)
        }
      })
      .catch(() => {
        if (!cancelled)
          setStatus('도로·주차·인구 자료를 불러오지 못했어요. 추천과 대화는 계속 사용할 수 있어요.')
      })
    return () => {
      cancelled = true
      instance.closePopup()
      parkingController.current = null
      controller?.destroy()
    }
  }, [mapResult, roads, parking, population, preview, cityTraffic])
  useEffect(() => {
    for (const [id, marker] of markers.current) {
      const element: HTMLElement | undefined = marker.getElement()
      element?.classList.toggle('selected', id === active.selected)
      element?.classList.toggle('excluded', active.excluded.includes(id))
      element?.classList.toggle('is-place-preview', id === ui.hover)
      element?.setAttribute('aria-pressed', String(id === active.selected))
      marker.setZIndexOffset(id === active.selected ? 1000 : id === ui.hover ? 900 : 0)
      marker
        .getTooltip()
        ?.getElement()
        ?.classList.toggle('selected', id === active.selected)
    }
  }, [active.selected, active.excluded, ui.hover, mapResult])
  useEffect(() => {
    parkingController.current?.updateParking(currentParking())
  }, [parkingData.lots, parkingTarget])
  useEffect(() => {
    parkingFocus.current = confirmedParking
    parkingController.current?.highlightParking(confirmedParking)
  }, [confirmedParking, active.selected, active.trip])
  useEffect(() => {
    const highlight = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail.id
      parkingFocus.current = id
      parkingController.current?.highlightParking(id)
    }
    window.addEventListener(PARKING_SELECT_EVENT, highlight)
    return () => window.removeEventListener(PARKING_SELECT_EVENT, highlight)
  }, [])
  const [locating, setLocating] = useState(false)
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    if (!instance.getPane('sn-route-arrows'))
      instance.createPane('sn-route-arrows').style.zIndex = '470'
    const arrows = L.layerGroup().addTo(instance)
    const update = () => {
      arrows.clearLayers()
      const path = getMapOverlay().route
      if (!path?.length || (getMapOverlay().routeSegments?.length || 0) > 1) return
      const size = instance.getSize()
      const arrowSize = routeLineWidths(instance.getZoom()).arrow
      for (const mark of routeArrows(
        path,
        (point) => instance.latLngToContainerPoint(point),
        size.x,
        size.y,
      )) {
        L.marker([mark.lat, mark.lng], {
          pane: 'sn-route-arrows',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'sn-route-arrow-host',
            html: arrowHtml(mark.angle, arrowSize),
            iconSize: [arrowSize, arrowSize],
            iconAnchor: [arrowSize / 2, arrowSize / 2],
          }),
        }).addTo(arrows)
      }
    }
    instance.on('moveend zoomend resize', update)
    window.addEventListener('sn:map-overlay', update)
    update()
    return () => {
      instance.off('moveend zoomend resize', update)
      window.removeEventListener('sn:map-overlay', update)
      arrows.remove()
    }
  }, [])
  const myLocation = useRef<ReturnType<typeof L.layerGroup> | null>(null)
  function locateMe() {
    const instance = map.current
    if (!instance) return
    if (!('geolocation' in navigator)) {
      notify('이 브라우저는 위치 조회를 지원하지 않아요.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false)
        if (!map.current) return
        const point = { lat: coords.latitude, lon: coords.longitude }
        if (!inside(point)) {
          notify('현재 위치가 서울·인접 지역 지도 범위 밖이에요.')
          return
        }
        myLocation.current?.remove()
        const group = L.layerGroup().addTo(instance)
        L.circle([point.lat, point.lon], {
          radius: Math.max(coords.accuracy, 15),
          color: '#2563eb',
          weight: 1,
          fillColor: '#2563eb',
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(group)
        L.marker([point.lat, point.lon], {
          icon: L.divIcon({
            className: 'sn-my-location',
            html: '<span></span>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
          title: '내 위치',
          keyboard: false,
        }).addTo(group)
        myLocation.current = group
        instance.setView([point.lat, point.lon], Math.max(instance.getZoom(), 15))
      },
      (error) => {
        setLocating(false)
        notify(
          error.code === error.PERMISSION_DENIED
            ? '위치 권한이 거부됐어요. 브라우저 설정에서 허용한 뒤 다시 시도해 주세요.'
            : error.code === error.TIMEOUT
              ? '위치 확인 시간이 초과됐어요. 다시 시도해 주세요.'
              : '현재 위치를 확인하지 못했어요.',
        )
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  }
  function recenter() {
    if (map.current) fitSeoul(map.current)
  }

  return (
    <>
      <div
        id="real-map"
        className="real-map"
        ref={root}
        role="region"
        aria-label="서울 지도. 방향키로 이동, 더하기와 빼기로 확대 축소"
      />
      <div className="sn-map-controls" role="group" aria-label="지도 조작">
        <button
          type="button"
          aria-label="지도 확대"
          title="확대"
          disabled={zoom >= 19}
          onClick={() => map.current?.zoomIn()}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          aria-label="지도 축소"
          title="축소"
          disabled={zoom <= 11}
          onClick={() => map.current?.zoomOut()}
        >
          <Icon name="minus" />
        </button>
        <button
          type="button"
          aria-label="내 위치 보기"
          title="내 위치"
          aria-busy={locating}
          disabled={locating}
          onClick={locateMe}
        >
          <Icon name="locate" />
        </button>
        <button type="button" aria-label="서울 전체 보기" title="서울 전체 보기" onClick={recenter}>
          <Icon name="fit" />
        </button>
      </div>
      {roadError && (
        <p role="status" className="sn-banner">
          {roadError}
        </p>
      )}
      {parkingHint && (!preview || parkingHintRequested) && (
        <button className="map-parking-zoom-hint" onClick={() => zoomToParking.current()}>
          <Icon name="parking" /> {preview ? '확대해서 주차장 보기' : '추천 주변 주차장 보기'}
        </button>
      )}
      {status && (
        <div className="map-load-status" role="status">
          <span>{status}</span>
          <button onClick={() => retryTiles.current()}>다시 시도</button>
        </div>
      )}
      {popup &&
        createPortal(
          <MapRecord
            record={resolveParkingPopup(popup.record, parkingData.lots)}
            parkingError={parkingData.error}
            onSelectParking={(record) => setPopup({ ...popup, record })}
          />,
          popup.host,
        )}
    </>
  )
}

export default function GeoMap(props: { preview?: boolean; parkingHintRequested?: boolean }) {
  return import.meta.env.VITE_KAKAO_MAP_APP_KEY?.trim() ? (
    <KakaoGeoMap {...props} />
  ) : (
    <LeafletGeoMap {...props} />
  )
}
