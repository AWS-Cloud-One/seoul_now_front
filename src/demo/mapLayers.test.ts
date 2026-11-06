import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import L from './vendor/leaflet.js'
import { createMapLayers } from './mapLayers.js'
import { EMPTY_CONDITIONS, PLACES } from './domain.js'
import type { MapRecord } from './mapLayers'
import type { Result } from './types'
import { normalizeParkingResponse } from './parking/normalize'

let instance: ReturnType<typeof L.map>
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  container = document.createElement('div')
  Object.defineProperties(container, { clientWidth: { value: 900 }, clientHeight: { value: 600 } })
  document.body.append(container)
  instance = L.map(container, { zoomAnimation: false, fadeAnimation: false }).setView(
    [37.55, 126.97],
    16,
  )
})
afterEach(() => {
  instance.remove()
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('추천 전 전체 지도에서도 주차장과 갱신된 잔여 대수를 표시한다', async () => {
  const parking = {
    id: 'overview-parking',
    name: '시청 주차장',
    lat: 37.55,
    lng: 126.97,
    totalSpaces: 80,
    availableSpaces: 12,
  }
  const onRecord = vi.fn()
  const controller = createMapLayers(instance, {
    data: { roads: [], parking: [parking], population: { features: [] } },
    overview: true,
    layers: { roads: false, parking: true, population: false },
    result: null,
    selected: null,
    onRecord,
    onParkingHint: vi.fn(),
  })
  expect(container.querySelector('.registered-parking-marker')?.textContent).toBe('')
  controller.highlightParking('overview-parking')
  expect(container.querySelector('.sn-focused-parking')).toHaveAttribute('aria-pressed', 'true')
  expect(container.querySelector('.registered-parking-marker')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  controller.updateParking(normalizeParkingResponse([{ ...parking, availableSpaces: 0 }]))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const marker = container.querySelector('.registered-parking-marker')!
  expect(container.querySelector('.sn-focused-parking')).not.toBeNull()
  controller.highlightParking(null)
  expect(container.querySelector('.sn-focused-parking')).toBeNull()
  expect((marker as HTMLElement).style.visibility).toBe('')
  expect(marker.textContent).toBe('만차')
  marker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(onRecord.mock.calls[0][0]).toMatchObject({
    kind: 'parking',
    data: { records: [{ id: 'overview-parking', available: 0 }] },
  })
  controller.destroy()
})

it('실제 Leaflet에 원본 도로·주차·인구 레이어를 연결하고 이벤트·레이어를 해제한다', async () => {
  const place = PLACES.find((p) => !p.legacy)!
  instance.setView([place.lat, place.lon], 16)
  const result: Result = {
    id: 'map-result',
    time: new Date().toISOString(),
    conditions: { ...EMPTY_CONDITIONS, departure: '서울역', purposes: ['카페'] },
    entries: [
      {
        id: place.id,
        eta: 10,
        queryTime: new Date().toISOString(),
        reason: '테스트 추천',
        sourceStatus: '모의',
      },
    ],
  }
  const data = {
    roads: [
      {
        id: 'test-road',
        path: [
          [place.lat, place.lon],
          [place.lat + 0.001, place.lon + 0.001],
        ],
        bbox: [place.lon, place.lat, place.lon + 0.001, place.lat + 0.001],
        classes: ['03'],
        name: '표본 도로',
        speed: 25,
      },
    ],
    parking: [
      { id: 'test-parking', lat: place.lat, lng: place.lon, name: '표본 주차장', source: 'public' },
    ],
    population: {
      features: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [place.lon - 0.001, place.lat - 0.001],
                [place.lon + 0.001, place.lat - 0.001],
                [place.lon + 0.001, place.lat + 0.001],
                [place.lon - 0.001, place.lat + 0.001],
                [place.lon - 0.001, place.lat - 0.001],
              ],
            ],
          },
          properties: { name: '표본 구역', congestion: '보통' },
        },
      ],
    },
  }
  const records: MapRecord[] = []
  const controller = createMapLayers(instance, {
    data,
    layers: { roads: true, parking: true, population: true },
    result,
    selected: place.id,
    onRecord: (record) => records.push(record),
    onParkingHint: vi.fn(),
  })
  expect(container.querySelector('.population-heat-canvas')).not.toBeNull()
  const marker = container.querySelector<HTMLElement>('.registered-parking-marker')!
  expect(marker.getAttribute('aria-label')).toContain('표본 주차장')
  marker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(records[0].kind).toBe('parking')
  const heatBefore = container.querySelector('.population-heat-canvas')
  instance.openPopup('열린 상세창', [place.lat, place.lon])
  controller.updateParking(
    normalizeParkingResponse([
      { ...data.parking[0], name: '갱신 주차장', totalSpaces: 80, availableSpaces: 7 },
    ]),
  )
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const updatedMarker = container.querySelector<HTMLElement>('.registered-parking-marker')!
  expect(updatedMarker.textContent).toBe('')
  expect(updatedMarker.getAttribute('aria-label')).toContain('갱신 주차장')
  expect(container.querySelector('.leaflet-popup-content')?.textContent).toBe('열린 상세창')
  expect(container.querySelector('.population-heat-canvas')).toBe(heatBefore)
  updatedMarker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(records.at(-1)).toMatchObject({
    kind: 'parking',
    data: { records: [{ name: '갱신 주차장', available: 7, capacity: 80 }] },
  })
  controller.updateParking(
    normalizeParkingResponse([{ ...data.parking[0], totalSpaces: 80, availableSpaces: 0 }]),
  )
  await new Promise((resolve) => requestAnimationFrame(resolve))
  expect(container.querySelector('.registered-parking-marker')?.textContent).toBe('만차')
  controller.destroy()
  expect(container.querySelector('.population-heat-canvas')).toBeNull()
  expect(container.querySelector('.registered-parking-marker')).toBeNull()
  // Mount again on the same map to catch duplicate panes and stale listeners.
  const next = createMapLayers(instance, {
    data,
    layers: { roads: false, parking: false, population: false },
    result,
    selected: null,
    onRecord: vi.fn(),
    onParkingHint: vi.fn(),
  })
  expect(container.querySelector('.population-heat-canvas')).toHaveAttribute('hidden')
  expect(container.querySelector('.registered-parking-marker')).toBeNull()
  next.destroy()
})

