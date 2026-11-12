import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiClient, type ApiRequestOptions, type ApiResponse } from './client'
import { mapGeometry, mapLayer, clearMapCache } from './mapLayers'
import { bufferedViewport, containsViewport } from './mapViewport'
import { type MapGeometry, type MapQuery } from './queries'
import { apiParkingSource } from './parking/source'

vi.mock('./client', () => ({ apiClient: { request: vi.fn() } }))
const viewport: MapQuery = { bbox: [126.95, 37.54, 127.03, 37.59], level: 6 }
const moved: MapQuery = { bbox: [126.951, 37.541, 127.031, 37.591], level: 6 }
const signal = () => new AbortController().signal
const request = vi.mocked(apiClient.request)
let version = 'v1'

function reply(path: string, options: ApiRequestOptions = {}, ageSeconds: number | null = 0) {
  const query = options.query!
  const data = {
    layer: path.split('/')[3],
    bbox: String(query.bbox).split(',').map(Number) as MapQuery['bbox'],
    level: Number(query.level),
    geometry_version: version,
    coverage: 'stored',
    ...(path.endsWith('/status')
      ? { status: 'ok', items: [] }
      : { feature_collection: { type: 'FeatureCollection', features: [] } }),
  }
  return {
    status: 200,
    ok: true,
    retryAfterSeconds: null,
    envelope: { data, error: null, request_id: 'test', server_time: new Date().toISOString() },
    cache: { ageSeconds, elapsedMs: 0 },
  }
}
function failure(code: string, status: number) {
  return {
    status,
    ok: false,
    retryAfterSeconds: null,
    envelope: {
      data: null,
      request_id: 'test',
      server_time: new Date().toISOString(),
      error: { code, message: code, retryable: false, details: [] },
    },
  }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
  version = 'v1'
  request.mockReset().mockImplementation(async (path, options) => reply(path, options))
})
afterEach(() => {
  clearMapCache()
  vi.useRealTimers()
})

it('작은 이동은 같은 위치 범위를 재사용하고 경계 밖 이동과 확대 변경은 다시 조회한다', async () => {
  const first = await mapGeometry('roads', viewport, signal())
  expect(first.bbox).toEqual(bufferedViewport(viewport).bbox)
  expect(containsViewport(first, moved)).toBe(true)
  expect(await mapGeometry('roads', moved, signal())).toBe(first)
  expect(request).toHaveBeenCalledTimes(1)
  await mapGeometry('roads', { ...viewport, bbox: [127.1, 37.6, 127.15, 37.65] }, signal())
  await mapGeometry('roads', { ...viewport, level: 5 }, signal())
  expect(request).toHaveBeenCalledTimes(3)
})

it('여유 범위는 소수점 직렬화 후에도 화면을 덮고 세계 좌표 한계를 넘지 않는다', () => {
  for (const bbox of [
    [126.123456, 37.123456, 126.234567, 37.234567],
    [-180, -90, 180, 90],
  ] as MapQuery['bbox'][]) {
    const query = { bbox, level: 3 }
    const buffered = bufferedViewport(query)
    expect(containsViewport(buffered, query)).toBe(true)
    expect(buffered.bbox[0]).toBeGreaterThanOrEqual(-180)
    expect(buffered.bbox[3]).toBeLessThanOrEqual(90)
  }
})

it('위치는 재사용해도 상태는 같은 여유 범위와 버전으로 매번 조회한다', async () => {
  await mapLayer('roads', viewport, signal())
  await mapLayer('roads', moved, signal())
  const calls = request.mock.calls
  expect(calls.filter(([path]) => path.endsWith('/geometry'))).toHaveLength(1)
  const states = calls.filter(([path]) => path.endsWith('/status'))
  expect(states).toHaveLength(2)
  for (const [, options] of states)
    expect(options?.query).toEqual({
      bbox: bufferedViewport(viewport).bbox.join(','),
      level: 6,
      geometry_version: 'v1',
    })
})

it('인구 고정 범위를 넓히지 않으며 일반 주차 조회는 CDN 우회 없이 메모리도 재사용한다', async () => {
  await mapGeometry('population', viewport, signal())
  expect(request.mock.calls[0][1]?.query?.bbox).toBe(viewport.bbox.join(','))
  await apiParkingSource.load('map', signal(), viewport)
  await apiParkingSource.load('map', signal(), viewport)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][1]?.query).not.toHaveProperty('cache_refresh')
})

it('CDN에 머문 4분을 차감해 1분 뒤 만료하고 같은 조회 범위를 재확인한다', async () => {
  request.mockImplementation(async (path, options) => reply(path, options, 240))
  await mapGeometry('parking', viewport, signal())
  vi.setSystemTime(Date.now() + 59000)
  // Monotonic expiry also advances independently of device wall-clock edits.
  vi.spyOn(performance, 'now').mockReturnValue(59000)
  await mapGeometry('parking', moved, signal())
  expect(request).toHaveBeenCalledTimes(1)
  vi.mocked(performance.now).mockReturnValue(60001)
  await mapGeometry('parking', moved, signal())
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][1]?.query?.bbox).toBe(request.mock.calls[0][1]?.query?.bbox)
  vi.mocked(performance.now).mockRestore()
})

