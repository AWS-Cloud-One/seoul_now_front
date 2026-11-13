import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AppStateProvider from '../state/AppStateProvider'
import ChatClarification from '../components/chat/ChatClarification'
import { useAppState } from '../state/useAppState'
import { createServerTrip, resultSnapshot } from '../state/apiState'
import { newState } from '../lib/domain.js'
import { apiConditions, contextResult, conversation, FIXTURE_TIME } from '../api/testFixtures'
import type { ChatRequest, Clarification, ConversationData, OriginContext } from '../api/contracts'

vi.mock('../components/map/GeoMap', () => ({ default: () => <div>지도 영역</div> }))
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.location.hash = ''
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const controller = () => renderHook(useAppState, { wrapper: AppStateProvider })
function question(mode: OriginContext['mode'] = 'confirm', token = 'a'.repeat(43)): Clarification {
  return {
    question:
      mode === 'confirmed'
        ? '정확히 몇 명인가요?'
        : mode === 'refine'
          ? '출발지를 다시 알려주세요.'
          : '이 출발지가 맞나요?',
    required_fields: mode === 'confirmed' ? ['headcount'] : ['origin'],
    pending_patch: {
      purposes: [{ purpose: 'cafe', keyword: '커피' }],
      ...(mode === 'confirmed' ? { origin: apiConditions.origin! } : {}),
    },
    choices:
      mode === 'refine' || mode === 'confirmed'
        ? []
        : ['서울역', '강남역'].map((name, i) => ({
            label: name,
            value: {
              candidate_id: `candidate-${i}`,
              location: { ...apiConditions.origin!, label: name },
              match_reasons: ['name_exact'],
            },
          })),
    origin_context: {
      mode,
      context_token: token,
      preferred_candidate_id: mode === 'confirm' ? 'candidate-0' : null,
      expires_at: new Date(Date.now() + 300000).toISOString(),
      search_limited: mode === 'choose',
    },
  }
}
function reply(
  req: ChatRequest,
  kind: ConversationData['kind'] = 'clarification',
  extra: Partial<ConversationData> = {},
  status = 200,
) {
  const body = conversation(req, {
    kind,
    result: null,
    clarification: kind === 'clarification' ? question() : null,
    condition_update: {
      applied: false,
      version: req.condition_version,
      conditions: req.current_conditions,
      changes: [],
    },
    ...extra,
  })
  if (status !== 200)
    body.error = {
      code: status === 410 ? 'CONTEXT_EXPIRED' : 'PROVIDER_TIMEOUT',
      message: status === 410 ? '출발지 질문이 만료됐어요.' : '제공처 응답이 지연됐어요.',
      retryable: status !== 410,
      details: [],
    }
  return Response.json(body, { status })
}
function stubChat(
  run: (req: ChatRequest, index: number) => Promise<Response> | Response = (req) => reply(req),
) {
  const bodies: ChatRequest[] = []
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (!url.endsWith('/chat/messages')) return Promise.reject(new Error('Unexpected API'))
    const body = JSON.parse(options!.body as string) as ChatRequest
    bodies.push(body)
    return Promise.resolve(run(body, bodies.length - 1))
  })
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, bodies }
}
function savedTrip() {
  return JSON.parse(sessionStorage.getItem('seoul-next-stop-trips-v2')!).trips[0]
}

