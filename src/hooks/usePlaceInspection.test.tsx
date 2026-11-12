import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlaceInspection } from './usePlaceInspection'
import { apiConditions, contextResult, conversation, information } from '../api/testFixtures'
import { createServerTrip, displayConditions, resultSnapshot } from '../state/apiState'
import type { PlaceDetailData, TravelTimeData, TravelTimeRequest } from '../api/contracts'
import { useAppState } from '../state/useAppState'
import AppStateProvider from '../state/AppStateProvider'
import RecommendPanel from '../components/recommendation/RecommendPanel'
import { newState } from '../lib/domain.js'
import type { Result, Trip } from '../types/trip'

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
const checked = '2026-11-10T05:00:00+09:00'
function fixture() {
  const server = {
    ...createServerTrip(crypto.randomUUID()),
    version: 4,
    conditions: structuredClone(apiConditions),
  }
  const raw = contextResult(crypto.randomUUID(), 'kakao:123/456')
  raw.context_expires_at = new Date(Date.now() + 300000).toISOString()
  const result = resultSnapshot(raw, server.tripId, 1)
  const detail: PlaceDetailData = {
    result_id: result.id,
    place: raw.cards[0].place,
    parking: raw.cards[0].parking,
    original_recommended_at: raw.created_at,
    checked_at: checked,
  }
  return { server, result, detail, placeId: result.entries[0].id }
}
function envelope<T>(data: T | null, requestId: string = crypto.randomUUID()) {
  return { request_id: requestId, server_time: checked, data, error: null }
}
function travelReply(req: TravelTimeRequest): TravelTimeData {
  return {
    trip_id: req.trip_id,
    base_condition_version: req.condition_version,
    result_id: req.result_id,
    place_id: 'kakao:123/456',
    checked_at: checked,
    original_recommended_at: null,
    route: information({ duration_seconds: 901, distance_meters: 2300 }),
  }
}
const hookFor = (f: ReturnType<typeof fixture>) =>
  renderHook(() => usePlaceInspection(f.result, f.server, f.placeId))
function seed(result: Result, version = 4, general = false) {
  const trip = newState() as Trip
  trip.api = {
    ...createServerTrip(result.api!.tripId),
    version,
    conditions: structuredClone(apiConditions),
    seenPlaceIds: general ? [] : [result.entries[0].id],
  }
  trip.conditions = displayConditions(trip.api.conditions)
  trip.onboardingComplete = true
  trip.groups = general ? [] : [result]
  trip.general = general ? result : null
  trip.current = general ? null : result.id
  trip.selected = result.entries[0].id
  trip.sequence = general ? 0 : 1
  sessionStorage.setItem(
    'seoul-next-stop-trips-v2',
    JSON.stringify({ schema: 2, trips: [trip], activeTripId: trip.trip }),
  )
  return trip
}

it('P01은 헤더로 문맥을 보내고 P03은 최신 조건 버전·과거 결과를 사용하며 원본을 바꾸지 않는다', async () => {
  const f = fixture(),
    original = structuredClone(f.result)
  const calls: { url: string; options: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, options })
      if (options.method === 'GET') return Response.json(envelope(f.detail))
      const req = JSON.parse(options.body as string)
      return Response.json(envelope(travelReply(req), req.request_id))
    }),
  )
  const hook = hookFor(f)
  await waitFor(() => expect(hook.result.current.detail.data).toEqual(f.detail))
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe('/api/v1/places/kakao%3A123%2F456')
  expect(new Headers(calls[0].options.headers).get('Result-Context')).toBe(
    f.result.api!.result.context_token,
  )
  expect(calls[0].url).not.toContain('token')
  await act(() => hook.result.current.loadTravel())
  const body = JSON.parse(calls[1].options.body as string)
  expect(body.condition_version).toBe(4)
  expect(body.result_id).toBe(f.result.id)
  expect(body).not.toHaveProperty('current_conditions')
  expect(hook.result.current.travel.data?.route.value?.duration_seconds).toBe(901)
  expect(f.result).toEqual(original)
})

it('P03 응답 유실은 같은 ID·본문을 재전송하고 연속 클릭은 한 번만 실행한다', async () => {
  const f = fixture(),
    bodies: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === 'GET') return Response.json(envelope(f.detail))
      bodies.push(options.body as string)
      if (bodies.length === 1) throw new TypeError('lost')
      const req = JSON.parse(options.body as string)
      return Response.json(envelope(travelReply(req), req.request_id))
    }),
  )
  const hook = hookFor(f)
  await waitFor(() => expect(hook.result.current.detail.busy).toBe(false))
  await act(async () => {
    await Promise.all([hook.result.current.loadTravel(), hook.result.current.loadTravel()])
  })
  expect(bodies).toHaveLength(1)
  expect(hook.result.current.travel.failure?.canResend).toBe(true)
  await act(() => hook.result.current.loadTravel())
  expect(bodies[1]).toBe(bodies[0])
  expect(hook.result.current.travel.failure).toBeNull()
})

