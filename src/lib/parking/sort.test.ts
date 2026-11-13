import { expect, it } from 'vitest'
import { hourlyBaseRate } from './sort'
it('분 단위가 다른 기본요금을 같은 시간으로 환산한다', () => {
  expect(hourlyBaseRate({ baseRate: { amount: 500, minutes: 10 }, feeStatus: null })).toBe(3000)
  expect(hourlyBaseRate({ baseRate: { amount: 1000, minutes: 30 }, feeStatus: null })).toBe(2000)
})
it('명시된 무료만 0원으로 취급하고 미확인은 무료로 추정하지 않는다', () => {
  expect(hourlyBaseRate({ baseRate: null, feeStatus: '무료' })).toBe(0)
  expect(hourlyBaseRate({ baseRate: null, feeStatus: '일부 무료' })).toBeNull()
  expect(hourlyBaseRate({ baseRate: null, feeStatus: null })).toBeNull()
  expect(hourlyBaseRate({ baseRate: { amount: 100, minutes: 0 }, feeStatus: null })).toBeNull()
})
