import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { mockScreenApi, screenRecommendation } from '../api/screenTestApi'
import { conversation } from '../api/testFixtures'
import type { RecommendationRequest } from '../api/contracts'

vi.mock('../components/map/GeoMap', () => ({ default: () => <div>테스트 지도</div> }))
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.location.hash = ''
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
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
afterEach(cleanup)
async function form() {
  const user = userEvent.setup()
  const fetcher = mockScreenApi()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '시작하기' }))
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await user.type(screen.getByRole('searchbox'), '서울역')
  expect(screen.getByRole('button', { name: '이 조건으로 찾아보기' })).toBeDisabled()
  await user.click(await screen.findByRole('button', { name: /서울역.*서울 중구/ }))
  await user.click(screen.getByRole('checkbox', { name: '카페' }))
  return { user, fetcher }
}
const requests = (fetcher: ReturnType<typeof mockScreenApi>) =>
  fetcher.mock.calls
    .filter(([url]) => url.endsWith('/recommendations'))
    .map(([, options]) => JSON.parse(options!.body as string) as RecommendationRequest)

it('정확한 조건을 보내고 추가 추천은 서버 버전·전체 제외 목록을 사용하며 선택 조건을 명시적으로 해제한다', async () => {
  const { user, fetcher } = await form()
  await user.click(screen.getByRole('checkbox', { name: '산책' }))
  await user.click(screen.getByText('추가 조건'))
  await user.type(screen.getByLabelText(/카페 키워드/), '커피')
  await user.type(screen.getByLabelText(/산책 키워드/), '공원')
  await user.type(screen.getByLabelText('방문 인원'), '4')
  await user.type(screen.getByLabelText(/최대 자동차 이동시간/), '31')
  await user.selectOptions(screen.getByLabelText('함께 가는 사람'), '친구')
  await user.click(screen.getByRole('checkbox', { name: '20대' }))
  await user.click(screen.getByRole('button', { name: '이 조건으로 찾아보기' }))
  await screen.findByRole('button', { name: '1번 추천 장소 1-1 선택' })
  const first = requests(fetcher)[0]
  expect(first.condition_version).toBe(0)
  expect(first.current_conditions.origin).toBeNull()
  expect(first.conditions_patch).toMatchObject({
    headcount: 4,
    max_travel_seconds: 1860,
    group_type: 'friends',
    age_groups: ['twenties'],
    purposes: [
      { purpose: 'cafe', keyword: '커피' },
      { purpose: 'walk', keyword: '공원' },
    ],
  })
  await user.click(screen.getByRole('button', { name: '다른 곳도' }))
  await screen.findByRole('button', { name: '1번 추천 장소 2-1 선택' })
  const second = requests(fetcher)[1]
  expect(second.conditions_patch).toEqual({})
  expect(second.condition_version).toBe(1)
  expect(second.current_conditions.headcount).toBe(4)
  expect(second.excluded_place_ids).toEqual(['real-1-1', 'real-1-2', 'real-1-3'])
  expect(second.request_id).not.toBe(first.request_id)
  await user.click(screen.getByRole('button', { name: '조건 수정' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByLabelText('방문 인원')).toHaveValue(4)
  await user.click(dialog.getByText('조금 더 맞춰볼까요?'))
  await user.click(dialog.getByRole('button', { name: '선택 조건 모두 지우기' }))
  await user.click(dialog.getByRole('button', { name: /이 조건으로 다시 추천/ }))
  await screen.findByRole('button', { name: '1번 추천 장소 3-1 선택' })
  const third = requests(fetcher)[2]
  expect(third.conditions_patch).toEqual({
    purposes: [
      { purpose: 'cafe', keyword: null },
      { purpose: 'walk', keyword: null },
    ],
    group_type: null,
    age_groups: null,
    headcount: null,
    max_travel_seconds: null,
  })
  expect(third.excluded_place_ids).toHaveLength(6)
  expect(requests(fetcher)).toHaveLength(3)
})

it('응답 유실은 같은 ID·본문으로 한 번만 재전송하고 새 추천을 중복 실행하지 않는다', async () => {
  const { user, fetcher } = await form()
  fetcher.mockRejectedValueOnce(new Error('response lost'))
  await user.click(screen.getByRole('button', { name: '이 조건으로 찾아보기' }))
  await screen.findByRole('button', { name: '같은 요청 다시 확인' })
  expect(screen.getByRole('button', { name: '이 조건으로 찾아보기' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '같은 요청 다시 확인' }))
  await screen.findByRole('button', { name: '1번 추천 장소 1-1 선택' })
  const [first, resend] = requests(fetcher)
  expect(resend).toEqual(first)
  const trip = JSON.parse(sessionStorage.getItem('seoul-next-stop-trips-v2')!).trips[0]
  expect(trip.sequence).toBe(1)
  expect(trip.chat.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1)
})

it('확정 실패에서 서버 조건은 반영하고 이전 카드를 유지하며 새 ID로 다시 시도한다', async () => {
  const { user, fetcher } = await form()
  await user.click(screen.getByRole('button', { name: '이 조건으로 찾아보기' }))
  await screen.findByRole('button', { name: '1번 추천 장소 1-1 선택' })
  fetcher.mockImplementationOnce(async (_url, options) => {
    const req = JSON.parse(options!.body as string) as RecommendationRequest
    const body = conversation(req, {
      kind: 'failure',
      result: null,
      condition_update: {
        applied: true,
        version: 2,
        conditions: { ...req.current_conditions, headcount: 7 },
        changes: [],
      },
    })
    body.error = {
      code: 'PROVIDER_TIMEOUT',
      message: '제공처 응답 지연',
      retryable: true,
      details: [],
    }
    return Response.json(body, { status: 504 })
  })
  await user.click(screen.getByRole('button', { name: '다른 곳도' }))
  await screen.findByText(/제공처 응답 지연/)
  expect(screen.getByRole('button', { name: '1번 추천 장소 1-1 선택' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '추천 다시 시도' }))
  await screen.findByRole('button', { name: '1번 추천 장소 2-1 선택' })
  const [, failed, retry] = requests(fetcher)
  expect(retry.request_id).not.toBe(failed.request_id)
  expect(retry.condition_version).toBe(2)
  expect(retry.current_conditions.headcount).toBe(7)
})

it('부분 성공 안내를 이전 결과나 실패로 표시하지 않고 서버의 장소 순서를 유지한다', async () => {
  const { user, fetcher } = await form()
  fetcher.mockImplementationOnce(async (_url, options) => {
    const body = screenRecommendation(JSON.parse(options!.body as string))
    body.data!.warnings = [{ code: 'PARTIAL', message: '일부 경로는 확인하지 못했어요.' }]
    return Response.json(body)
  })
  await user.click(screen.getByRole('button', { name: '이 조건으로 찾아보기' }))
  await screen.findByRole('button', { name: '1번 추천 장소 1-1 선택' })
  expect(screen.getByText(/일부 경로는 확인하지 못했어요/)).toBeInTheDocument()
  expect(screen.queryByText(/이전에 찾은 결과/)).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('button', { name: /번 추천 장소.*선택$/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['1번 추천 장소 1-1 선택', '2번 추천 장소 1-2 선택', '3번 추천 장소 1-3 선택']),
  )
})