it('P03 429는 대기 후 새 ID로 재시도하고 마지막 조회값은 실패로 덮어쓰지 않는다', async () => {
  const f = fixture(),
    bodies: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === 'GET') return Response.json(envelope(f.detail))
      bodies.push(options.body as string)
      const req = JSON.parse(options.body as string)
      if (bodies.length === 2)
        return Response.json(
          {
            ...envelope(null, req.request_id),
            error: {
              code: 'RATE_LIMITED',
              message: '잠시 기다려 주세요.',
              retryable: true,
              retry_after_seconds: 5,
              details: [],
            },
          },
          { status: 429 },
        )
      return Response.json(envelope(travelReply(req), req.request_id))
    }),
  )
  const hook = hookFor(f)
  await waitFor(() => expect(hook.result.current.detail.data).not.toBeNull())
  await act(() => hook.result.current.loadTravel())
  const original = hook.result.current.travel.data
  await act(() => hook.result.current.loadTravel())
  expect(hook.result.current.travel.data).toEqual(original)
  await act(() => hook.result.current.loadTravel())
  expect(bodies).toHaveLength(2)
  vi.useFakeTimers()
  act(() => vi.advanceTimersByTime(5001))
  await act(() => hook.result.current.loadTravel())
  expect(JSON.parse(bodies[2]).request_id).not.toBe(JSON.parse(bodies[1]).request_id)
})

it('로컬 만료는 모든 현재 조회를 막고 서버 410에서도 저장된 카드와 시각은 남는다', async () => {
  const f = fixture()
  f.result.api!.result.context_expires_at = new Date(Date.now() - 1).toISOString()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const expired = hookFor(f)
  await act(() => expired.result.current.loadTravel())
  expect(fetcher).not.toHaveBeenCalled()
  expect(expired.result.current.contextError).toContain('원래 조회 시각')
  expired.unmount()
  f.result.api!.result.context_expires_at = new Date(Date.now() + 300000).toISOString()
  fetcher.mockResolvedValue(
    Response.json(
      {
        ...envelope(null),
        error: { code: 'CONTEXT_EXPIRED', message: '문맥 만료', retryable: false, details: [] },
      },
      { status: 410 },
    ),
  )
  const serverExpired = hookFor(f)
  await waitFor(() => expect(serverExpired.result.current.contextError).toContain('문맥 만료'))
  await act(() => serverExpired.result.current.loadTravel())
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(f.result.entries[0].reason).toBe('서버가 보존한 추천 근거')
})

it('상세를 닫으면 진행 중인 P01/P03을 취소하고 다른 문맥 응답을 표시하지 않는다', async () => {
  const f = fixture(),
    signals: AbortSignal[] = []
  let resolveTravel!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal)
      if (options.method === 'GET') return Response.json(envelope(f.detail))
      return new Promise<Response>((resolve) => {
        resolveTravel = resolve
      })
    }),
  )
  const hook = hookFor(f)
  await waitFor(() => expect(hook.result.current.detail.data).not.toBeNull())
  let pending!: Promise<void>
  act(() => {
    pending = hook.result.current.loadTravel()
  })
  hook.unmount()
  expect(signals[1].aborted).toBe(true)
  await act(async () => {
    resolveTravel(Response.json(envelope(null)))
    await pending
  })
  const wrong = { ...f.detail, result_id: 'another-result' }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(envelope(wrong))),
  )
  const next = hookFor(f)
  await waitFor(() => expect(next.result.current.detail.failure).not.toBeNull())
  expect(next.result.current.detail.data).toBeNull()
})

it('상세 화면은 실제 출처·현재 조회와 당시 근거를 나누고 현재 인구 질문에 target을 보낸다', async () => {
  const f = fixture()
  seed(f.result)
  const calls: { url: string; body: Record<string, unknown> | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      const req = options.body ? JSON.parse(options.body as string) : null
      calls.push({ url, body: req })
      if (url.endsWith('/chat/messages'))
        return Response.json(
          conversation(req, {
            kind: 'answer',
            result: null,
            condition_update: {
              applied: false,
              version: 4,
              conditions: apiConditions,
              changes: [],
            },
            answer: {
              topic: 'population',
              place_id: f.placeId,
              text: '현재 관측 미확인',
              checked_at: checked,
              original_result_id: f.result.id,
              original_recommended_at: f.result.time,
              information: [],
            },
          }),
        )
      return Response.json(envelope(f.detail))
    }),
  )
  function View() {
    const controller = useAppState()
    return (
      <>
        <button onClick={() => controller.openDetail(f.placeId)}>상세 열기</button>
        <RecommendPanel go={vi.fn()} />
      </>
    )
  }
  render(
    <AppStateProvider>
      <View />
    </AppStateProvider>,
  )
  fireEvent.click(screen.getByText('상세 열기'))
  await screen.findByText(/상세 확인:/)
  expect(screen.queryByText(/모의 장소|예시 경로/)).not.toBeInTheDocument()
  expect(screen.getByText('아직 현재 이동시간을 조회하지 않았어요.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '주변 현재 인구 현황 알려줘' }))
  await waitFor(() => expect(calls.some((call) => call.url.endsWith('/chat/messages'))).toBe(true))
  const chat = calls.find((call) => call.url.endsWith('/chat/messages'))!.body!
  expect(chat.target).toEqual({
    place_id: f.placeId,
    result_id: f.result.id,
    context_token: f.result.api!.result.context_token,
  })
})

