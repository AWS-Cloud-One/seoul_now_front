import type { ParkingLot } from '../../types/parking'
export type ParkingSort = 'distance' | 'price'
export function hourlyBaseRate(
  lot: Pick<ParkingLot, 'baseRate' | 'feeStatus' | 'api'>,
): number | null {
  if (lot.api) return lot.api.comparison?.hourly_base_comparison_krw ?? null
  if (lot.feeStatus?.trim() === '무료') return 0
  const rate = lot.baseRate
  if (
    !rate ||
    !Number.isFinite(rate.amount) ||
    !Number.isFinite(rate.minutes) ||
    rate.amount < 0 ||
    rate.minutes <= 0
  )
    return null
  return (rate.amount * 60) / rate.minutes
}
type Row = { lot: ParkingLot; meters: number }
export function compareParkingRows(a: Row, b: Row, sort: ParkingSort): number {
  if (sort === 'price') {
    const left = hourlyBaseRate(a.lot),
      right = hourlyBaseRate(b.lot)
    if (left === null && right !== null) return 1
    if (left !== null && right === null) return -1
    if (left !== null && right !== null && left !== right) return left - right
  }
  return a.meters - b.meters
}
