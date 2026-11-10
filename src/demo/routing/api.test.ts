import { afterEach, expect, it, vi } from 'vitest'
import { ApiProblem, fetchDirections, parseDirections, foundPlace } from './api'
import { information, FIXTURE_TIME } from '../../api/testFixtures'
import type { DrivingData, FoundPlaceData } from '../../api/queries'

export const drivingFixture = (): DrivingData => ({
  origin: { latitude: 37.55, longitude: 126.97 },
  destination: { latitude: 37.57, longitude: 126.98 },
  checked_at: FIXTURE_TIME,
  route: information({
    distance_meters: 4200,
    duration_seconds: 600,
    taxi_fare_krw: 6800,
    toll_fare_krw: 0,
    geometry_reason: null,
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [
          [126.97, 37.55],
          [126.98, 37.57],
        ],
        [
          [127, 37.6],
          [127.01, 37.61],
        ],
      ],
    },
  }),
})
afterEach(() => vi.unstubAllGlobals())
it('각 경로 구간을 보존하고 위경도·초·미터를 변환하며 없는 교통 상태를 만들지 않는다', () => {
  const route = parseDirections(drivingFixture())
  expect(route).toMatchObject({ duration: 600, distance: 4200, taxiFare: 6800, tollFare: 0 })
  expect(route.segments).toEqual([
    {
      path: [
        [37.55, 126.97],
        [37.57, 126.98],
      ],
      state: 0,
    },
    {
      path: [
        [37.6, 127],
        [37.61, 127.01],
      ],
      state: 0,
    },
  ])
})
it('도형이 없어도 ETA는 유지하고 unavailable 응답으로 시간을 만들지 않는다', () => {
  const data = drivingFixture()
  data.route.value!.geometry = null
  data.route.value!.geometry_reason = 'ROUTE_GEOMETRY_UNAVAILABLE'
  expect(parseDirections(data)).toMatchObject({
    duration: 600,
    distance: 4200,
    path: [],
    geometryReason: 'ROUTE_GEOMETRY_UNAVAILABLE',
  })
  data.route.status = 'unavailable'
  expect(() => parseDirections(data)).toThrow(ApiProblem)
})
it('장소의 opaque ID, 좌표, 미확인 거리를 보존한다', () => {
  const place: FoundPlaceData = {
    place_id: 'kakao:007',
    name: '카페',
    category_code: 'CE7',
    category_name: '음식점 > 카페',
    coordinates: { latitude: 37.5, longitude: 127 },
    address: null,
    road_address: '서울 주소',
    phone: null,
    provider_url: 'javascript:alert(1)',
    distance_meters: null,
    source: 'kakao',
    collected_at: FIXTURE_TIME,
  }
  expect(foundPlace(place)).toMatchObject({
    id: 'kakao:007',
    category: '카페',
    lat: 37.5,
    lng: 127,
    address: '서울 주소',
    meters: null,
    url: '',
  })
})
it('제품 경로 API에 좌표를 보내고 서버 오류·재시도 대기 시간을 전달한다', async () => {
  const fetcher = vi.fn<(...args: [string]) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({
          request_id: 'test',
          server_time: FIXTURE_TIME,
          data: null,
          error: {
            code: 'RATE_LIMITED',
            message: '잠시 후 다시 시도해 주세요.',
            retryable: true,
            retry_after_seconds: 20,
            details: [],
          },
        }),
        { status: 429, headers: { 'Retry-After': '30' } },
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(
    fetchDirections(
      { lat: 37.5, lon: 127 },
      { lat: 37.6, lon: 127.1 },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAt: expect.any(Number) })
  const url = new URL(fetcher.mock.calls[0][0]!, 'http://localhost')
  expect(url.pathname).toBe('/api/v1/locations/routes/driving')
  expect(url.searchParams.get('origin_latitude')).toBe('37.5')
})
