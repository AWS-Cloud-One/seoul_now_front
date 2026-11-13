import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RecommendPanel from '../components/recommendation/RecommendPanel'
import AppStateProvider from './AppStateProvider'
import { useAppState } from './useAppState'
import { newState, placeById } from '../lib/domain.js'
import { loadSavedTrips } from './savedTrips'
import { applyConversationResponse, createServerTrip, resultContextStatus } from './apiState'
import { RequestManager } from '../api/requestManager'
import { apiConditions, contextResult, conversation, FIXTURE_TIME } from '../api/testFixtures'
import type { ConversationData, RecommendationRequest } from '../api/contracts'

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
afterEach(cleanup)
const controller = () => renderHook(useAppState, { wrapper: AppStateProvider })
function stubReply(patch: Partial<ConversationData> = {}, status = 200) {
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string) as RecommendationRequest
    const body = conversation(request, patch)
    if (status >= 400)
      body.error = {
        code: 'ROUTE_FAILED',
        message: '경로 조회 실패',
        retryable: true,
        retry_after_seconds: 8,
        details: [],
      }
    return Response.json(body, { status })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
async function recommend(hook: ReturnType<typeof controller>) {
  await act(async () => {
    await hook.result.current.recommendFromApi({
      origin: apiConditions.origin!,
      purposes: apiConditions.purposes,
    })
  })
}
it('API 장소·조건·정보 상태·토큰을 보존하고 실제 카드 이름으로 저장·재시작 복원한다', async () => {
  const fetcher = stubReply()
  const first = controller()
  await recommend(first)
  const result = structuredClone(first.result.current.result!)
  const server = structuredClone(first.result.current.active.api!)
  expect(first.result.current.active.conditionVersion).toBe(1)
  expect(result.conditions.purposeKeywords).toEqual({ cafe: '커피', walk: '공원' })
  expect(result.api?.result.conditions.max_travel_seconds).toBe(1801)
  expect(result.api?.result.cards[0].route.freshness).toBe('unknown')
  expect(result.api?.result.cards[0].parking.total_count).toBeNull()
  expect(placeById(result.entries[0].id, result)?.name).toBe('API에서 받은 장소')
  expect(placeById(result.entries[0].id)).toBeUndefined()
  act(() => first.result.current.saveCurrentTrip())
  const savedId = first.result.current.savedTrips[0].id
  first.unmount()
  sessionStorage.clear()
  const restored = controller()
  act(() => restored.result.current.openSavedTrip(savedId))
  expect(restored.result.current.result).toEqual(result)
  expect(restored.result.current.active.api).toEqual(server)
  expect(resultContextStatus(result, Date.parse('2026-11-10T04:00:00+09:00'))).toBe('expired')
  expect(loadSavedTrips()).toHaveLength(1)
  restored.unmount()
  window.location.hash = '/recommend'
  render(<RecommendPanel go={vi.fn()} />, { wrapper: AppStateProvider })
  expect(screen.getByRole('button', { name: /1번 API에서 받은 장소 선택/ })).toBeTruthy()
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/v1/recommendations')).toHaveLength(1)
})

it('HTTP 실패여도 적용된 조건은 반영하고 카드·추천 시각과 성공 회차는 유지한다', async () => {
  stubReply()
  const hook = controller()
  await recommend(hook)
  const previous = structuredClone(hook.result.current.result)
  stubReply(
    {
      kind: 'failure',
      result: null,
      condition_update: {
        applied: true,
        version: 2,
        conditions: { ...apiConditions, headcount: 7 },
        changes: [],
      },
    },
    503,
  )
  await recommend(hook)
  expect(hook.result.current.active.api?.version).toBe(2)
  expect(hook.result.current.active.conditions.headcount).toBe(7)
  expect(hook.result.current.result).toEqual(previous)
  expect(hook.result.current.active.sequence).toBe(1)
  expect(hook.result.current.ui.apiFailure).toMatchObject({
    canResend: false,
    retryAfterSeconds: 8,
  })
})