it('Age가 없으면 envelope 생성 시각을 쓰며 미래 시각의 응답은 메모리에 보관하지 않는다', async () => {
  request.mockImplementation(async (path, options) => {
    const result = reply(path, options, null)
    result.envelope.server_time = new Date(Date.now() + 60000).toISOString()
    return result
  })
  await mapGeometry('parking', viewport, signal())
  await mapGeometry('parking', viewport, signal())
  expect(request).toHaveBeenCalledTimes(2)
})

it('여유 범위 초과 시 각 소비자의 실제 범위로 한 번 줄이고 재초과는 그대로 알린다', async () => {
  request.mockResolvedValueOnce(failure('MAP_RANGE_TOO_LARGE', 422))
  const result = await mapGeometry('parking', viewport, signal())
  expect(result.bbox).toEqual(viewport.bbox)
  expect(request).toHaveBeenCalledTimes(2)
  clearMapCache()
  request.mockReset().mockResolvedValue(failure('MAP_RANGE_TOO_LARGE', 422))
  await expect(mapGeometry('roads', viewport, signal())).rejects.toMatchObject({
    code: 'MAP_RANGE_TOO_LARGE',
  })
  expect(request).toHaveBeenCalledTimes(2)
})

it('409 뒤에만 고유한 CDN 우회 값을 보내고 갱신된 위치를 재사용한다', async () => {
  request.mockImplementation(async (path, options) => {
    if (path.endsWith('/status') && version === 'v1') {
      version = 'v2'
      return failure('GEOMETRY_VERSION_MISMATCH', 409)
    }
    return reply(path, options)
  })
  const result = await mapLayer('roads', viewport, signal())
  expect(result.geometry.geometry_version).toBe('v2')
  const geometries = request.mock.calls.filter(([path]) => path.endsWith('/geometry'))
  expect(geometries).toHaveLength(2)
  expect(geometries[0][1]?.query).not.toHaveProperty('cache_refresh')
  expect(geometries[1][1]?.query?.cache_refresh).toMatch(/^[0-9a-f-]{36}$/)
  await mapGeometry('roads', viewport, signal())
  expect(request).toHaveBeenCalledTimes(4)
})

it('동일 요청을 공유하되 소비자 한 명의 취소는 다른 소비자를 끊지 않는다', async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const one = new AbortController(),
    two = new AbortController()
  const a = mapGeometry('parking', viewport, one.signal)
  const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' })
  const b = mapGeometry('parking', viewport, two.signal)
  await Promise.resolve()
  expect(request).toHaveBeenCalledTimes(1)
  one.abort()
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false)
  resolve(reply(...request.mock.calls[0]))
  await rejected
  expect((await b).layer).toBe('parking')
})

it('마지막 소비자가 취소하면 실제 요청도 취소하고 이후 재요청을 허용한다', async () => {
  request.mockImplementationOnce(
    (_path, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
          once: true,
        })
      }),
  )
  const controller = new AbortController()
  const pending = mapGeometry('roads', viewport, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  controller.abort()
  await rejected
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
  await mapGeometry('roads', viewport, signal())
  expect(request).toHaveBeenCalledTimes(2)
})

it('원본 강제 갱신보다 늦게 도착한 이전 응답이 캐시를 되돌리지 않는다', async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const old = mapGeometry('roads', viewport, signal())
  await Promise.resolve()
  const oldResponse = reply(...request.mock.calls[0])
  version = 'v2'
  await mapGeometry('roads', viewport, signal(), { refresh: 'origin' })
  resolve(oldResponse)
  await old
  expect((await mapGeometry('roads', viewport, signal())).geometry_version).toBe('v2')
  expect(request).toHaveBeenCalledTimes(2)
})

it('최근 사용한 항목을 남기고 큰 응답은 보관하지 않아 캐시를 제한한다', async () => {
  const queries = Array.from({ length: 25 }, (_, i) => ({
    bbox: [i, 1, i + 0.1, 2] as MapQuery['bbox'],
    level: 3,
  }))
  for (const query of queries.slice(0, 24)) await mapGeometry('population', query, signal())
  await mapGeometry('population', queries[0], signal())
  await mapGeometry('population', queries[24], signal())
  await mapGeometry('population', queries[0], signal())
  expect(request).toHaveBeenCalledTimes(25)
  await mapGeometry('population', queries[1], signal())
  expect(request).toHaveBeenCalledTimes(26)
  clearMapCache()
  request.mockReset().mockImplementation(async (path, options) => {
    const result = reply(path, options)
    result.envelope.data.coverage = 'x'.repeat(8 * 1024 * 1024)
    return result as ApiResponse<MapGeometry>
  })
  await mapGeometry('parking', viewport, signal())
  await mapGeometry('parking', viewport, signal())
  expect(request).toHaveBeenCalledTimes(2)
})
