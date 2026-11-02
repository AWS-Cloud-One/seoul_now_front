import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DemoProvider from './DemoProvider'
import { useDemo } from './useDemo'
import { EMPTY_CONDITIONS, MockService, newState } from './domain.js'
import type { Conditions, Response } from './types'
import App from '../App'

vi.mock('./components/MapPanel', () => ({
  default: () => <div data-testid="map">지도 SDK 영역</div>,
}))
const conditions: Conditions = { ...EMPTY_CONDITIONS, departure: '서울역', purposes: ['카페'] }
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
const controller = () => renderHook(useDemo, { wrapper: DemoProvider })

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
    const { result } = controller()
    await act(async () => {
      await result.current.startTrip(conditions)
    })
    for (let i = 0; i < 5; i++)
      await act(async () => {
        await result.current.search(conditions)
      })
    expect(result.current.active.sequence).toBe(6)
    expect(result.current.active.groups).toHaveLength(5)
    expect(result.current.active.seen).toHaveLength(18)
    expect(new Set(result.current.active.seen).size).toBe(18)
    expect(JSON.parse(sessionStorage.getItem('seoul-next-stop-trips-v2')!).trips[0].sequence).toBe(
      6,
    )
  })
  it('빈 결과는 새 조건을 적용하면서 이전 추천과 시각을 유지하고, 수락 실패는 조건도 유지한다', async () => {
    const { result } = controller()
    await act(async () => {
      await result.current.startTrip(conditions)
    })
    const previous = structuredClone(result.current.result)
    const changed = { ...conditions, purposes: ['전시'] }
    await act(async () => {
      await result.current.search(changed, false, 'empty')
    })
    expect(result.current.active.conditions.purposes).toEqual(['전시'])
    expect(result.current.result).toEqual(previous)
    expect(result.current.active.retainedResult?.reason).toBe('empty')
    await act(async () => {
      await result.current.search(conditions, false, 'unconfirmed')
    })
    expect(result.current.active.conditions.purposes).toEqual(['전시'])
    expect(result.current.result?.time).toBe(previous?.time)
  })
  it('경로 전체 실패 후보는 성공 이력에 넣지 않고 재검증 성공 후 한 번만 넣는다', async () => {
    const { result } = controller()
    await act(async () => {
      await result.current.startTrip(conditions)
    })
    await act(async () => {
      await result.current.search(conditions, false, 'route-all')
    })
    expect(result.current.active.general?.entries.every((e) => e.eta === null)).toBe(true)
    expect(result.current.active.sequence).toBe(1)
    expect(result.current.active.seen).toHaveLength(3)
    await act(async () => {
      await result.current.retryRoute()
    })
    expect(result.current.active.general).toBeNull()
    expect(result.current.active.sequence).toBe(2)
    expect(result.current.active.seen).toHaveLength(6)
  })
  it('여행 전환 후 도착한 이전 추천 응답을 무시한다', async () => {
    const { result } = controller()
    let resolve!: (response: Response) => void
    vi.spyOn(MockService, 'recommend').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.startTrip(conditions)
    })
    const oldTripId = result.current.active.trip
    act(() => result.current.newTrip())
    const newTripId = result.current.active.trip
    await act(async () => {
      resolve({ accepted: true, entries: [], time: new Date().toISOString() })
      await pending
    })
    expect(result.current.active.trip).toBe(newTripId)
    expect(newTripId).not.toBe(oldTripId)
    expect(result.current.active.groups).toHaveLength(0)
    expect(result.current.ui.busy).toBe(false)
  })
  it('과거 추천을 열면 대화 조건과 선택한 장소도 그 추천으로 복원한다', async () => {
    const { result } = controller()
    await act(async () => {
      await result.current.startTrip(conditions)
    })
    const old = result.current.result!
    await act(async () => {
      await result.current.search({ ...conditions, departure: '강남역', purposes: ['전시'] })
    })
    act(() => result.current.openDetail(old.entries[1].id, old.id))
    expect(result.current.active.conditions).toEqual(old.conditions)
    expect(result.current.active.selected).toBe(old.entries[1].id)
    expect(result.current.active.chat.at(-1)?.kind).toBe('context-switch')
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
  it('모바일에서는 첫 추천 후 대화창을 열고 닫아도 대화와 추천을 유지한다', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /시작하기/ }))
    await user.click(screen.getByRole('button', { name: '챗봇 열기' }))
    await user.selectOptions(screen.getByLabelText(/어디에서 출발하세요/), '서울역')
    await user.click(screen.getByRole('checkbox', { name: '카페' }))
    await user.click(screen.getByRole('button', { name: /이 조건으로 찾아보기/ }))
    const dialog = await screen.findByRole('dialog', { name: '추천해줄게!' })
    await waitFor(() =>
      expect(within(dialog).getAllByRole('button', { name: /장소 보기/ })).toHaveLength(3),
    )
    await user.type(within(dialog).getByLabelText('대화 메시지'), '나중에 보낼 메시지')
    await user.click(within(dialog).getByRole('button', { name: '대화 닫기' }))
    await user.click(screen.getByRole('button', { name: '챗봇과 대화 열기' }))
    expect(screen.getByLabelText('대화 메시지')).toHaveValue('나중에 보낼 메시지')
  }, 15000)
  it('시작 → 미리보기 → 조건 입력 → 추천 → 대화로 조건 변경 → 상세 → 제외까지 진행한다', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /시작하기/ }))
    await user.click(screen.getByRole('button', { name: '챗봇 열기' }))
    await user.selectOptions(screen.getByLabelText(/어디에서 출발하세요/), '서울역')
    await user.click(screen.getByRole('checkbox', { name: '카페' }))
    await user.click(screen.getByRole('button', { name: /이 조건으로 찾아보기/ }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /장소 보기/ })).toHaveLength(3),
    )
    const firstCard = screen
      .getAllByRole('button', { name: /장소 보기/ })[0]
      .getAttribute('aria-label')!
    expect(screen.queryByText(/여행 조건을 확인했어요/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '왜 추천했어?' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '챗봇 답변' })).toHaveTextContent(
        '제안한 당시 이유',
      ),
    )
    expect(screen.queryByText('조건 보기')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('대화 메시지'), '강남역에서 전시')
    await user.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: firstCard })).not.toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /장소 보기/ })).toHaveLength(3)
        expect(screen.queryByText(/보관 기간이 지난 추천/)).not.toBeInTheDocument()
        expect(screen.queryByText(/여행 조건을 확인했어요/)).not.toBeInTheDocument()
      },
      { timeout: 3000 },
    )
    const cards = screen.getAllByRole('button', { name: /장소 보기/ })
    await user.click(cards[0])
    await user.click(screen.getByRole('button', { name: /자세히 보기/ }))
    const detail = screen
      .getByRole('region', { name: '이곳을 추천하는 이유' })
      .closest('.place-detail') as HTMLElement
    await user.click(within(detail).getByText(/출처와 자세한 정보/))
    await user.click(within(detail).getByRole('button', { name: '이번 여행에서 제외' }))
    expect(within(detail).getByRole('button', { name: '다음 탐색에서 제외돼요' })).toBeDisabled()
    await user.click(within(detail).getByRole('button', { name: '길안내' }))
    await user.click(screen.getByRole('button', { name: /목적지 확인 · 실행 시연/ }))
    expect(screen.getByText(/외부 앱 실행 실패를 재현했어요/)).toBeInTheDocument()
  }, 15000)
})
