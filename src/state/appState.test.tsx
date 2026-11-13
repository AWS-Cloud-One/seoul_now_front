import { mockScreenApi, screenConditions, screenRecommendation } from '../api/screenTestApi'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppStateProvider from './AppStateProvider'
import { useAppState } from './useAppState'
import { newState } from '../lib/domain.js'
import type { RecommendationRequest } from '../api/contracts'
import type { Result } from '../types/trip'

vi.mock('../components/map/GeoMap', () => ({
  default: () => <div data-testid="map">지도 SDK 영역</div>,
}))
beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const controller = () => renderHook(useAppState, { wrapper: AppStateProvider })

describe('React 여행 상태', () => {
  it('작성 중인 메시지를 새로고침 후에도 복원하고 새 여행은 빈 메시지로 시작한다', () => {
    const first = controller()
    const tripId = first.result.current.active.trip
    act(() => first.result.current.updateChatDraft('성수에서 조용한 카페'))
    first.unmount()
    const restored = controller()
    expect(restored.result.current.active.trip).toBe(tripId)
    expect(restored.result.current.active.workspaceView?.chatDraft).toBe('성수에서 조용한 카페')
    act(() => restored.result.current.newTrip())
    expect(restored.result.current.active.trip).not.toBe(tripId)
    expect(restored.result.current.active.workspaceView?.chatDraft).toBeUndefined()
  })
  it('6회 추천의 장소를 중복하지 않고 최근 5개 그룹과 전체 제외 이력을 저장한다', async () => {
    const fetcher = mockScreenApi()
    const { result } = controller()
    await act(async () => {
      await result.current.submitRecommendation(screenConditions)
    })
    for (let i = 0; i < 5; i++)
      await act(async () => {
        await result.current.recommendMore()
      })
    expect(fetcher).toHaveBeenCalledTimes(6)
    expect(result.current.active.sequence).toBe(6)
    expect(result.current.active.groups).toHaveLength(5)
    expect(result.current.active.seen).toHaveLength(18)
    expect(new Set(result.current.active.seen).size).toBe(18)
    // The server receives every place shown so far as excluded.
    const last = JSON.parse(fetcher.mock.calls[5][1]!.body as string) as RecommendationRequest
    expect(last.excluded_place_ids).toHaveLength(15)
    expect(JSON.parse(sessionStorage.getItem('seoul-next-stop-trips-v2')!).trips[0].sequence).toBe(
      6,
    )
  })
  it('여행 전환 후 도착한 이전 추천 응답을 무시한다', async () => {
    let resolve!: () => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((done) => {
            resolve = () =>
              done(Response.json(screenRecommendation(JSON.parse(options.body as string))))
          }),
      ),
    )
    const { result } = controller()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.submitRecommendation(screenConditions)
    })
    const oldTripId = result.current.active.trip
    act(() => result.current.newTrip())
    const newTripId = result.current.active.trip
    await act(async () => {
      resolve()
      await pending
    })
    expect(newTripId).not.toBe(oldTripId)
    expect(result.current.active.trip).toBe(newTripId)
    expect(result.current.store.trips.every((trip) => trip.groups.length === 0)).toBe(true)
    expect(result.current.ui.busy).toBe(false)
  })
  it('예전 로컬 모의 추천 결과는 복원하지 않고 여행과 서버 추천은 유지한다', () => {
    const trip = newState()
    trip.title = '예전 여행'
    const local: Result = {
      id: 'local-1',
      number: 1,
      time: new Date().toISOString(),
      conditions: structuredClone(trip.conditions),
      entries: [
        {
          id: 'demo-1-01',
          eta: 12,
          queryTime: new Date().toISOString(),
          reason: '',
          sourceStatus: '',
        },
      ],
    }
    Object.assign(trip, {
      groups: [local],
      current: local.id,
      selected: 'demo-1-01',
      retainedResult: { id: local.id, reason: 'empty' },
    })
    sessionStorage.setItem(
      'seoul-next-stop-trips-v2',
      JSON.stringify({ schema: 2, trips: [trip], activeTripId: trip.trip }),
    )
    const { result } = controller()
    expect(result.current.active.title).toBe('예전 여행')
    expect(result.current.active.groups).toHaveLength(0)
    expect(result.current.active.current).toBeNull()
    expect(result.current.active.selected).toBeNull()
    expect(result.current.active.retainedResult).toBeNull()
    expect(result.current.result).toBeNull()
  })
  it('이전 형식(v1)의 세션 여행을 복원한다', () => {
    const old = newState()
    old.title = '기존 여행'
    sessionStorage.setItem('seoul-next-stop-v1', JSON.stringify(old))
    const { result } = controller()
    expect(result.current.active.trip).toBe(old.trip)
    expect(result.current.active.title).toBe('기존 여행')
  })
})
