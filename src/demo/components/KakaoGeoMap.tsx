import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { loadKakaoSdk } from '../kakaoSdk'
import { useDemo } from '../useDemo'
import { useParkingData } from '../parking/useParkingData'
import { DEPARTURES, placeById } from '../domain.js'
import { SEOUL_VIEW_BOUNDS } from '../data/seoulBoundary'
import { useLive, startLive, selectLivePlace, LEVEL_COLORS } from '../live/store'
import {
  getMapOverlay,
  MAP_OVERLAY_EVENT,
  MAP_FOCUS_EVENT,
  PARKING_SELECT_EVENT,
  type MapOverlay,
} from './shell/useRoute'
import type { ParkingLot } from '../parking/types'
import type { MapRecord as RecordData } from '../mapLayers'
import markerIcons from '../data/icons.json'
import MapRecord from './MapRecord'
import Icon from './Icon'

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
  const root = useRef<HTMLDivElement>(null)
  const instance = useRef<kakao.maps.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tick, setTick] = useState(0)
  const [overlay, setOverlay] = useState<MapOverlay>(getMapOverlay)
  const [focused, setFocused] = useState<string | null>(
    active.parkingSelections?.[active.selected || ''] || null,
  )
  const [record, setRecord] = useState<RecordData | null>(null)
  const onView = useEffectEvent(() => {
    const map = instance.current
    if (!map) return
    const center = map.getCenter()
    saveMap({
      center: [center.getLat(), center.getLng()],
      zoom: 20 - map.getLevel(),
      resultId: result?.id,
    })
    setTick((value) => value + 1)
  })
  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | undefined
    let map: kakao.maps.Map | undefined
    const container = root.current
    loadKakaoSdk(import.meta.env.VITE_KAKAO_MAP_APP_KEY!.trim())
      .then(() => {
        if (cancelled || !root.current) return
        map = new kakao.maps.Map(root.current, { center: position(37.5665, 126.978), level: 9 })
        map.setMaxLevel(matchMedia('(max-width:900px)').matches ? 10 : 9)
        map.setMinLevel(1)
        instance.current = map
        overview(map)
        kakao.maps.event.addListener(map, 'idle', onView)
        observer = new ResizeObserver(() => {
          if (!map) return
          const center = map.getCenter()
          map.relayout()
          map.setCenter(center)
          setTick((value) => value + 1)
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
      observer?.disconnect()
      if (map) kakao.maps.event.removeListener(map, 'idle', onView)
      instance.current = null
      container?.replaceChildren()
    }
  }, [attempt])
  useEffect(() => {
    const stop = startLive()
    return stop
  }, [])
  useEffect(() => {
    const map = instance.current
    if (!ready || !map || !layers.roads) return
    map.addOverlayMapTypeId(kakao.maps.MapTypeId.TRAFFIC)
    return () => map.removeOverlayMapTypeId(kakao.maps.MapTypeId.TRAFFIC)
  }, [ready, layers.roads])
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
        strokeOpacity: 0.9,
        zIndex,
      })
      items.push(item)
    }
    if (layers.population)
      for (const place of live.places) {
        const item = new kakao.maps.Polygon({
          map,
          path: place.ring.map((p) => position(...p)),
          strokeWeight: 0,
          fillColor: LEVEL_COLORS[place.level],
          fillOpacity: 0.22,
          zIndex: 4,
        })
        kakao.maps.event.addListener(item, 'click', () => selectLivePlace(place.code))
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
      line(overlay.route, '#fff', 10, 14)
      line(overlay.route, '#176bea', 6, 15)
    }
    for (const road of overlay.traffic || [])
      line(
        road.path,
        road.level === '정체' ? '#d4443b' : road.level === '서행' ? '#e0a21b' : '#1f9d6b',
        5,
        16,
      )
    return () => items.forEach((item) => item.setMap(null))
  }, [ready, layers.population, live.boundary, live.places, overlay])
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
    if (departure) {
      const node = document.createElement('span')
      node.className = 'sn-kakao-origin'
      node.textContent = '출발지'
      add(departure.lat, departure.lon, node, 30)
    }
    if (overlay.destination) {
      const destination = overlay.destination
      add(
        destination.lat,
        destination.lng,
        pin(destination.name, 'pin', () => {}, true),
        55,
        1,
      )
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
      const groups = new Map<string, ParkingLot[]>()
      const anchors: { key: string; x: number; y: number }[] = []
      for (const lot of parking.lots) {
        if (lot.lat === null || lot.lng === null || !bounds.contain(position(lot.lat, lot.lng)))
          continue
        const pixel = projection.containerPointFromCoords(position(lot.lat, lot.lng))
        const nearby =
          map.getLevel() >= 5
            ? anchors.find(
                (anchor) => Math.abs(anchor.x - pixel.x) < 90 && Math.abs(anchor.y - pixel.y) < 46,
              )
            : undefined
        const key = nearby?.key || lot.id
        if (!nearby) anchors.push({ key, x: pixel.x, y: pixel.y })
        const group = groups.get(key) || []
        group.push(lot)
        groups.set(key, group)
      }
      for (const group of groups.values()) {
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
      const lot = parking.lots.find((p) => p.id === focused)
      if (lot?.lat !== null && lot?.lat !== undefined && lot.lng !== null) {
        const node = pin(
          lot.name,
          'car',
          () =>
            setRecord({ kind: 'parking', data: { lat: lot.lat!, lng: lot.lng!, records: [lot] } }),
          true,
        )
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
      {record && (
        <div className="sn-kakao-record">
          <button
            className="sn-kakao-record-close"
            aria-label="지도 정보 닫기"
            onClick={() => setRecord(null)}
          >
            ×
          </button>
          <MapRecord record={record} parkingError={parking.error} onSelectParking={setRecord} />
        </div>
      )}
    </>
  )
}
