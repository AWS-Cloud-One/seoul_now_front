import { mockScreenApi, screenConditions, screenRecommendation } from '../api/screenTestApi'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppStateProvider from './AppStateProvider'
import { useAppState } from './useAppState'
import { newState } from '../lib/domain.js'
import type { RecommendationRequest } from '../api/contracts'
import type { Result } from '../types/trip'
import App from '../App'

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
  it('여행별로 작성 중인 메시지를 보관하고 새로고침 후에도 복원한다', () => {
    const first = controller()
    const tripId = first.result.current.active.trip
    act(() => first.result.current.updateChatDraft('성수에서 조용한 카페'))
    act(() => first.result.current.newTrip())
    act(() => first.result.current.updateChatDraft('강남 전시'))
    act(() => first.result.current.switchTrip(tripId))
    expect(first.result.current.active.workspaceView?.chatDraft).toBe('성수에서 조용한 카페')
    first.unmount()
    const restored = controller()
    expect(restored.result.current.active.trip).toBe(tripId)
    expect(restored.result.current.active.workspaceView?.chatDraft).toBe('성수에서 조용한 카페')
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
  it('기존 세션을 복원하고 이름 변경 및 삭제를 React 상태에 반영한다', () => {
    const old = newState()
    old.title = '기존 여행'
    sessionStorage.setItem('seoul-next-stop-v1', JSON.stringify(old))
    const { result } = controller()
    expect(result.current.active.title).toBe('기존 여행')
    act(() => result.current.renameTrip(old.trip, '가족 나들이'))
    expect(result.current.active.title).toBe('가족 나들이')
    act(() => result.current.deleteTrip(old.trip))
    expect(result.current.store.trips).toHaveLength(1)
    expect(result.current.active.trip).not.toBe(old.trip)
  })
})

describe('React 화면 흐름', () => {
  async function reachResults(user: ReturnType<typeof userEvent.setup>) {
    window.location.hash = ''
    render(<App />)
    await user.click(screen.getByRole('button', { name: /시작하기/ }))
    await user.click(screen.getByRole('button', { name: 'AI 추천' }))
    mockScreenApi()
    await user.type(screen.getByRole('searchbox', { name: /어디에서 출발하세요/ }), '서울역')
    await user.click(await screen.findByRole('button', { name: /서울역.*서울 중구/ }))
    await user.click(screen.getByRole('checkbox', { name: '카페' }))
    await user.click(screen.getByRole('button', { name: /이 조건으로 찾아보기/ }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /선택$/ })).toHaveLength(3))
  }
  it('메뉴를 오가도 같은 지도와 추천 결과·작성 중인 AI 요청을 유지한다', async () => {
    const user = userEvent.setup()
    await reachResults(user)
    const map = screen.getByTestId('map')
    await user.click(screen.getByRole('button', { name: /AI에게 조건 수정/ }))
    await user.type(screen.getByLabelText('AI에게 보낼 메시지'), '나중에 보낼 메시지')
    await user.click(screen.getByRole('button', { name: '주차장' }))
    expect(await screen.findByRole('heading', { name: /주차장/ })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBe(map)
    await user.click(screen.getByRole('button', { name: 'AI 추천' }))
    expect(screen.getAllByRole('button', { name: /선택$/ })).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: /AI에게 조건 수정/ }))
    expect(screen.getByLabelText('AI에게 보낼 메시지')).toHaveValue('나중에 보낼 메시지')
  }, 15000)
  it('추천 → 선택 → 상세 → 제외 → 주변 주차장으로 이동하고 목록으로 돌아온다', async () => {
    const user = userEvent.setup()
    await reachResults(user)
    const cards = screen.getAllByRole('button', { name: /선택$/ })
    const name = cards[0]
      .getAttribute('aria-label')!
      .replace(/^\d+번 /, '')
      .replace(/ 선택$/, '')
    await user.click(cards[0])
    expect(screen.getByRole('region', { name: '선택한 장소 추가 정보' })).toHaveTextContent('주차')
    expect(screen.getByRole('button', { name: `1번 ${name} 선택` })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await user.click(screen.getByRole('button', { name: name + ' 상세 보기' }))
    expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    await user.click(screen.getByText('출처와 상세 정보'))
    await user.click(screen.getByRole('button', { name: '이번 여행에서 제외' }))
    expect(screen.getByRole('button', { name: '다음 탐색에서 제외돼요' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /주변 주차장/ }))
    expect(await screen.findByText(new RegExp(name + ' 주변'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /추천 결과로 돌아가기/ }))
    expect(await screen.findAllByRole('button', { name: /선택$/ })).toHaveLength(3)
    expect(screen.getByRole('region', { name: '선택한 장소 추가 정보' })).toHaveTextContent('주차')
    expect(screen.getByRole('button', { name: `1번 ${name} 선택` })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  }, 15000)
})
