import { expect, it } from 'vitest'
import { information } from '../../api/testFixtures'
import type { MapRoadSegment } from '../live/store'
import { roadSpeedColor } from '../live/roadStyle'
import { colorRouteByRoads, UNKNOWN_ROUTE_COLOR } from './roadTraffic'

const now = Date.parse('2026-11-10T03:00:00+09:00')
const point = (x: number, y = 0): [number, number] => [
  37.5665 + y / 111195,
  127 + x / (111195 * Math.cos((37.5665 * Math.PI) / 180)),
]
const route = (points = [point(0), point(100)]) => [{ path: points, state: 0 }]
function road(id: string, speed: number | null, points = [point(0), point(100)]): MapRoadSegment {
  return {
    id,
    speed,
    path: points,
    name: id,
    classes: [],
    direction: '',
    live: true,
    travelSeconds: null,
    measurementTime: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
    information: { ...information({ speed_kmh: speed, travel_seconds: null }), freshness: 'fresh' },
  }
}

it.each([0, 19.9, 20, 39.9, 40, 80])(
  '겹치는 유효 도로의 %s km/h를 기존 도로 색상과 맞춘다',
  (speed) => {
    const original = route()
    const colored = colorRouteByRoads(original, [road('a', speed)], now)
    expect(new Set(colored.map((s) => s.color))).toEqual(new Set([roadSpeedColor(speed)]))
    expect(colored[0].path[0]).toEqual(original[0].path[0])
    expect(colored.at(-1)!.path.at(-1)).toEqual(original[0].path.at(-1))
    expect(original).toEqual(route())
  },
)
it('겹치는 일부 구간만 칠하고 관측 선의 끝을 넘겨 추정하지 않는다', () => {
  const colored = colorRouteByRoads(route([point(-30), point(130)]), [road('a', 10)], now)
  expect(colored.map((s) => s.color)).toEqual([
    UNKNOWN_ROUTE_COLOR,
    roadSpeedColor(10),
    UNKNOWN_ROUTE_COLOR,
  ])
  expect(colored[1].path[0][1]).toBeGreaterThanOrEqual(point(0)[1])
  expect(colored[1].path.at(-1)![1]).toBeLessThanOrEqual(point(100)[1])
})
it('직각 교차, 접점만 있는 도로, 떨어진 평행도로는 색을 가져오지 않는다', () => {
  const roads = [
    road('crossing', 10, [point(50, -50), point(50, 50)]),
    road('touch', 30, [point(100), point(150)]),
    road('distant', 60, [point(0, 20), point(100, 20)]),
  ]
  expect(colorRouteByRoads(route(), roads, now).every((s) => s.color === UNKNOWN_ROUTE_COLOR)).toBe(
    true,
  )
})
it('여러 가까운 도로 또는 겹친 반대방향 도로가 있으면 관측 여부와 관계없이 미확인 처리한다', () => {
  for (const other of [
    road('b', 60, [point(100), point(0)]),
    road('b', null, [point(0, 4), point(100, 4)]),
  ])
    expect(
      colorRouteByRoads(route(), [road('a', 10), other], now).every(
        (s) => s.color === UNKNOWN_ROUTE_COLOR,
      ),
    ).toBe(true)
})
it('같은 도로 ID의 이어진 도형을 서로 다른 도로로 오인하지 않는다', () => {
  const pieces = [road('a', 30, [point(0), point(50)]), road('a', 30, [point(50), point(100)])]
  expect(colorRouteByRoads(route(), pieces, now).every((s) => s.color === roadSpeedColor(30))).toBe(
    true,
  )
})
it('데이터 없음·만료·미래 시각·수집 실패는 연한 회색으로 표시한다', () => {
  const cases = [road('a', null), road('a', 20), road('a', 20), road('a', 20), road('a', 20)]
  cases[1].receivedAt = new Date(now - 31 * 60000).toISOString()
  cases[2].receivedAt = new Date(now + 60000).toISOString()
  cases[3].information!.freshness = 'stale'
  cases[4].information!.reason_code = 'COLLECTION_FAILED'
  for (const candidate of cases)
    expect(
      colorRouteByRoads(route(), [candidate], now).every((s) => s.color === UNKNOWN_ROUTE_COLOR),
    ).toBe(true)
  expect(colorRouteByRoads(route(), [], now)[0].color).toBe(UNKNOWN_ROUTE_COLOR)
})
it('떨어진 경로 도형 사이에 가짜 연결선을 만들지 않는다', () => {
  const paths = [...route([point(0), point(10)]), ...route([point(500), point(510)])]
  const colored = colorRouteByRoads(paths, [], now)
  expect(colored).toEqual(paths.map((s) => ({ path: s.path, color: UNKNOWN_ROUTE_COLOR })))
})
