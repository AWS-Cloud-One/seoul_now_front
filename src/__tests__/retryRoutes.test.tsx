import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AppStateProvider from '../state/AppStateProvider'
import { useAppState } from '../state/useAppState'
import { apiConditions, contextResult, conversation } from '../api/testFixtures'
import { createServerTrip, displayConditions, resultSnapshot } from '../state/apiState'
import { newState } from '../lib/domain.js'
import type { RetryRoutesRequest } from '../api/contracts'
import type { Trip } from '../types/trip'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(cleanup)
function setup(changed = false, expired = false) {
  const trip = newState() as Trip
  const server = {
    ...createServerTrip(trip.trip),
    version: 3,
    conditions: structuredClone(apiConditions),
  }
  if (changed) server.conditions.headcount = 7
  const raw = contextResult()
  raw.context_expires_at = new Date(Date.now() + (expired ? -1 : 300000)).toISOString()
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
  trip.excluded = ['previously-excluded']
  sessionStorage.setItem(
    'seoul-next-stop-trips-v2',
    JSON.stringify({ schema: 2, trips: [trip], activeTripId: trip.trip }),
  )
  return { hook: renderHook(useAppState, { wrapper: AppStateProvider }), general }
}
function response(req: RetryRoutesRequest, kind = 'recommendation') {
  const raw = contextResult()
  raw.context_expires_at = new Date(Date.now() + 1800000).toISOString()
  return Response.json(
    conversation(req, {
      kind: kind as 'recommendation' | 'no_candidates',
      result: kind === 'no_candidates' ? null : raw,
      condition_update: {
        applied: false,
        version: req.condition_version,
        conditions: req.current_conditions,
        changes: [],
      },
    }),
  )
}
it('동일 조건이 더 높은 버전이어도 R02만 호출하여 같은 후보를 성공 추천으로 반영한다', async () => {
  const { hook, general } = setup()
  const fetcher = vi.fn(async (_url: string, options: RequestInit) =>
    response(JSON.parse(options.body as string)),
  )
  vi.stubGlobal('fetch', fetcher)
  await act(() => hook.result.current.retryRoute())
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/recommendations/retry-routes')
  const req = JSON.parse(fetcher.mock.calls[0][1].body as string)
  expect(req).toMatchObject({
    condition_version: 3,
    result_id: general.id,
    context_token: general.api!.result.context_token,
    current_conditions: apiConditions,
    excluded_place_ids: ['previously-excluded'],
  })
  expect(req).not.toHaveProperty('conditions_patch')
  expect(hook.result.current.active.api?.version).toBe(3)
  expect(hook.result.current.active.sequence).toBe(1)
  expect(hook.result.current.active.general).toBeNull()
})
it.each([
  [true, false],
  [false, true],
])('조건 변경 또는 만료는 R02를 보내지 않고 후보를 보존한다 (%s, %s)', async (changed, expired) => {
  const { hook, general } = setup(changed, expired)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await act(() => hook.result.current.retryRoute())
  expect(fetcher).not.toHaveBeenCalled()
  expect(hook.result.current.active.general).toEqual(general)
  expect(hook.result.current.ui.toast).not.toBe('')
})
it('R02 응답 유실·이중 클릭은 같은 실행으로 재전송하며 R01로 바뀌지 않는다', async () => {
  const { hook } = setup()
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('lost'))
    .mockImplementation(async (_url: string, options: RequestInit) =>
      response(JSON.parse(options.body as string)),
    )
  vi.stubGlobal('fetch', fetcher)
  await act(async () => {
    await Promise.all([hook.result.current.retryRoute(), hook.result.current.retryRoute()])
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(hook.result.current.ui.apiFailure?.kind).toBe('retry-routes')
  await act(() => hook.result.current.retryRecommendation())
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/recommendations/retry-routes')
  expect(hook.result.current.active.sequence).toBe(1)
})
it('확정 실패 재시도는 새 ID의 R02이며 후보 없음에서도 원래 후보·시각을 유지한다', async () => {
  const { hook, general } = setup()
  const fetcher = vi
    .fn()
    .mockImplementationOnce(async (_url: string, options: RequestInit) => {
      const req = JSON.parse(options.body as string)
      return Response.json(
        {
          ...conversation(req, {
            kind: 'failure',
            result: null,
            condition_update: {
              applied: false,
              version: req.condition_version,
              conditions: req.current_conditions,
              changes: [],
            },
          }),
          error: { code: 'PROVIDER_TIMEOUT', message: '시간 초과', retryable: true, details: [] },
        },
        { status: 504 },
      )
    })
    .mockImplementation(async (_url: string, options: RequestInit) =>
      response(JSON.parse(options.body as string), 'no_candidates'),
    )
  vi.stubGlobal('fetch', fetcher)
  await act(() => hook.result.current.retryRoute())
  await act(() => hook.result.current.retryRecommendation())
  const first = JSON.parse(fetcher.mock.calls[0][1].body),
    second = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(second.request_id).not.toBe(first.request_id)
  expect(second.result_id).toBe(first.result_id)
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/recommendations/retry-routes')
  expect(hook.result.current.active.general).toEqual(general)
  expect(hook.result.current.active.sequence).toBe(0)
})
it('여행을 바꾼 뒤 도착한 R02는 새 여행에 반영되지 않는다', async () => {
  const { hook } = setup()
  let finish!: (value: Response) => void, req!: RetryRoutesRequest
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      req = JSON.parse(options.body as string)
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    }),
  )
  let pending!: Promise<void>
  act(() => {
    pending = hook.result.current.retryRoute()
  })
  act(() => hook.result.current.newTrip())
  await act(async () => {
    finish(response(req))
    await pending
  })
  expect(hook.result.current.result).toBeNull()
  expect(hook.result.current.active.sequence).toBe(0)
  expect(hook.result.current.ui.busy).toBe(false)
})
