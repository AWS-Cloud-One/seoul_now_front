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
