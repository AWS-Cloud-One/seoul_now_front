import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
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
async function chatScreen() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '시작하기' }))
  await user.click(screen.getByRole('button', { name: 'AI 대화' }))
  return user
}
async function send(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' }), text)
  await user.click(screen.getByRole('button', { name: '보내기' }))
}
function savedTrip() {
  return JSON.parse(sessionStorage.getItem('seoul-next-stop-trips-v2')!).trips[0]
}

it('선택 카드 문맥을 일반 채팅에도 보내고 기존 이유와 새 추천을 함께 표시한다', async () => {
  const oldResult = contextResult()
  oldResult.context_expires_at = new Date(Date.now() + 1800000).toISOString()
  const nextResult = contextResult()
  const explanation = '이전 카드는 당시 이동시간을 고려해 추천했어요.'
  const answer: NonNullable<ConversationData['answer']> = {
    topic: 'recommendation_reason',
    place_id: oldResult.cards[0].place.value!.place_id,
    text: explanation,
    original_result_id: oldResult.result_id,
    original_recommended_at: FIXTURE_TIME,
    checked_at: null,
    information: [],
  }
  const { bodies } = stubChat((req, index) =>
    reply(req, 'recommendation', {
      result: index === 0 ? oldResult : nextResult,
      condition_update: {
        applied: true,
        version: index + 1,
        conditions: { ...apiConditions, headcount: index === 0 ? 2 : 4 },
        changes: [],
      },
      message: index === 0 ? '추천했어요.' : explanation + '\n\n4명으로 새로 추천했어요.',
      ...(index === 0
        ? {}
        : {
            task_results: [
              {
                task_id: 'reason-1',
                topic: 'recommendation_reason',
                status: 'completed',
                message: explanation,
                answer,
                error_code: null,
                retryable: false,
              },
            ],
          }),
    }),
  )
  const user = await chatScreen()
  await send(user, '서울역에서 카페')
  await screen.findByRole('button', { name: '이 추천 보기' })
  await send(user, '왜 추천했어? 그리고 4명으로 바꿔줘')
  const region = screen.getByRole('log', { name: 'AI 대화 기록' })
  expect(region.textContent).toContain(explanation)
  expect(region.textContent).toContain('4명으로 새로 추천')
  expect(bodies[1].target).toEqual({
    result_id: oldResult.result_id,
    place_id: oldResult.cards[0].place.value!.place_id,
    context_token: oldResult.context_token,
  })
  expect(savedTrip().api.conditions.headcount).toBe(4)
  expect(savedTrip().chat.at(-1).taskResults[0].answer.original_result_id).toBe(oldResult.result_id)
  expect(bodies).toHaveLength(2)
})

it('추천이 적용돼도 미해결 정보 질문을 유지하고 원래 작업 결과를 표시한다', async () => {
  const message = '추천 이유를 확인할 대상 카드를 선택해 주세요.'
  stubChat((req) =>
    reply(req, 'recommendation', {
      result: contextResult(),
      condition_update: { applied: true, version: 1, conditions: apiConditions, changes: [] },
      message: message + '\n\n4명으로 추천했어요.',
      task_results: [
        {
          task_id: 'pending-reason',
          topic: 'recommendation_reason',
          status: 'needs_input',
          message,
          answer: null,
          error_code: null,
          retryable: false,
        },
      ],
      task_clarification: {
        question: message,
        required_fields: ['target'],
        pending_patch: {},
        choices: [],
        origin_context: null,
      },
    }),
  )
  const user = await chatScreen()
  await send(user, '4명으로 바꾸고 이유도 알려줘')
  expect(screen.getByRole('log', { name: 'AI 대화 기록' }).textContent).toContain(message)
  expect(savedTrip().api.clarification.required_fields).toEqual(['target'])
  expect(savedTrip().api.conditions.headcount).toBe(4)
})

