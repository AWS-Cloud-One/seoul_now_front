import type { ParkingSummary } from '../contracts'
import type { Page } from '../queries'
import type { ParkingFacilityData, ParkingSearchItem, ParkingDetail } from '../queries'
import type { ParkingLot } from '../../types/parking'
export function apiParkingLot(
  facility: ParkingFacilityData,
  comparison?: Pick<ParkingSearchItem, 'fee_status' | 'hourly_base_comparison_krw' | 'fee_reason'>,
): ParkingLot {
  const records = facility.records
  const addresses = [...new Set(records.map((r) => r.registered.value?.address).filter(Boolean))]
  const capacities = [
    ...new Set(
      records
        .map((r) => r.registered.value?.registered_capacity)
        .filter((v) => v !== null && v !== undefined),
    ),
  ]
  return {
    id: facility.parking_id,
    name: facility.name,
    lat: facility.coordinates.latitude,
    lng: facility.coordinates.longitude,
    capacity: capacities.length === 1 ? capacities[0]! : null,
    available: null,
    address: addresses.join(' / ') || null,
    kind: facility.identity_status === 'verified' ? '시설 확인됨' : '시설 식별 미확인',
    source: 'api',
    collectedAt:
      records
        .map((r) => r.registered.collected_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
    feeStatus: comparison
      ? { free: '무료', paid: '유료', unknown: '요금 미확인', conflict: '요금 원천 충돌' }[
          comparison.fee_status
        ]
      : '요금 미확인',
    baseRate: null,
    hours: {},
    api: { facility, comparison },
  }
}
export function withParkingDetail(lot: ParkingLot, detail: ParkingDetail): ParkingLot {
  if (!lot.api || detail.parking_id !== lot.id) return lot
  return {
    ...apiParkingLot({ ...lot.api.facility, records: detail.records }, lot.api.comparison),
    api: {
      ...lot.api,
      facility: {
        ...lot.api.facility,
        records: detail.records,
        availability: detail.availability,
        identity_status: detail.identity_status,
      },
      detail,
    },
  }
}

export function nearbyParkingPage(data: unknown): Page<ParkingSearchItem> {
  const { parking } = data as { parking: ParkingSummary }
  if (parking.status !== 'available')
    throw new Error('주변 등록 주차를 확인하지 못했어요. 주차장이 없다는 뜻은 아니에요.')
  return {
    items: parking.items.map((facility) => ({
      facility,
      fee_status: 'unknown',
      fee_reason: null,
      hourly_base_comparison_krw: null,
    })),
    next_cursor: parking.next_cursor,
    total_count: parking.total_count ?? undefined,
    radius_meters: parking.search_radius_meters ?? undefined,
    checked_at: parking.checked_at,
  }
}