it('만료된 실제 장소 저장본은 재시작 후 복원되며 자동 조회·재추천이나 토큰 연장이 없다', async () => {
  const f = fixture()
  f.result.api!.result.context_expires_at = new Date(Date.now() - 1).toISOString()
  seed(f.result)
  const first = renderHook(useAppState, { wrapper: AppStateProvider })
  act(() => first.result.current.saveCurrentTrip())
  const savedId = first.result.current.savedTrips[0].id
  first.unmount()
  sessionStorage.clear()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const restored = renderHook(useAppState, { wrapper: AppStateProvider })
  act(() => restored.result.current.openSavedTrip(savedId))
  expect(restored.result.current.result).toEqual(f.result)
  expect(restored.result.current.active.api?.version).toBe(4)
  const inspection = renderHook(() =>
    usePlaceInspection(
      restored.result.current.result!,
      restored.result.current.active.api!,
      f.placeId,
    ),
  )
  await act(() => inspection.result.current.loadTravel())
  expect(fetcher).not.toHaveBeenCalled()
  expect(inspection.result.current.contextError).not.toBeNull()
})

it('동시 조회 중 문맥이 만료되면 두 조회의 진행 표시를 끝내고 늦은 응답을 버린다', async () => {
  const f = fixture()
  let resolveDetail!: (response: Response) => void, resolveTravel!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          if (options.method === 'GET') resolveDetail = resolve
          else resolveTravel = resolve
        }),
    ),
  )
  const hook = hookFor(f)
  let pending!: Promise<void>
  act(() => {
    pending = hook.result.current.loadTravel()
  })
  await act(async () => {
    resolveDetail(
      Response.json(
        {
          ...envelope(null),
          error: { code: 'CONTEXT_EXPIRED', message: '문맥 만료', retryable: false, details: [] },
        },
        { status: 410 },
      ),
    )
  })
  expect(hook.result.current.contextError).toContain('문맥 만료')
  expect(hook.result.current.detail.busy).toBe(false)
  expect(hook.result.current.travel.busy).toBe(false)
  await act(async () => {
    resolveTravel(Response.json(envelope(null)))
    await pending
  })
  expect(hook.result.current.travel.data).toBeNull()
})

it.each(['timer', 'response'] as const)(
  '조회 도중 만료되면 진행 표시를 끝내고 늦은 성공을 버린다 (%s)',
  async (trigger) => {
    vi.useFakeTimers()
    const f = fixture()
    f.result.api!.result.context_expires_at = new Date(Date.now() + 1000).toISOString()
    const replies: {
      finish: (response: Response) => void
      signal: AbortSignal
      request: TravelTimeRequest | null
    }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((finish) => {
            replies.push({
              finish,
              signal: options.signal as AbortSignal,
              request: options.body ? JSON.parse(options.body as string) : null,
            })
          }),
      ),
    )
    const hook = hookFor(f)
    let pending!: Promise<void>
    act(() => {
      pending = hook.result.current.loadTravel()
    })
    if (trigger === 'timer') {
      await act(() => vi.advanceTimersByTimeAsync(1250))
      expect(hook.result.current.detail.busy).toBe(false)
      expect(hook.result.current.travel.busy).toBe(false)
      expect(replies.every((reply) => reply.signal.aborted)).toBe(true)
    } else {
      // A background tab can delay the expiry timer past the response arrival.
      vi.setSystemTime(Date.now() + 1250)
    }
    await act(async () => {
      replies[0].finish(Response.json(envelope(f.detail)))
      replies[1].finish(
        Response.json(envelope(travelReply(replies[1].request!), replies[1].request!.request_id)),
      )
      await pending
    })
    expect(hook.result.current.contextError).not.toBeNull()
    expect(hook.result.current.detail.busy).toBe(false)
    expect(hook.result.current.travel.busy).toBe(false)
    if (trigger === 'timer') expect(replies.every((reply) => reply.signal.aborted)).toBe(true)
    expect(hook.result.current.detail.data).toBeNull()
    expect(hook.result.current.travel.data).toBeNull()
  },
)