it('로컬 만료도 후보 선택을 막고 현재 조건·과거 추천을 보존한다', async () => {
  vi.useFakeTimers()
  const trip = newState()
  trip.api = createServerTrip(trip.trip)
  trip.api.conditions = structuredClone(apiConditions)
  trip.api.version = 3
  trip.api.clarification = question()
  trip.api.clarification.origin_context!.expires_at = new Date(Date.now() + 1000).toISOString()
  const old = resultSnapshot(contextResult(), trip.api.tripId, 3)
  trip.groups = [old]
  trip.current = old.id
  sessionStorage.setItem(
    'seoul-next-stop-trips-v2',
    JSON.stringify({ schema: 2, trips: [trip], activeTripId: trip.trip }),
  )
  sessionStorage.setItem('seoul-start-screen-entered', '1')
  window.location.hash = '/chat'
  const { fetcher } = stubChat()
  render(
    <AppStateProvider>
      <ChatClarification />
    </AppStateProvider>,
  )
  expect(screen.getByRole('button', { name: '여기서 출발' })).toBeEnabled()
  await act(() => vi.advanceTimersByTimeAsync(1100))
  expect(screen.queryByRole('button', { name: '여기서 출발' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '출발지 다시 검색' }))
  expect(savedTrip().api.conditions).toEqual(apiConditions)
  expect(savedTrip().groups[0].id).toBe(old.id)
  expect(fetcher).not.toHaveBeenCalledWith(
    expect.stringContaining('/chat/messages'),
    expect.anything(),
  )
})

it('응답 유실은 원문을 중복 기록하지 않고 같은 ID·본문으로 재전송한다', async () => {
  const { bodies } = stubChat((req, index) =>
    index === 0 ? Promise.reject(new Error('offline')) : reply(req),
  )
  const hook = controller()
  await act(() => hook.result.current.submitChat('서울역에서 카페'))
  expect(hook.result.current.ui.apiFailure).toMatchObject({ kind: 'chat', canResend: true })
  await act(() => hook.result.current.retryRecommendation())
  expect(bodies[1]).toEqual(bodies[0])
  expect(hook.result.current.active.chat.filter((m) => m.role === 'user')).toHaveLength(1)
  expect(hook.result.current.ui.apiFailure).toBeNull()
})

it('동시 전송을 한 번만 실행하고 여행 전환 뒤의 실패 응답을 무시한다', async () => {
  let reject!: (error: Error) => void
  const { bodies } = stubChat(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const hook = controller()
  let pending!: Promise<boolean>
  act(() => {
    pending = hook.result.current.submitChat('첫 메시지')
    void hook.result.current.submitChat('중복 클릭')
  })
  expect(bodies).toHaveLength(1)
  act(() => hook.result.current.newTrip())
  await act(async () => {
    reject(new Error('late failure'))
    await pending
  })
  expect(hook.result.current.ui.apiFailure).toBeNull()
  expect(hook.result.current.ui.busy).toBe(false)
  expect(hook.result.current.active.api).toBeUndefined()
})

it('해석과 추천 대기 130초가 지나면 복구 가능한 실패를 표시하고 자동 재전송하지 않는다', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const hook = controller()
  let pending!: Promise<boolean>
  act(() => {
    pending = hook.result.current.submitChat('서울역에서 카페')
  })
  await act(() => vi.advanceTimersByTimeAsync(129000))
  expect(hook.result.current.ui.busy).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
    await pending
  })
  expect(hook.result.current.ui.apiFailure?.canResend).toBe(true)
  expect(hook.result.current.ui.busy).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('미적용 실패는 유효한 질문으로 새 ID를 사용하고, 적용 후 실패는 소모된 후보를 다시 선택하지 않는다', async () => {
  const { bodies } = stubChat((req, index) =>
    index === 0
      ? reply(req)
      : index === 1
        ? reply(req, 'failure', {}, 503)
        : index === 2
          ? reply(
              req,
              'failure',
              {
                condition_update: {
                  applied: true,
                  version: 1,
                  conditions: apiConditions,
                  changes: [],
                },
              },
              504,
            )
          : reply(req, 'recommendation', {
              result: contextResult(),
              condition_update: {
                applied: true,
                version: 1,
                conditions: apiConditions,
                changes: [],
              },
            }),
  )
  const hook = controller()
  await act(() => hook.result.current.submitChat('서울역에서 카페'))
  const action = {
    action: 'select' as const,
    context_token: hook.result.current.active.api!.clarification!.origin_context!.context_token,
    candidate_id: 'candidate-0',
  }
  await act(() => hook.result.current.submitChat('여기서 출발', { originAction: action }))
  await act(() => hook.result.current.retryRecommendation())
  expect(bodies[2].request_id).not.toBe(bodies[1].request_id)
  expect(bodies[2].origin_action).toEqual(action)
  expect(hook.result.current.active.api!.version).toBe(1)
  await act(() => hook.result.current.retryRecommendation())
  expect(bodies[3].condition_version).toBe(1)
  expect(bodies[3]).not.toHaveProperty('origin_action')
  expect(bodies[3]).not.toHaveProperty('pending_clarification')
  expect(hook.result.current.active.sequence).toBe(1)
})

