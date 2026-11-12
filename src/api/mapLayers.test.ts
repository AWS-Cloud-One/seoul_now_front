import { afterEach, expect, it, vi } from 'vitest'
import { clearMapCache, mapLayer } from './mapLayers'
import {
  queryApi,
  queryApiResponse,
  QueryError,
  SEOUL_QUERY,
  type MapGeometry,
  type MapStatus,
} from './queries'
import { parseMapPopulation, fetchRoadTraffic } from '../state/live/store'
import { bufferedViewport } from './mapViewport'
import { information } from './testFixtures'
vi.mock('./queries', async (original) => ({
  ...(await original<typeof import('./queries')>()),
  queryApi: vi.fn(),
  queryApiResponse: vi.fn(),
}))
afterEach(() => {
  vi.resetAllMocks()
  clearMapCache()
})
const geometry = (version = 'v1'): MapGeometry => ({
  ...SEOUL_QUERY,
  layer: 'population',
  geometry_version: version,
  coverage: 'seoul',
  feature_collection: { type: 'FeatureCollection', features: [] },
})
const status = (version = 'v1'): MapStatus => ({
  ...SEOUL_QUERY,
  layer: 'population',
  geometry_version: version,
  status: 'partial',
  items: [],
})
const response = (data: MapGeometry) => ({
  status: 200,
  ok: true,
  data,
  retryAfterSeconds: null,
  envelope: { data, error: null, request_id: 'geometry', server_time: new Date().toISOString() },
})
it('동일 범위·레벨·버전으로 상태를 조회하고 버전 변경 시 한 번만 도형을 다시 받는다', async () => {
  vi.mocked(queryApiResponse)
    .mockResolvedValueOnce(response(geometry()))
    .mockResolvedValueOnce(response(geometry('v2')))
  vi.mocked(queryApi)
    .mockRejectedValueOnce(new QueryError('changed', 409, 'GEOMETRY_VERSION_MISMATCH'))
    .mockResolvedValueOnce(status('v2'))
  const result = await mapLayer('population', SEOUL_QUERY, new AbortController().signal)
  expect(result.geometry.geometry_version).toBe('v2')
  expect(queryApi).toHaveBeenNthCalledWith(
    2,
    '/map/layers/population/status',
    { bbox: SEOUL_QUERY.bbox.join(','), level: SEOUL_QUERY.level, geometry_version: 'v2' },
    expect.any(AbortSignal),
  )
  vi.mocked(queryApi).mockResolvedValueOnce(status('v2'))
  await mapLayer('population', SEOUL_QUERY, new AbortController().signal)
  expect(queryApi).toHaveBeenCalledTimes(3)
  expect(queryApiResponse).toHaveBeenCalledTimes(2)
})
it('버전 재불일치와 과도한 범위 오류는 무한 재시도하지 않는다', async () => {
  const error = new QueryError('changed', 409, 'GEOMETRY_VERSION_MISMATCH')
  vi.mocked(queryApiResponse).mockResolvedValue(response(geometry()))
  vi.mocked(queryApi).mockRejectedValue(error)
  await expect(mapLayer('population', SEOUL_QUERY, new AbortController().signal)).rejects.toBe(
    error,
  )
  expect(queryApi).toHaveBeenCalledTimes(2)
  expect(queryApiResponse).toHaveBeenCalledTimes(2)
  clearMapCache()
  vi.mocked(queryApiResponse)
    .mockReset()
    .mockRejectedValue(new QueryError('범위를 줄여 주세요.', 422, 'MAP_RANGE_TOO_LARGE'))
  await expect(mapLayer('roads', SEOUL_QUERY, new AbortController().signal)).rejects.toMatchObject({
    code: 'MAP_RANGE_TOO_LARGE',
  })
  expect(queryApiResponse).toHaveBeenCalledTimes(2)
})
it('feature ID로 조인하고 모든 다중 폴리곤·구멍과 미확인 인구를 보존한다', () => {
  const shape = geometry()
  const square = [
    [127, 37],
    [128, 37],
    [128, 38],
    [127, 37],
  ] as [number, number][]
  shape.feature_collection.features = ['a', 'b', 'c', 'd'].map((id) => ({
    type: 'Feature',
    id,
    properties: { name: id, area_code: id },
    geometry: { type: 'MultiPolygon', coordinates: [[square, square], [square]] },
  }))
  const current = status()
  const value = information({
    min_people: 0,
    max_people: 10,
    congestion: 'normal' as const,
    is_replacement: false,
  })
  value.freshness = 'fresh'
  current.items = [
    { area_code: 'b', population: { ...value, freshness: 'stale' } },
    { area_code: 'a', population: value },
    { area_code: 'c', population: { ...value, value: { ...value.value!, is_replacement: true } } },
  ]
  const places = parseMapPopulation(shape, current)
  expect(places[0]).toMatchObject({ code: 'a', populationMin: 0, level: '보통' })
  expect(places[0].polygons).toHaveLength(2)
  expect(places[0].polygons![0]).toHaveLength(2)
  expect(places[0].polygons![0][0][0]).toEqual([37, 127])
  for (const place of places.slice(1))
    expect(place).toMatchObject({ level: '정보 없음', populationMin: null })
})
it('도로 속도 0과 미수집 상태를 구분하며 구간을 연결하지 않는다', async () => {
  const g = { ...geometry(), ...bufferedViewport(SEOUL_QUERY), layer: 'roads' }
  g.feature_collection.features = [
    {
      type: 'Feature',
      id: 'link-a',
      properties: { name: '도로', link_id: 'link-a' },
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [127, 37],
            [127.1, 37.1],
          ],
          [
            [127.2, 37.2],
            [127.3, 37.3],
          ],
        ],
      },
    },
  ]
  vi.mocked(queryApiResponse).mockResolvedValueOnce(response(g))
  vi.mocked(queryApi).mockResolvedValueOnce({
    ...status(),
    ...bufferedViewport(SEOUL_QUERY),
    layer: 'roads',
    items: [{ link_id: 'link-a', traffic: information({ speed_kmh: 0, travel_seconds: null }) }],
  })
  const roads = await fetchRoadTraffic(new AbortController().signal)
  expect(roads).toHaveLength(2)
  expect(roads[0]).toMatchObject({
    speed: 0,
    travelSeconds: null,
    path: [
      [37, 127],
      [37.1, 127.1],
    ],
  })
})
