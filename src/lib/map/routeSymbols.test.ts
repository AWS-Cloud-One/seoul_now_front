import { expect, it } from 'vitest'
import { endpointHtml, routeArrows } from './routeSymbols'

it('경로의 진행 방향을 따라 일정한 화면 간격으로 화살표를 배치한다', () => {
  const project = ([lat, lng]: [number, number]) => ({ x: lng, y: lat })
  const marks = routeArrows(
    [
      [0, 0],
      [0, 200],
      [200, 200],
    ],
    project,
    300,
    300,
  )
  expect(marks[0]).toEqual({ lat: 0, lng: 24, angle: 0 })
  expect(marks[1].lng - marks[0].lng).toBeCloseTo(18)
  expect(marks.at(-1)?.angle).toBe(90)
  const reverse = routeArrows(
    [
      [0, 200],
      [0, 0],
    ],
    project,
    300,
    300,
  )
  expect(Math.abs(reverse[0].angle)).toBe(180)
  expect(
    routeArrows(
      [
        [0, 0],
        [0, 0],
      ],
      project,
      300,
      300,
    ),
  ).toEqual([])
})

it('화면 밖 화살표를 제외하고 출발·도착 표식을 구분한다', () => {
  expect(
    routeArrows(
      [
        [1000, 0],
        [1000, 400],
      ],
      ([lat, lng]) => ({ x: lng, y: lat }),
      300,
      300,
    ),
  ).toEqual([])
  expect(endpointHtml('origin')).toContain('출발')
  expect(endpointHtml('destination')).toContain('도착')
})
