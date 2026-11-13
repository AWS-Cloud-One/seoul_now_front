import { mockScreenApi, screenConditions } from '../api/screenTestApi'
import { apiConditions, contextResult } from '../api/testFixtures'
import { createServerTrip, displayConditions, resultSnapshot } from './apiState'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchivedRecommendations } from '../chat/components/ArchivedRecommendations'
import AppStateProvider from './AppStateProvider'
import { newState, placeById } from '../lib/domain.js'
import { loadSavedTrips, SAVED_TRIPS_KEY } from './savedTrips'
import { useAppState } from './useAppState'
import type { SavedTrip, Trip } from '../types/trip'

vi.mock('../components/map/GeoMap', () => ({ default: () => <div>지도 영역</div> }))
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
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

async function recommend(hook: ReturnType<typeof controller>, more = 0) {
  await act(async () => {
    await hook.result.current.submitRecommendation(screenConditions)
  })
  for (let i = 0; i < more; i++)
    await act(async () => {
      await hook.result.current.recommendMore()
    })
}

it('저장한 추천을 중복하지 않고, 기록 만료·새 여행·새 세션 후에도 재요청 없이 그대로 복원한다', async () => {
  const fetcher = mockScreenApi()
  const first = controller()
  await recommend(first)
  const original = structuredClone(first.result.current.result!)
  const selected = original.entries[1].id
  act(() => first.result.current.selectPlace(selected))
  act(() => first.result.current.saveCurrentTrip())
  act(() => first.result.current.saveCurrentTrip())
  expect(first.result.current.savedTrips).toHaveLength(1)
  const savedId = first.result.current.savedTrips[0].id
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await first.result.current.recommendMore()
    })
  expect(first.result.current.active.groups.some((group) => group.id === original.id)).toBe(false)
  act(() => first.result.current.newTrip())
  expect(first.result.current.savedTrips).toHaveLength(1)
  first.unmount()
  sessionStorage.clear()
  const restored = controller()
  expect(restored.result.current.savedTrips).toHaveLength(1)
  const requests = fetcher.mock.calls.length
  act(() => restored.result.current.openSavedTrip(savedId))
  expect(fetcher).toHaveBeenCalledTimes(requests)
  expect(restored.result.current.result).toEqual(original)
  expect(restored.result.current.active.conditions).toEqual(original.conditions)
  expect(restored.result.current.active.selected).toBe(selected)
  expect(restored.result.current.currentTripSaved).toBe(true)
  expect(restored.result.current.ui.page).toBe('main')
})

it('저장 공간 오류가 나면 성공으로 표시하지 않고 기존 저장 목록을 유지한다', async () => {
  mockScreenApi()
  const hook = controller()
  const { result } = hook
  await recommend(hook)
  act(() => result.current.saveCurrentTrip())
  const existing = localStorage.getItem(SAVED_TRIPS_KEY)
  await act(async () => {
    await result.current.recommendMore()
  })
  const native = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key === SAVED_TRIPS_KEY)
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    return native.call(this, key, value)
  })
  act(() => result.current.saveCurrentTrip())
  expect(result.current.savedTrips).toHaveLength(1)
  expect(result.current.ui.toast).toContain('저장하지 못했어요')
  act(() => result.current.removeSavedTrip(result.current.savedTrips[0].id))
  expect(result.current.savedTrips).toHaveLength(1)
  expect(localStorage.getItem(SAVED_TRIPS_KEY)).toBe(existing)
})

it('일반 후보도 조회 시각과 이동시간 미확인 상태를 유지해 복원한다', () => {
  // A server result whose routes all failed is kept as general candidates.
  const trip = newState() as Trip
  const server = { ...createServerTrip(trip.trip), conditions: structuredClone(apiConditions) }
  const raw = contextResult()
  raw.cards[0].rank = null
  raw.cards[0].route = { ...raw.cards[0].route, status: 'error', value: null }
  const general = resultSnapshot(raw, server.tripId, 1)
  Object.assign(trip, {
    api: server,
    conditions: displayConditions(server.conditions),
    general,
    current: null,
    selected: general.entries[0].id,
    onboardingComplete: true,
  })
  sessionStorage.setItem(
    'seoul-next-stop-trips-v2',
    JSON.stringify({ schema: 2, trips: [trip], activeTripId: trip.trip }),
  )
  const { result } = controller()
  const shown = structuredClone(result.current.result!)
  expect(shown.entries.every((entry) => entry.eta === null)).toBe(true)
  act(() => result.current.saveCurrentTrip())
  const savedId = result.current.savedTrips[0].id
  act(() => result.current.newTrip())
  act(() => result.current.openSavedTrip(savedId))
  expect(result.current.active.general).toEqual(shown)
  expect(result.current.active.current).toBeNull()
  expect(result.current.result?.entries.every((entry) => entry.eta === null)).toBe(true)
})

it('저장 해제는 보관 목록에서만 제거하고 현재 여행과 추천은 유지한다', async () => {
  mockScreenApi()
  const hook = controller()
  const { result } = hook
  await recommend(hook)
  const original = structuredClone(result.current.result)
  act(() => result.current.saveCurrentTrip())
  act(() => result.current.removeSavedTrip(result.current.savedTrips[0].id))
  expect(result.current.savedTrips).toHaveLength(0)
  expect(result.current.result).toEqual(original)
  expect(JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY)!).items).toHaveLength(0)
})

it('장소 정보가 없는 예전 로컬 모의 저장본은 목록에서 제외하고 서버 추천 저장본은 유지한다', async () => {
  mockScreenApi()
  const hook = controller()
  await recommend(hook)
  act(() => hook.result.current.saveCurrentTrip())
  const server = hook.result.current.savedTrips[0]
  const local: SavedTrip = structuredClone(server)
  local.id = 'local-saved'
  delete local.api
  local.result = {
    ...structuredClone(server.result),
    api: undefined,
    entries: server.result.entries.map((entry) => ({ ...entry, place: undefined })),
  }
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify({ schema: 1, items: [local, server] }))
  expect(loadSavedTrips().map((saved) => saved.id)).toEqual([server.id])
})

it('이전 저장본을 읽기 전용으로 열고 길찾기에는 장소만 전달한다', async () => {
  const user = userEvent.setup()
  const first = controller()
  mockScreenApi()
  await recommend(first)
  act(() => first.result.current.saveCurrentTrip())
  const saved = first.result.current.savedTrips[0]
  const place = placeById(saved.result.entries[0].id, saved.result)!
  first.unmount()
  const go = vi.fn()
  render(<ArchivedRecommendations go={go} />, { wrapper: AppStateProvider })
  await user.click(screen.getByText('이전 추천 묶음 1개'))
  await user.click(screen.getByText(saved.title))
  expect(screen.getByText(`1. ${place.name}`)).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'AI에게 보낼 메시지' })).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '여기로 길찾기' })[0])
  expect(go).toHaveBeenCalledWith('directions')
  expect(loadSavedTrips()).toHaveLength(1)
})
