import { expect, it, vi } from 'vitest'
import { ApiProblem, fetchDirections, parseDirections, parseFood } from './api'
import { routeTrafficColor } from './traffic'

it('교통 상태와 구간 좌표를 보존하며 정보가 없는 구간은 회색이다', () => {
  const route = parseDirections({
    summary: { distance: 100, duration: 60 },
    coordinates: [
      [127, 37.5],
      [127.1, 37.6],
    ],
    segments: [
      {
        coordinates: [
          [127, 37.5],
          [127.1, 37.6],
        ],
        traffic_state: 1,
      },
    ],
  })
  expect(route.segments).toEqual([
    {
      path: [
        [37.5, 127],
        [37.6, 127.1],
      ],
      state: 1,
    },
  ])
  expect(routeTrafficColor(1)).toBe('#e62525')
  expect(routeTrafficColor(4)).toBe('#00c73c')
  expect(routeTrafficColor(99)).toBe(routeTrafficColor(0))
  expect(parseDirections({ summary: { distance: 100, duration: 60 } }).segments).toEqual([])
})

it('경로 응답의 [경도, 위도]를 지도용 [위도, 경도]로 바꾸고 시간·거리·요금을 읽는다', () => {
  const route = parseDirections({
    summary: { distance: 3200, duration: 540, fare: { taxi: 6800, toll: 0 } },
    coordinates: [
      [126.97, 37.55],
      [126.98, 37.56],
    ],
  })
  expect(route).toMatchObject({ distance: 3200, duration: 540, taxiFare: 6800, tollFare: 0 })
  expect(route.path).toEqual([
    [37.55, 126.97],
    [37.56, 126.98],
  ])
  expect(() => parseDirections({ coordinates: [] })).toThrow(ApiProblem)
})

it('음식점만 남기고 반경 밖 장소는 빼며 가까운 순으로 정렬한다', () => {
  const center = { lat: 37.57, lon: 126.985 }
  const doc = (id: string, y: number, group = 'FD6') => ({
    id,
    place_name: id,
    category_name: '음식점 > 한식 > 국밥',
    category_group_code: group,
    x: '126.985',
    y: String(y),
  })
  const foods = parseFood(
    {
      documents: [
        doc('far', 37.585),
        doc('near', 37.5705),
        doc('cafe', 37.5701, 'CE7'),
        doc('mid', 37.573),
      ],
    },
    center,
    800,
  )
  expect(foods.map((f) => f.id)).toEqual(['near', 'mid'])
  expect(foods[0].category).toBe('국밥')
})

it('서버가 키 미설정 등으로 거절하면 서버 메시지를 그대로 전달한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ detail: '키를 설정해 주세요.' }), { status: 503 }),
    ),
  )
  const point = { lat: 37.5, lon: 127 }
  await expect(fetchDirections(point, point, new AbortController().signal)).rejects.toMatchObject({
    message: '키를 설정해 주세요.',
    status: 503,
  })
  vi.unstubAllGlobals()
})
