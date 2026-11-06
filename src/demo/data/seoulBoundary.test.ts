import { expect, it } from 'vitest'
import { SEOUL_BOUNDARY, SEOUL_VIEW_BOUNDS } from './seoulBoundary'
import { getLiveState } from '../live/store'

it('서버 응답 전에도 서울 25개 구 경계를 제공한다', () => {
  expect(SEOUL_BOUNDARY).toHaveLength(25)
  expect(getLiveState().boundary).toBe(SEOUL_BOUNDARY)
  for (const ring of SEOUL_BOUNDARY) {
    expect(ring.length).toBeGreaterThan(3)
    expect(ring[0]).toEqual(ring.at(-1))
    for (const [lat, lng] of ring) {
      expect(lat).toBeGreaterThan(37)
      expect(lat).toBeLessThan(38)
      expect(lng).toBeGreaterThan(126)
      expect(lng).toBeLessThan(128)
    }
  }
})
it('전체 보기 범위가 서울의 서쪽·동쪽·남쪽·북쪽을 모두 포함한다', () => {
  const [[south, west], [north, east]] = SEOUL_VIEW_BOUNDS
  expect(south).toBeLessThan(37.44)
  expect(north).toBeGreaterThan(37.69)
  expect(west).toBeLessThan(126.78)
  expect(east).toBeGreaterThan(127.17)
})
