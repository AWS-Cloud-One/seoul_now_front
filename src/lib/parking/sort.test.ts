import { expect, it } from 'vitest'
import { compareParkingRows, hourlyBaseRate } from './sort'
import { normalizeParkingResponse } from '../../api/parking/normalize'
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
it('무료·저렴한 요금·비싼 요금·미확인 순으로 정렬하고 동률은 거리를 비교한다', () => {
  const lots = normalizeParkingResponse([
    { id: 'unknown', name: 'unknown' },
    { id: 'expensive', name: 'expensive', baseRate: { amount: 500, minutes: 10 } },
    { id: 'cheap-far', name: 'cheap-far', baseRate: { amount: 1000, minutes: 30 } },
    { id: 'cheap-near', name: 'cheap-near', baseRate: { amount: 1000, minutes: 30 } },
    { id: 'free', name: 'free', feeStatus: '무료' },
  ])
  const distances = [1, 10, 500, 50, 900]
  const rows = lots.map((lot, i) => ({ lot, meters: distances[i] }))
  expect(
    [...rows].sort((a, b) => compareParkingRows(a, b, 'price')).map((row) => row.lot.id),
  ).toEqual(['free', 'cheap-near', 'cheap-far', 'expensive', 'unknown'])
  expect([...rows].sort((a, b) => compareParkingRows(a, b, 'distance'))[0].lot.id).toBe('unknown')
})