it('선택 장소 질문에 결과 토큰을 전달하고 답변의 원래 시각·정보를 저장하며 추천을 재실행하지 않는다', async () => {
  const result = contextResult()
  result.context_expires_at = new Date(Date.now() + 1800000).toISOString()
  const { bodies } = stubChat((req, index) =>
    index === 0
      ? reply(req, 'recommendation', {
          result,
          condition_update: { applied: true, version: 1, conditions: apiConditions, changes: [] },
        })
      : reply(req, 'answer', {
          answer: {
            topic: 'recommendation_reason',
            place_id: result.cards[0].place.value!.place_id,
            original_result_id: result.result_id,
            original_recommended_at: result.created_at,
            checked_at: FIXTURE_TIME,
            text: '추천 당시 확인한 이유예요.',
            information: [result.cards[0].route],
          },
        }),
  )
  const hook = controller()
  await act(() => hook.result.current.submitChat('서울역에서 카페'))
  await act(() => hook.result.current.askSelectedPlace('왜 추천했어?'))
  expect(bodies[1].target).toEqual({
    result_id: result.result_id,
    place_id: result.cards[0].place.value!.place_id,
    context_token: result.context_token,
  })
  expect(bodies[1]).not.toHaveProperty('origin_action')
  expect(hook.result.current.active.sequence).toBe(1)
  expect(hook.result.current.active.chat.at(-1)?.answer?.information).toEqual([
    result.cards[0].route,
  ])
  expect(hook.result.current.result?.time).toBe(result.created_at)
})

it('최근 대화는 10개·각 500자까지만 보내고 너무 긴 새 메시지는 전송하지 않는다', async () => {
  const { bodies } = stubChat()
  const trip = newState()
  trip.chat = Array.from({ length: 14 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: '가'.repeat(520),
    time: FIXTURE_TIME,
  }))
  sessionStorage.setItem(
    'seoul-next-stop-trips-v2',
    JSON.stringify({ schema: 2, trips: [trip], activeTripId: trip.trip }),
  )
  const hook = controller()
  await act(() => hook.result.current.submitChat('나'.repeat(501)))
  expect(bodies).toHaveLength(0)
  await act(() => hook.result.current.submitChat('서울역'))
  expect(bodies[0].recent_messages).toHaveLength(10)
  expect(bodies[0].recent_messages!.every((m) => m.content.length === 500)).toBe(true)
  expect(bodies[0].recent_messages!.at(-1)?.content).not.toBe('서울역')
})

it.each(['general_candidates', 'no_candidates'] as const)(
  '%s 응답은 성공 추천 횟수를 늘리지 않는다',
  async (kind) => {
    const { bodies } = stubChat((req) =>
      reply(req, kind, {
        result: kind === 'general_candidates' ? contextResult() : null,
        condition_update: { applied: true, version: 1, conditions: apiConditions, changes: [] },
      }),
    )
    const hook = controller()
    await act(() => hook.result.current.submitChat('서울역에서 카페'))
    expect(hook.result.current.active.sequence).toBe(0)
    expect(hook.result.current.active.api?.version).toBe(1)
    expect(bodies).toHaveLength(1)
  },
)
