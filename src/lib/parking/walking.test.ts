import { expect, it } from 'vitest'
import { estimatedWalkMinutes } from './walking'
it('짧은 거리도 최소 1분으로 표시하고 거리에 따라 추정 시간을 계산한다', () => {
  expect(estimatedWalkMinutes(68)).toBe(1)
  expect(estimatedWalkMinutes(284)).toBe(6)
  expect(estimatedWalkMinutes(1000)).toBe(19)
})
it('유효하지 않은 거리에서는 시간을 만들어내지 않는다', () => {
  expect(estimatedWalkMinutes(-1)).toBeNull()
  expect(estimatedWalkMinutes(NaN)).toBeNull()
  expect(estimatedWalkMinutes(Infinity)).toBeNull()
})
