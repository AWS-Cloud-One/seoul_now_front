import type { ParkingLot } from './types'
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
function count(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim())))
    return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}
function coordinate(value: unknown, max: number) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null
}
function timestamp(value: unknown) {
  const time = text(value)
  return time && Number.isFinite(Date.parse(time)) ? time : null
}
export function normalizeParkingLot(value: unknown): ParkingLot | null {
  const row = object(value)
  if (!row) return null
  const id =
    text(row.id) ||
    (typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id >= 0
      ? String(row.id)
      : null)
  if (!id) return null
  const capacity = count('totalSpaces' in row ? row.totalSpaces : row.capacity)
  let available = count('availableSpaces' in row ? row.availableSpaces : row.available)
  if (capacity !== null && available !== null && available > capacity) available = null
  const position = object(row.previewPosition),
    rate = object(row.baseRate),
    rawHours = object(row.hours)
  const x = coordinate(position?.x, 1600),
    y = coordinate(position?.y, 900)
  const amount = count(rate?.amount),
    minutes = count(rate?.minutes)
  return {
    id,
    ...(object(row.api) ? { api: row.api as ParkingLot['api'] } : {}),
    ...(text(row.code) ? { code: text(row.code) } : {}),
    name: text(row.name) || '이름 미확인 주차장',
    lat: coordinate(row.lat, 90),
    lng: coordinate(row.lng, 180),
    capacity,
    available,
    previewPosition: x !== null && y !== null && x >= 0 && y >= 0 ? { x, y } : null,
    address: text(row.address),
    kind: text(row.kind),
    source: text(row.source),
    collectedAt: timestamp(row.updatedAt ?? row.collectedAt),
    feeStatus: text(row.feeStatus),
    baseRate: amount !== null && minutes !== null && minutes > 0 ? { amount, minutes } : null,
    hours: Object.fromEntries(
      Object.entries(rawHours || {})
        .filter(
          ([, hours]) =>
            Array.isArray(hours) && hours.length === 2 && hours.every((value) => text(value)),
        )
        .map(([day, hours]) => [
          day,
          (hours as string[]).map((value) => value.trim()) as [string, string],
        ]),
    ),
  }
}
export function normalizeParkingResponse(response: unknown): ParkingLot[] {
  const rows = Array.isArray(response) ? response : object(response)?.items
  if (!Array.isArray(rows)) throw new Error('주차장 응답 형식을 확인할 수 없습니다.')
  const lots = rows.map(normalizeParkingLot).filter((lot): lot is ParkingLot => lot !== null)
  if (rows.length && !lots.length) throw new Error('사용 가능한 주차장 정보를 확인할 수 없습니다.')
  return [...new Map(lots.map((lot) => [lot.id, lot])).values()]
}