it('처음부터 대화→확인→후보 선택→추가 인원→추천을 C01만으로 연결하고 서버 조건만 적용한다', async () => {
  const questions = [
    question(),
    question('choose', 'b'.repeat(43)),
    question('confirmed', 'c'.repeat(43)),
  ]
  const { bodies } = stubChat((req, index) =>
    index < 3
      ? reply(req, 'clarification', { clarification: questions[index] })
      : reply(req, 'recommendation', {
          result: contextResult(),
          condition_update: { applied: true, version: 1, conditions: apiConditions, changes: [] },
        }),
  )
  const user = await chatScreen()
  await send(user, '서울역에서 카페, 3~4명')
  await screen.findByRole('button', { name: '여기서 출발' })
  expect(savedTrip().api.conditions.origin).toBeNull()
  expect(savedTrip().api.version).toBe(0)
  expect(bodies[0].recent_messages).toEqual([])
  expect(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' })).toHaveValue('')
  await user.click(screen.getByRole('button', { name: '다른 후보 보기' }))
  const choices = await screen.findByRole('list', { name: '출발지 후보' })
  expect(
    within(choices)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining('1. 서울역'),
      expect.stringContaining('2. 강남역'),
    ]),
  )
  expect(bodies[1].origin_action).toEqual({
    action: 'show_alternatives',
    context_token: questions[0].origin_context!.context_token,
  })
  await user.click(within(choices).getAllByRole('button')[1])
  await screen.findByText(/확인한 출발지/)
  expect(screen.queryByRole('button', { name: '여기서 출발' })).not.toBeInTheDocument()
  expect(bodies[2].origin_action).toEqual({
    action: 'select',
    context_token: questions[1].origin_context!.context_token,
    candidate_id: 'candidate-1',
  })
  expect(bodies[2]).not.toHaveProperty('conditions_patch')
  expect(bodies[2]).not.toHaveProperty('target')
  expect(savedTrip().api.conditions.origin).toBeNull()
  await send(user, '4명')
  await screen.findByRole('button', { name: '이 추천 보기' })
  expect(bodies[3].pending_clarification).toEqual(questions[2])
  expect(bodies[3]).not.toHaveProperty('origin_action')
  expect(savedTrip().api.conditions).toEqual(apiConditions)
  expect(savedTrip().sequence).toBe(1)
  expect(savedTrip().api.clarification).toBeNull()
  expect(bodies).toHaveLength(4)
  await user.click(screen.getByRole('button', { name: '이 추천 보기' }))
  expect(
    await screen.findByRole('button', { name: '1번 API에서 받은 장소 선택' }),
  ).toBeInTheDocument()
})

it('후보 한 개도 자동 확정하지 않으며 다시 입력은 후보 ID 없이 보내고 최신 질문으로 교체한다', async () => {
  const one = question()
  one.choices = one.choices.slice(0, 1)
  const refined = question('refine', 'r'.repeat(43))
  const { bodies } = stubChat((req, index) =>
    reply(req, 'clarification', { clarification: index === 0 ? one : refined }),
  )
  const user = await chatScreen()
  await send(user, '서울역에서 카페')
  await screen.findByRole('button', { name: '여기서 출발' })
  expect(bodies).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '다시 입력' }))
  await screen.findByRole('button', { name: '출발지 입력하기' })
  expect(bodies[1].origin_action).toEqual({
    action: 'restart',
    context_token: one.origin_context!.context_token,
  })
  expect(screen.queryByRole('button', { name: '여기서 출발' })).not.toBeInTheDocument()
  await send(user, '수원역에서 출발')
  expect(bodies[2].pending_clarification).toEqual(refined)
  expect(bodies[2]).not.toHaveProperty('origin_action')
})

it('서버에서 질문이 만료되면 기존 조건을 유지하고 새 검색에 이전 토큰을 붙이지 않는다', async () => {
  const { bodies } = stubChat((req, index) =>
    index === 1 ? reply(req, 'failure', {}, 410) : reply(req),
  )
  const user = await chatScreen()
  await send(user, '서울역에서 카페')
  await user.click(await screen.findByRole('button', { name: '여기서 출발' }))
  await screen.findByRole('button', { name: '출발지 다시 검색' })
  expect(savedTrip().api.version).toBe(0)
  await user.click(screen.getByRole('button', { name: '출발지 다시 검색' }))
  await send(user, '강남역에서 카페')
  expect(bodies[2]).not.toHaveProperty('origin_action')
  expect(bodies[2]).not.toHaveProperty('pending_clarification')
  expect(bodies[2].trip_id).toBe(bodies[0].trip_id)
  expect(bodies[2].request_id).not.toBe(bodies[0].request_id)
})

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
