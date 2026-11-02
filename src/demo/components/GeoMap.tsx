import { loadSeoulMapData } from '../data/seoulMapData'
import { useParkingData } from '../parking/useParkingData'
import { resolveParkingPopup } from '../parking/popup'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from '../vendor/leaflet.js'
import { createMapLayers } from '../mapLayers.js'
import type { MapRecord as RecordData } from '../mapLayers'
import type { Result } from '../types'
import { DEPARTURES, placeById } from '../domain.js'
import { useDemo } from '../useDemo'
import MapRecord from './MapRecord'
import Icon from './Icon'
const BOUNDS = [
  [37.4, 126.72],
  [37.77, 127.25],
]
const inside = (point: { lat: number; lon: number }) =>
  point.lat >= 37.4 && point.lat <= 37.77 && point.lon >= 126.72 && point.lon <= 127.25
export default function GeoMap({
  preview = false,
  parkingHintRequested = false,
}: {
  preview?: boolean
  parkingHintRequested?: boolean
}) {
  const { active, result, layers, ui, patchUI, openDetail, saveMap, notify } = useDemo()
  const parkingData = useParkingData('map')
  const parkingController = useRef<ReturnType<typeof createMapLayers> | null>(null)
  const currentParking = useEffectEvent(() => parkingData.lots)
  const root = useRef<HTMLDivElement>(null)
  const map = useRef<ReturnType<typeof L.map> | null>(null)
  const markers = useRef<Map<string, ReturnType<typeof L.marker>>>(new Map())
  const [status, setStatus] = useState('서울 지도를 불러오는 중이에요…')
  const [zoom, setZoom] = useState(12)
  const [popup, setPopup] = useState<{ record: RecordData; host: HTMLDivElement } | null>(null)
  const [parkingHint, setParkingHint] = useState(false)
  const zoomToParking = useRef<() => void>(() => {})
  const resultSnapshot = JSON.stringify(preview ? null : result)
  const mapResult = useMemo<Result | null>(() => JSON.parse(resultSnapshot), [resultSnapshot])
  const departure = preview ? null : (result?.conditions || active.conditions).departure
  const onView = useEffectEvent(() => {
    const instance = map.current
    if (instance) {
      const center = instance.getCenter()
      if (!preview)
        saveMap({
          center: [center.lat, center.lng],
          zoom: instance.getZoom(),
          resultId: result?.id,
        })
      setZoom(instance.getZoom())
    }
  })
  const onOpenDetail = useEffectEvent((id: string) => openDetail(id))
  const onHover = useEffectEvent((id: string | null) => patchUI({ hover: id }))
  const initialView = useRef(preview ? undefined : active.workspaceView?.map)
  const firstLayout = useRef(true)
  const onRecord = useEffectEvent(
    (record: RecordData, latlng: [number, number] | { lat: number; lng: number }) => {
      if (!map.current) return
      const host = document.createElement('div')
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
      sdkPopup.on('remove', () =>
        setPopup((previous) => (previous?.host === host ? null : previous)),
      )
      sdkPopup.openOn(map.current)
      setPopup({ record, host })
    },
  )
  useEffect(() => {
    if (!root.current) return
    const instance = L.map(root.current, {
      zoomControl: false,
      minZoom: 11,
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
      bounds: BOUNDS,
      keepBuffer: 0,
      updateWhenIdle: true,
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
    tiles.addTo(instance)
    instance.on('moveend zoomend', onView)
    const resize = () => {
      if (root.current?.clientWidth && root.current.clientHeight) {
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
    return () => {
      observer.disconnect()
      instance.off()
      instance.remove()
      map.current = null
    }
  }, [])
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const origin = departure ? DEPARTURES[departure] : null
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
        title: `내 위치 · ${departure}`,
      }).addTo(group)
      originMarker.bindTooltip('내 위치', {
        permanent: true,
        direction: 'left',
        offset: [-14, 0],
        className: 'demo-origin-label',
      })
      originMarker.on('click', () =>
        onRecord({ kind: 'origin', data: { name: departure! } }, [origin.lat, origin.lon]),
      )
    }
    for (const [index, entry] of (mapResult?.entries || []).entries()) {
      const place = placeById(entry.id)
      if (!place) continue
      coordinates.push([place.lat, place.lon])
      const number = document.createElement('span')
      number.textContent = String(index + 1)
      const marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: 'destination-marker',
          html: number,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
        title: `${place.name} · 가상 예시`,
        keyboard: true,
        autoPanOnFocus: false,
      }).addTo(group)
      const label = document.createElement('span')
      label.textContent = place.name
      const nearOrigin =
        origin &&
        inside(origin) &&
        instance.distance([place.lat, place.lon], [origin.lat, origin.lon]) < 450
      marker.bindTooltip(label, {
        permanent: true,
        direction: nearOrigin ? 'top' : 'bottom',
        offset: [0, nearOrigin ? -18 : 18],
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
        paddingBottomRight: [64, 220],
        maxZoom: 14,
        animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
    return () => {
      instance.removeLayer(group)
      currentMarkers.clear()
    }
  }, [mapResult, departure])
  const roads = layers.roads,
    parking = layers.parking,
    population = layers.population
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    let controller: ReturnType<typeof createMapLayers> | undefined
    let cancelled = false
    void loadSeoulMapData()
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
        if (!cancelled && controller) parkingController.current = controller
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
  }, [mapResult, roads, parking, population, preview])
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
    parkingController.current?.updateParking(parkingData.lots)
  }, [parkingData.lots])
  function recenter() {
    const instance = map.current
    if (!instance) return
    const coordinates = (mapResult?.entries || [])
      .map((e) => placeById(e.id))
      .filter((p) => !!p)
      .map((p) => [p.lat, p.lon])
    const origin = departure ? DEPARTURES[departure] : null
    if (origin && inside(origin)) coordinates.push([origin.lat, origin.lon])
    if (coordinates.length)
      instance.fitBounds(coordinates, {
        paddingTopLeft: [64, 84],
        paddingBottomRight: [64, 220],
        maxZoom: 14,
      })
    else instance.setView([37.5665, 126.978], 12)
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
      <div className="map-controls">
        <button aria-label="지도 확대" disabled={zoom >= 19} onClick={() => map.current?.zoomIn()}>
          <Icon name="plus" />
        </button>
        <button aria-label="지도 축소" disabled={zoom <= 11} onClick={() => map.current?.zoomOut()}>
          <Icon name="minus" />
        </button>
        <button aria-label={preview ? '서울 전체 보기' : '추천 장소 전체 보기'} onClick={recenter}>
          <Icon name="map" />
        </button>
        {departure && (
          <button
            aria-label={`내 위치 보기 · ${departure}`}
            onClick={() => {
              const origin = DEPARTURES[departure]
              if (!origin || !inside(origin)) {
                notify(
                  `${departure}은 현재 서울·인접 지역 지도 범위 밖이에요. 출발지 설정은 그대로 유지돼요.`,
                )
                return
              }
              map.current?.setView([origin.lat, origin.lon], 15)
            }}
          >
            <Icon name="locate" />
          </button>
        )}
      </div>
      <span className="real-map-label">
        {mapResult?.entries.length
          ? `주차·인구 · 추천 ${mapResult.entries.length}곳 주변 800m`
          : '서울·인접 지역 지도'}
      </span>
      {parkingHint && (!preview || parkingHintRequested) && (
        <button className="map-parking-zoom-hint" onClick={() => zoomToParking.current()}>
          <span aria-hidden="true">P</span>{' '}
          {preview ? '확대해서 주차장 보기' : '추천 주변 주차장 보기'}
        </button>
      )}
      {status && (
        <div className="map-load-status" role="status">
          <span>{status}</span>
          <button onClick={() => patchUI({ mapError: true })}>다시 시도</button>
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