it('조건 확인 초안을 확정 조건에 합치지 않으며 answer로 추천 요청을 추가하지 않는다', () => {
  const trip = newState()
  trip.api = createServerTrip(trip.trip)
  const manager = new RequestManager()
  const attempt = manager.start(
    { tripId: trip.trip, version: 0, resultId: null },
    '/chat/messages',
    {},
  )!
  const request = { request_id: attempt.requestId, trip_id: trip.api.tripId, condition_version: 0 }
  const original = structuredClone(trip.api.conditions)
  const envelope = conversation(request, {
    kind: 'clarification',
    result: null,
    condition_update: { applied: false, version: 0, conditions: apiConditions, changes: [] },
    clarification: {
      question: '출발지를 확인해 주세요.',
      required_fields: ['origin'],
      pending_patch: { headcount: 4 },
      choices: [],
      origin_context: {
        context_token: 'origin-token',
        mode: 'refine',
        preferred_candidate_id: null,
        expires_at: FIXTURE_TIME,
        search_limited: false,
      },
    },
  })
  expect(
    applyConversationResponse(trip, attempt, {
      ok: true,
      status: 200,
      envelope,
      retryAfterSeconds: null,
    }),
  ).toBe(true)
  expect(trip.api.conditions).toEqual(original)
  expect(trip.api.clarification).toEqual(envelope.data?.clarification)
  expect(trip.groups).toEqual([])
  expect(trip.conditionVersion).toBe(0)
})

it('보류·취소 안내는 추가 질문만 닫고 확정 조건과 대화 기록을 유지한다', () => {
  const trip = newState()
  trip.api = createServerTrip(trip.trip)
  trip.api.clarification = {
    question: '정확한 인원을 알려 주세요.',
    required_fields: ['headcount'],
    pending_patch: { max_travel_seconds: 1200 },
    choices: [],
    origin_context: null,
  }
  const original = structuredClone(trip.api.conditions)
  const manager = new RequestManager()
  const attempt = manager.start(
    { tripId: trip.trip, version: 0, resultId: null },
    '/chat/messages',
    {},
  )!
  const envelope = conversation(
    { request_id: attempt.requestId, trip_id: trip.api.tripId, condition_version: 0 },
    {
      kind: 'answer',
      result: null,
      clarification: null,
      pending_update: 'clear',
      condition_update: { applied: false, version: 0, conditions: original, changes: [] },
      answer: {
        topic: 'conversation',
        place_id: null,
        text: '조건 확인을 보류했어요.',
        original_result_id: null,
        original_recommended_at: null,
        checked_at: null,
        information: [],
      },
    },
  )
  expect(
    applyConversationResponse(trip, attempt, {
      ok: true,
      status: 200,
      envelope,
      retryAfterSeconds: null,
    }),
  ).toBe(true)
  expect(trip.api.clarification).toBeNull()
  expect(trip.api.conditions).toEqual(original)
  expect(trip.conditionVersion).toBe(0)
  expect(trip.chat.at(-1)?.text).toBe('조건 확인을 보류했어요.')
  expect(trip.groups).toEqual([])
})

it('일반 후보·빈 결과는 성공 이력을 늘리지 않고 기존 결과를 유지한다', async () => {
  stubReply()
  const hook = controller()
  await recommend(hook)
  const count = hook.result.current.active.api!.seenPlaceIds.length
  const general = contextResult()
  general.cards[0].route = { ...general.cards[0].route, status: 'error', value: null }
  stubReply({ kind: 'general_candidates', result: general })
  await recommend(hook)
  const previous = structuredClone(hook.result.current.result)
  expect(hook.result.current.active.sequence).toBe(1)
  expect(hook.result.current.active.api?.seenPlaceIds).toHaveLength(count)
  expect(previous?.entries[0].eta).toBeNull()
  stubReply({ kind: 'no_candidates', result: null })
  await recommend(hook)
  expect(hook.result.current.result).toEqual(previous)
  expect(hook.result.current.active.sequence).toBe(1)
})

it('표시 이력이 5개로 잘려도 전체 API 제외 이력을 다음 요청에 보낸다', async () => {
  const hook = controller()
  for (let i = 0; i < 6; i++) {
    stubReply({ result: contextResult(undefined, 'provider-' + i) })
    await recommend(hook)
  }
  expect(hook.result.current.active.groups).toHaveLength(5)
  expect(hook.result.current.active.api?.seenPlaceIds).toHaveLength(6)
  const fetcher = stubReply({ kind: 'no_candidates', result: null })
  await recommend(hook)
  const request = JSON.parse(fetcher.mock.calls[0][1].body as string)
  expect(request.excluded_place_ids).toContain('provider-0')
})

