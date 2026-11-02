import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import DemoProvider from './DemoProvider'
import { EMPTY_CONDITIONS, MockService, placeById } from './domain.js'
import { SAVED_TRIPS_KEY } from './savedTrips'
import { useDemo } from './useDemo'
import type { Conditions } from './types'

vi.mock('./components/GeoMap', () => ({ default: () => <div>지도 영역</div> }))
const conditions: Conditions = { ...EMPTY_CONDITIONS, departure: '서울역', purposes: ['카페'] }
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
const controller = () => renderHook(useDemo, { wrapper: DemoProvider })

it('저장한 추천을 중복하지 않고, 기록 만료·여행 삭제·새 세션 후에도 재요청 없이 그대로 복원한다', async () => {
  const first = controller()
  await act(async () => {
    await first.result.current.startTrip(conditions)
  })
  const original = structuredClone(first.result.current.result!)
  const selected = original.entries[1].id
  act(() => first.result.current.selectPlace(selected))
  act(() => first.result.current.saveCurrentTrip())
  act(() => first.result.current.saveCurrentTrip())
  expect(first.result.current.savedTrips).toHaveLength(1)
  const savedId = first.result.current.savedTrips[0].id
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await first.result.current.search(conditions)
    })
  expect(first.result.current.active.groups.some((group) => group.id === original.id)).toBe(false)
  act(() => first.result.current.deleteTrip(first.result.current.active.trip))
  expect(first.result.current.savedTrips).toHaveLength(1)
  first.unmount()
  sessionStorage.clear()
  const restored = controller()
  expect(restored.result.current.savedTrips).toHaveLength(1)
  const recommend = vi.spyOn(MockService, 'recommend')
  act(() => restored.result.current.openSavedTrip(savedId))
  expect(recommend).not.toHaveBeenCalled()
  expect(restored.result.current.result).toEqual(original)
  expect(restored.result.current.active.conditions).toEqual(original.conditions)
  expect(restored.result.current.active.selected).toBe(selected)
  expect(restored.result.current.currentTripSaved).toBe(true)
  expect(restored.result.current.ui.page).toBe('main')
})

it('저장 공간 오류가 나면 성공으로 표시하지 않고 기존 저장 목록을 유지한다', async () => {
  const { result } = controller()
  await act(async () => {
    await result.current.startTrip(conditions)
  })
  act(() => result.current.saveCurrentTrip())
  const existing = localStorage.getItem(SAVED_TRIPS_KEY)
  await act(async () => {
    await result.current.search(conditions)
  })
  const native = localStorage.setItem
  vi.spyOn(localStorage, 'setItem').mockImplementation(function (key, value) {
    if (key === SAVED_TRIPS_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    return native.call(localStorage, key, value)
  })
  act(() => result.current.saveCurrentTrip())
  expect(result.current.savedTrips).toHaveLength(1)
  expect(result.current.ui.toast).toContain('저장하지 못했어요')
  act(() => result.current.removeSavedTrip(result.current.savedTrips[0].id))
  expect(result.current.savedTrips).toHaveLength(1)
  expect(localStorage.getItem(SAVED_TRIPS_KEY)).toBe(existing)
})

it('일반 후보도 조회 시각과 이동시간 미확인 상태를 유지해 복원한다', async () => {
  const { result } = controller()
  await act(async () => {
    await result.current.startTrip(conditions)
  })
  await act(async () => {
    await result.current.search(conditions, false, 'route-all')
  })
  const general = structuredClone(result.current.result!)
  act(() => result.current.saveCurrentTrip())
  const savedId = result.current.savedTrips[0].id
  act(() => result.current.newTrip())
  act(() => result.current.openSavedTrip(savedId))
  expect(result.current.active.general).toEqual(general)
  expect(result.current.active.current).toBeNull()
  expect(result.current.result?.entries.every((entry) => entry.eta === null)).toBe(true)
})

it('저장 해제는 보관 목록에서만 제거하고 현재 여행과 추천은 유지한다', async () => {
  const { result } = controller()
  await act(async () => {
    await result.current.startTrip(conditions)
  })
  const original = structuredClone(result.current.result)
  act(() => result.current.saveCurrentTrip())
  act(() => result.current.removeSavedTrip(result.current.savedTrips[0].id))
  expect(result.current.savedTrips).toHaveLength(0)
  expect(result.current.result).toEqual(original)
  expect(JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY)!).items).toHaveLength(0)
})

it('저장 탭 빈 목록 → 추천 저장 → 새 여행 → 저장 목록에서 복원한다', async () => {
  window.location.hash = ''
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: /시작하기/ }))
  await user.click(
    within(screen.getByRole('navigation', { name: '주요 메뉴' })).getByRole('button', {
      name: /저장/,
    }),
  )
  expect(await screen.findByText('저장한 여행이 없어요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /현재 추천 저장/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await user.selectOptions(screen.getByLabelText(/어디에서 출발하세요/), '서울역')
  await user.click(screen.getByRole('checkbox', { name: '카페' }))
  await user.click(screen.getByRole('button', { name: /이 조건으로 찾아보기/ }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /선택$/ })).toHaveLength(3))
  const firstName = placeById(
    JSON.parse(sessionStorage.getItem('seoul-next-stop-trips-v2')!).trips[0].groups[0].entries[0]
      .id,
  )!.name
  await user.click(
    within(screen.getByRole('navigation', { name: '주요 메뉴' })).getByRole('button', {
      name: /저장/,
    }),
  )
  await user.click(screen.getByRole('button', { name: '현재 추천 저장' }))
  expect(screen.getByRole('button', { name: '저장됨' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await user.click(screen.getByRole('button', { name: '새 여행' }))
  await user.click(
    within(screen.getByRole('navigation', { name: '주요 메뉴' })).getByRole('button', {
      name: /저장/,
    }),
  )
  await user.click(screen.getByRole('button', { name: /열기$/ }))
  expect(
    await screen.findByRole('button', { name: new RegExp(firstName + ' 선택') }),
  ).toBeInTheDocument()
}, 15000)
