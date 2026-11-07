import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { normalizeParkingResponse } from './normalize'
import { createParkingStore } from './store'
import { resolveParkingPopup } from './popup'
import DemoProvider from '../DemoProvider'
import ConceptMap from '../components/ConceptMap'
import { useParkingData } from './useParkingData'
import type { ParkingSource } from './types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const row = {
  id: 'one',
  name: '첫 주차장',
  lat: 37.53,
  lng: 126.97,
  totalSpaces: 80,
  availableSpaces: 24,
  previewPosition: { x: 380, y: 365 },
}
it('응답의 0, 미제공, 잘못된 수치와 중복 ID를 안전하게 구분한다', () => {
  expect(normalizeParkingResponse({ items: [{ ...row, availableSpaces: '0' }] })[0].available).toBe(
    0,
  )
  for (const availableSpaces of [undefined, null, -1, 1.5, true, '', 81])
    expect(normalizeParkingResponse([{ ...row, availableSpaces }])[0].available).toBeNull()
  expect(normalizeParkingResponse([{ id: 'empty' }])[0]).toMatchObject({
    name: '이름 미확인 주차장',
    capacity: null,
    available: null,
    lat: null,
  })
  expect(normalizeParkingResponse([null, {}, row, { ...row, name: '최신' }])).toHaveLength(1)
  expect(normalizeParkingResponse([row, { ...row, name: '최신' }])[0].name).toBe('최신')
  expect(() => normalizeParkingResponse({ items: 'invalid' })).toThrow()
  expect(() => normalizeParkingResponse([{}])).toThrow()
})
it('지도와 조회 목록에 같은 시설의 주차 구획을 한 건으로 제공한다', async () => {
  const shared = { ...row, code: '123', address: '미아동 458-7', source: 'public', totalSpaces: 1, availableSpaces: 0 }
  const load = vi.fn().mockResolvedValue([
    shared,
    { ...shared, id: 'bay-two', lat: row.lat + 0.00005 },
  ])
  const store = createParkingStore({ kind: 'api', load })
  await store.refresh('map')
  expect(store.getSnapshot('map').lots).toMatchObject([
    { memberIds: expect.arrayContaining(['one', 'bay-two']), capacity: 2 },
  ])
})
it('폴링으로 갱신하고 오류에는 마지막 정상 자료를 유지하며 빈 응답은 반영한다', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockResolvedValue([row])
  const store = createParkingStore({ kind: 'api', load }, 1000)
  const unsubscribe = store.subscribe('map', () => {})
  await vi.advanceTimersByTimeAsync(0)
  load.mockResolvedValue([{ ...row, availableSpaces: 0 }])
  await vi.advanceTimersByTimeAsync(1000)
  expect(store.getSnapshot('map').lots[0].available).toBe(0)
  load.mockRejectedValue(new Error('offline'))
  await store.refresh('map')
  expect(store.getSnapshot('map')).toMatchObject({ status: 'error', lots: [{ available: 0 }] })
  load.mockResolvedValue({ bad: true })
  await store.refresh('map')
  expect(store.getSnapshot('map').lots[0].available).toBe(0)
  load.mockResolvedValue([])
  await store.refresh('map')
  expect(store.getSnapshot('map').lots).toEqual([])
  unsubscribe()
  const calls = load.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(load).toHaveBeenCalledTimes(calls)
})
it('늦게 도착한 이전 요청은 최신 데이터를 덮어쓰지 않는다', async () => {
  let first!: (value: unknown) => void
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve
        }),
    )
    .mockResolvedValue([{ ...row, availableSpaces: 2 }])
  const store = createParkingStore({ kind: 'api', load }, 0)
  const pending = store.refresh('map')
  await store.refresh('map')
  first([row])
  await pending
  expect(store.getSnapshot('map').lots[0].available).toBe(2)
})
it('열린 미리보기 상세창과 마커를 동일한 최신 ID 데이터로 함께 갱신한다', async () => {
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  let response: unknown = [row]
  const source: ParkingSource = {
    kind: 'api',
    initialData: { preview: [row] },
    load: async () => response,
  }
  let refresh!: () => Promise<void>
  function Harness() {
    refresh = useParkingData('preview').refresh
    return <ConceptMap />
  }
  const { container } = render(
    <DemoProvider parkingSource={source}>
      <Harness />
    </DemoProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '첫 주차장 주차 가능' }))
  expect(screen.getByText('24면 주차 가능')).toBeTruthy()
  await waitFor(() => expect(refresh).toBeTypeOf('function'))
  response = [{ ...row, name: '변경 주차장', totalSpaces: 100, availableSpaces: 0 }]
  await act(async () => {
    await refresh()
  })
  expect(screen.getByRole('button', { name: '변경 주차장 만차' })).toBeTruthy()
  expect(container.querySelector('[data-preview-parking="0"]')?.textContent).toContain('만차')
  expect(screen.getByText('현재 만차')).toBeTruthy()
  expect(screen.getByText('전체 100면')).toBeTruthy()
  response = []
  await act(async () => {
    await refresh()
  })
  expect(container.querySelector('.concept-detail')).toBeNull()
})
it('실제 지도에서 이미 열린 상세창도 최신 데이터와 삭제를 반영한다', () => {
  const old = normalizeParkingResponse([row])[0]
  const record = { kind: 'parking' as const, data: { lat: row.lat, lng: row.lng, records: [old] } }
  const updated = resolveParkingPopup(
    record,
    normalizeParkingResponse([{ ...row, name: '변경', availableSpaces: 0 }]),
  )
  expect(updated.kind === 'parking' && updated.data.records[0]).toMatchObject({
    name: '변경',
    available: 0,
  })
  const removed = resolveParkingPopup(record, [])
  expect(removed.kind === 'parking' && removed.data.records).toEqual([])
})

it('열린 주차장 목록에서 이전 ID 두 개가 같은 시설로 합쳐지면 한 번만 표시한다', () => {
  const [first, second] = normalizeParkingResponse([row, { ...row, id: 'second' }])
  const location = { lat: row.lat, lng: row.lng, records: [first, second] }
  const result = resolveParkingPopup(
    { kind: 'parking-cluster', data: [{ location, record: first }, { location, record: second }] },
    [{ ...first, memberIds: [first.id, second.id] }],
  )
  expect(result.kind === 'parking-cluster' && result.data.map((item) => item.record.id)).toEqual([first.id])
})
