import { afterEach, expect, it, vi } from 'vitest'
import { ApiTransportError, createApiClient } from './client'
import { conversation, FIXTURE_TIME } from './testFixtures'
const client = createApiClient('/api/v1/')
const error = {
  code: 'RATE_LIMITED',
  message: '잠시 후 시도해 주세요.',
  retryable: true,
  retry_after_seconds: 3,
  details: [],
}
afterEach(() => vi.useRealTimers())

it('503에서도 이미 적용된 조건과 오류·Retry-After를 보존하며 자동 재시도하지 않는다', async () => {
  const body = conversation({
    request_id: crypto.randomUUID(),
    trip_id: crypto.randomUUID(),
    condition_version: 0,
  })
  body.error = error
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json(body, { status: 503, headers: { 'Retry-After': '7' } }))
  vi.stubGlobal('fetch', fetcher)
  const response = await client.request('/recommendations', { method: 'POST', body: '{}' })
  expect(response).toMatchObject({ status: 503, ok: false, envelope: body, retryAfterSeconds: 7 })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/recommendations')
})

it('data가 null인 검증 오류와 HTTP 날짜 형식의 재시도 시각을 읽는다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        {
          request_id: crypto.randomUUID(),
          server_time: FIXTURE_TIME,
          data: null,
          error,
        },
        { status: 422, headers: { 'Retry-After': 'Mon, 09 Nov 2026 18:00:12 GMT' } },
      ),
    ),
  )
  const response = await client.request('/locations/search', {
    query: { query: '', limit: 10, cursor: undefined },
  })
  expect(response.envelope.data).toBeNull()
  expect(response.retryAfterSeconds).toBe(12)
})

it.each([
  new Response('<html>proxy failure</html>', { status: 502 }),
  Response.json({ detail: 'old API contract' }, { status: 400 }),
])('봉투 없는 오류를 성공으로 처리하지 않는다', async (response) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  await expect(client.request('/recommendations')).rejects.toMatchObject({ kind: 'protocol' })
})

it('호출자의 요청 취소를 전파하고 네트워크 실패로 바꾸지 않는다', async () => {
  const abort = new AbortController()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) =>
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason)),
        ),
    ),
  )
  const pending = client.request('/places/123', {
    signal: abort.signal,
    headers: { 'Result-Context': 'token' },
  })
  abort.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})

it('응답 본문 대기도 제한 시간에 포함한다', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options: RequestInit) => ({
      json: () =>
        new Promise((_resolve, reject) =>
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason)),
        ),
    })),
  )
  const pending = client.request('/recommendations', { timeoutMs: 100 })
  const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
  await vi.advanceTimersByTimeAsync(100)
  await assertion
})
it('네트워크 오류는 응답 여부 불명 상태로 구분한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  await expect(client.request('/recommendations')).rejects.toBeInstanceOf(ApiTransportError)
})
