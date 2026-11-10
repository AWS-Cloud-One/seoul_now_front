import { expect, it } from 'vitest'
import { apiParkingLot, nearbyParkingPage, withParkingDetail } from './api'
import { parkingFacilities } from './facilities'
import { hourlyBaseRate } from './sort'
import { information, FIXTURE_TIME } from '../../api/testFixtures'
import type { ParkingFacilityData } from '../../api/queries'
const facility = (id: string): ParkingFacilityData => ({
  parking_id: id,
  identity_status: 'unverified',
  name: '같은 이름',
  coordinates: { latitude: 37.5, longitude: 127 },
  distance_meters: 0,
  records: [],
  availability: { ...information(null), status: 'unsupported' },
})
it('같은 이름·위치여도 서버 시설 ID가 다르면 합치지 않고 빈자리·무료를 추론하지 않는다', () => {
  const lots = parkingFacilities([apiParkingLot(facility('a')), apiParkingLot(facility('b'))])
  expect(lots.map((lot) => lot.id)).toEqual(['a', 'b'])
  for (const lot of lots) {
    expect(lot.available).toBeNull()
    expect(hourlyBaseRate(lot)).toBeNull()
    expect(lot.memberIds).toEqual([lot.id])
  }
  expect(
    hourlyBaseRate(
      apiParkingLot(facility('a'), {
        fee_status: 'free',
        fee_reason: null,
        hourly_base_comparison_krw: 0,
      }),
    ),
  ).toBe(0)
  expect(
    hourlyBaseRate(
      apiParkingLot(facility('a'), {
        fee_status: 'conflict',
        fee_reason: 'conflict',
        hourly_base_comparison_krw: null,
      }),
    ),
  ).toBeNull()
})
it('P04에서 서로 다른 원천 등록 기록과 미확인 수치를 그대로 보존한다', () => {
  const lot = apiParkingLot(facility('a'))
  const records = ['source-1', 'source-2'].map((source_record_id) => ({
    source_record_id,
    source: 'test',
    reference_date: null,
    registered: information({
      address: '서울',
      registered_capacity: source_record_id === 'source-1' ? 0 : null,
      fees: null,
      operating_hours: null,
    }),
  }))
  const enriched = withParkingDetail(lot, {
    parking_id: 'a',
    identity_status: 'verified',
    checked_at: FIXTURE_TIME,
    records,
    availability: lot.api!.facility.availability,
  })
  expect(enriched.api?.facility.records).toEqual(records)
  expect(enriched.api?.detail?.records).toEqual(records)
  expect(enriched.capacity).toBe(0)
  expect(withParkingDetail(lot, { ...enriched.api!.detail!, parking_id: 'other' })).toBe(lot)
})
it('P02의 반경·커서를 보존하며 unavailable을 빈 목록으로 만들지 않는다', () => {
  const parking = {
    status: 'available',
    items: [facility('a')],
    search_radius_meters: 500,
    total_count: 42,
    next_cursor: 'cursor',
    checked_at: FIXTURE_TIME,
  }
  expect(nearbyParkingPage({ parking })).toMatchObject({
    radius_meters: 500,
    total_count: 42,
    next_cursor: 'cursor',
    items: [{ facility: { parking_id: 'a' } }],
  })
  expect(() => nearbyParkingPage({ parking: { ...parking, status: 'unavailable' } })).toThrow()
})