it('같은 묶음의 동명 주차장을 골라도 개별 핀과 주소를 구분한다', () => {
  instance.setView([37.55, 126.97], 14)
  const controller = createMapLayers(instance, {
    data: { roads: [], parking: [], population: { features: [] } },
    parkingRecords: normalizeParkingResponse([
      { id: 'a', name: '동명 주차장', address: '연남동 149-15', lat: 37.55, lng: 126.97 },
      { id: 'b', name: '동명 주차장', address: '연남동 150-1', lat: 37.55001, lng: 126.97001 },
    ]),
    overview: true,
    layers: { roads: false, parking: true, population: false },
    result: null,
    selected: null,
    onRecord: vi.fn(),
    onParkingHint: vi.fn(),
  })
  controller.highlightParking('a')
  expect(container.querySelector('.sn-focused-parking')).toHaveAttribute(
    'aria-label',
    '살펴보는 주차장: 동명 주차장 · 연남동 149-15',
  )
  expect(container.querySelector('.registered-parking-marker.is-selected')).toBeNull()
  controller.highlightParking('b')
  expect(container.querySelectorAll('.sn-focused-parking')).toHaveLength(1)
  expect(container.querySelector('.sn-focused-parking')).toHaveAttribute(
    'aria-label',
    '살펴보는 주차장: 동명 주차장 · 연남동 150-1',
  )
  expect(container.querySelector('.sn-focused-parking-label')).toHaveTextContent('연남동 150-1')
  controller.destroy()
  expect(container.querySelector('.sn-focused-parking')).toBeNull()
})