it('과거 결과와 저장본을 열어도 최신 서버 조건·버전을 되돌리거나 증가시키지 않는다', async () => {
  stubReply()
  const hook = controller()
  await recommend(hook)
  const first = hook.result.current.result!
  act(() => hook.result.current.saveCurrentTrip())
  const savedId = hook.result.current.savedTrips[0].id
  stubReply({
    condition_update: {
      applied: true,
      version: 2,
      conditions: { ...apiConditions, headcount: 9 },
      changes: [],
    },
  })
  await recommend(hook)
  act(() => hook.result.current.activateResult(first.id))
  expect(hook.result.current.result?.id).toBe(first.id)
  expect(hook.result.current.active.api?.version).toBe(2)
  expect(hook.result.current.active.conditions.headcount).toBe(9)
  act(() => hook.result.current.openSavedTrip(savedId))
  expect(hook.result.current.active.conditionVersion).toBe(2)
  expect(hook.result.current.active.conditions.headcount).toBe(9)
})

it('응답 유실 재전송은 같은 요청 ID·본문을 사용하고 추천은 한 번만 추가한다', async () => {
  const hook = controller()
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockImplementation(async (_url: string, options: RequestInit) =>
      Response.json(conversation(JSON.parse(options.body as string))),
    )
  vi.stubGlobal('fetch', fetcher)
  await recommend(hook)
  expect(hook.result.current.ui.apiFailure?.canResend).toBe(true)
  await act(async () => {
    await hook.result.current.retryApiRequest()
  })
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
  expect(hook.result.current.active.sequence).toBe(1)
})

it('여행 전환은 요청을 취소하고 취소를 무시한 늦은 응답도 적용하지 않는다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () =>
      new Promise<Response>((done) => {
        resolve = done
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const hook = controller()
  let pending!: Promise<void>
  act(() => {
    pending = hook.result.current.recommendFromApi({ headcount: 4 })
  })
  const options = fetcher.mock.calls[0][1]
  const request = JSON.parse(options.body as string)
  act(() => hook.result.current.newTrip())
  expect(options.signal!.aborted).toBe(true)
  await act(async () => {
    resolve(Response.json(conversation(request)))
    await pending
  })
  expect(hook.result.current.active.api).toBeUndefined()
  expect(hook.result.current.result).toBeNull()
  expect(hook.result.current.ui.busy).toBe(false)
})

it('data 없는 422는 기존 상태를 보존하며, 다른 요청의 응답은 재전송 가능한 오류로 처리한다', async () => {
  const hook = controller()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      const request = JSON.parse(options.body as string)
      return Response.json(
        {
          request_id: request.request_id,
          server_time: FIXTURE_TIME,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: '잘못된 입력',
            retryable: false,
            details: [],
          },
        },
        { status: 422 },
      )
    }),
  )
  await recommend(hook)
  expect(hook.result.current.active.api?.version).toBe(0)
  expect(hook.result.current.ui.apiFailure?.canResend).toBe(false)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        conversation({
          request_id: crypto.randomUUID(),
          trip_id: hook.result.current.active.api!.tripId,
          condition_version: 0,
        }),
      ),
    ),
  )
  await recommend(hook)
  expect(hook.result.current.ui.apiFailure?.canResend).toBe(true)
  expect(hook.result.current.active.groups).toHaveLength(0)
  act(() => hook.result.current.newTrip())
  expect(hook.result.current.ui.apiFailure).toBeNull()
})
it('카드가 손상된 응답은 조건을 일부 적용하지 않고 원래 요청 재전송을 보존한다', async () => {
  const malformed = contextResult()
  malformed.cards[0].place.value!.coordinates.latitude = Number.NaN
  stubReply({ result: malformed })
  const hook = controller()
  await recommend(hook)
  expect(hook.result.current.active.api?.version).toBe(0)
  expect(hook.result.current.active.groups).toHaveLength(0)
  expect(hook.result.current.ui.apiFailure?.canResend).toBe(true)
})
