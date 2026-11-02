import type { ParkingLot } from './types'
export const parkingAvailability = (available: number | null) =>
  available === null
    ? '주차 가능 대수 미확인'
    : available === 0
      ? '현재 만차'
      : `${available.toLocaleString('ko-KR')}면 주차 가능`
export const parkingBadge = (available: number | null) =>
  available === null ? '?' : available === 0 ? '만차' : String(available)
export function previewPosition(lot: ParkingLot) {
  if (lot.previewPosition) return lot.previewPosition
  if (lot.lat === null || lot.lng === null) return null
  // Geographic API rows can be projected onto the existing illustrative preview.
  const x = ((lot.lng - 126.88) / (127.16 - 126.88)) * 1600,
    y = ((37.59 - lot.lat) / (37.59 - 37.45)) * 900
  return x >= 0 && x <= 1600 && y >= 0 && y <= 900 ? { x, y } : null
}
export function parkingOperatingText(lot: ParkingLot) {
  const hours = Object.values(lot.hours)
  const operating =
    hours.length && hours.every(([start, end]) => start === '00:00' && end === '24:00')
      ? '운영 시간 24시간'
      : hours.length
        ? `운영 시간 ${hours[0].join('–')}`
        : '운영 시간 미확인'
  const fee = lot.baseRate
    ? `${lot.baseRate.minutes}분당 ${lot.baseRate.amount.toLocaleString('ko-KR')}원`
    : lot.feeStatus || '요금 미확인'
  return `${operating} · ${fee}`
}
