import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import DemoProvider from '../DemoProvider'
import AppShell from '../components/shell/AppShell'
import { useDemo } from '../useDemo'
import { EMPTY_CONDITIONS } from '../domain.js'
import { useSelectedParking } from './useSelectedParking'
import type { ParkingSource } from './types'

vi.mock('../components/GeoMap', () => ({ default: () => <div>테스트 지도</div> }))
const lots = [
  { id: 'chosen-one', name: '테스트 공영주차장', lat: 37.55, lng: 126.98 },
  { id: 'chosen-two', name: '두 번째 주차장', lat: 37.5501, lng: 126.9801 },
]
const source: ParkingSource = {
  kind: 'api',
  initialData: { map: lots },
  load: async () => ({ items: lots }),
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <DemoProvider parkingSource={source}>{children}</DemoProvider>
)
const conditions = { ...EMPTY_CONDITIONS, departure: '서울역', purposes: ['카페'] }
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.location.hash = ''
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('선택 전 거리를 만들지 않고 선택한 장소별로 저장하며 새로고침·저장 복원에도 유지한다', async () => {
  const useController = () => {
    const demo = useDemo()
    return { demo, chosen: useSelectedParking(demo.active.selected) }
  }
  const first = renderHook(useController, { wrapper })
  await act(async () => {
    await first.result.current.demo.startTrip(conditions)
  })
  expect(first.result.current.chosen).toBeNull()
  const place = first.result.current.demo.active.selected!
  act(() => first.result.current.demo.selectParking(place, 'chosen-one'))
  expect(first.result.current.chosen?.lot.name).toBe('테스트 공영주차장')
  expect(first.result.current.chosen?.meters).toBeGreaterThanOrEqual(0)
  act(() => first.result.current.demo.saveCurrentTrip())
  const saved = first.result.current.demo.savedTrips[0].id
  act(() => first.result.current.demo.selectParking(place, 'chosen-two'))
  expect(first.result.current.chosen?.lot.id).toBe('chosen-two')
  act(() => first.result.current.demo.openSavedTrip(saved))
  expect(first.result.current.chosen?.lot.id).toBe('chosen-one')
  const other = first.result.current.demo.result!.entries[1].id
  act(() => first.result.current.demo.selectPlace(other))
  expect(first.result.current.chosen).toBeNull()
  act(() => first.result.current.demo.selectPlace(place))
  first.unmount()
  const restored = renderHook(useController, { wrapper })
  expect(restored.result.current.chosen?.lot.id).toBe('chosen-one')
  act(() => restored.result.current.demo.selectParking(place, 'removed-lot'))
  expect(restored.result.current.chosen).toBeNull()
})

it('기존 주차장 메뉴에서 확정하면 장소 상세에 이름과 추정 도보 시간을 표시한다', async () => {
  const user = userEvent.setup()
  render(<AppShell />, { wrapper })
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await user.selectOptions(screen.getByLabelText(/어디에서 출발하세요/), '서울역')
  await user.click(screen.getByRole('checkbox', { name: '카페' }))
  await user.click(screen.getByRole('button', { name: '이 조건으로 찾아보기' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /선택$/ })).toHaveLength(3))
  expect(screen.queryByText(/주차장 도보 포함/)).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: '선택한 장소 추가 정보' })).toHaveTextContent(
    '주차장을 선택해 주세요',
  )
  await user.click(screen.getByRole('button', { name: '주변 주차장' }))
  await user.click(await screen.findByRole('button', { name: /테스트 공영주차장/ }))
  await user.click(screen.getByRole('button', { name: '이 주차장 선택' }))
  const section = await screen.findByRole('region', { name: '현재 상황' })
  expect(within(section).getByText(/테스트 공영주차장/)).toBeInTheDocument()
  expect(within(section).getAllByText(/약 \d+분/).length).toBeGreaterThan(0)
  expect(within(section).getByText(/직선거리 기반 추정/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '주차장 변경' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '주차장 변경' }))
  await user.click(await screen.findByRole('button', { name: /두 번째 주차장/ }))
  const confirmed = screen.getByText('선택한 주차장')
  expect(confirmed.querySelector('svg')).not.toBeNull()
  expect(confirmed.closest('li')).toHaveTextContent('테스트 공영주차장')
  expect(confirmed.closest('li')).not.toHaveClass('is-picked')
  expect(screen.getByRole('button', { name: /두 번째 주차장/ })).toHaveAttribute('aria-pressed', 'true')
}, 15000)
