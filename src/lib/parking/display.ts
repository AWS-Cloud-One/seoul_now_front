import type { ParkingLot } from '../../types/parking'
export const parkingAvailability = (available: number | null) =>
  available === null
    ? '주차 가능 대수 미확인'
    : available === 0
      ? '현재 만차'
      : `${available.toLocaleString('ko-KR')}면 주차 가능`
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
