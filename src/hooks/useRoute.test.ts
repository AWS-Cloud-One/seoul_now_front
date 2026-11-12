import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { distanceMeters, useRoute } from './useRoute'

it('해시 경로를 읽고, 알 수 없는 경로는 지도 홈으로 처리한다', () => {
  window.location.hash = '/parking'
  const { result } = renderHook(useRoute)
  expect(result.current[0]).toBe('parking')
  act(() => {
    window.location.hash = '/없는경로'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(result.current[0]).toBe('home')
  act(() => result.current[1]('saved'))
  expect(window.location.hash).toBe('#/saved')
})

it('두 좌표의 직선거리를 미터로 계산한다', () => {
  expect(distanceMeters([37.5665, 126.978], [37.5665, 126.978])).toBe(0)
  // 위도 0.01도 ≈ 1.11km
  const meters = distanceMeters([37.5, 127], [37.51, 127])
  expect(meters).toBeGreaterThan(1100)
  expect(meters).toBeLessThan(1120)
})
