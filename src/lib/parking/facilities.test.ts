import { expect, it } from 'vitest'
import { normalizeParkingResponse } from '../../api/parking/normalize'
import { parkingFacilities } from './facilities'

it('같은 주차장 코드·이름·주소의 개별 구획을 하나로 묶고 원본 ID를 보존한다', () => {
  const lots = normalizeParkingResponse(
    Array.from({ length: 19 }, (_, i) => ({
      id: 'bay-' + i,
      code: '1509186',
      name: 'DDP 관광버스 주차장',
      address: '중구 을지로7가 2-36',
      source: 'public',
      lat: 37.566 + i * 0.00001,
      lng: 127.011,
      capacity: 1,
    })),
  )
  const grouped = parkingFacilities(lots)
  expect(grouped).toHaveLength(1)
  expect(grouped[0].capacity).toBe(19)
  expect(grouped[0].available).toBeNull()
  expect(grouped[0].memberIds).toHaveLength(19)
  expect(grouped[0].lat).toBeCloseTo(37.56609)
})
it('동명이어도 코드나 주소가 다르면 별개로 유지하고 코드 없는 곳을 임의 병합하지 않는다', () => {
  const rows = [
    { id: 'a', code: '1', address: '주소1' },
    { id: 'b', code: '2', address: '주소1' },
    { id: 'c', code: '1', address: '주소2' },
    { id: 'd', address: '주소1' },
    { id: 'e', address: '주소1' },
  ].map((row) => ({ ...row, name: '동명 주차장', lat: 37.5, lng: 127 }))
  expect(parkingFacilities(normalizeParkingResponse(rows))).toHaveLength(5)
})

it('출처가 달라도 코드와 이름 및 위치가 같은 등록은 하나의 아이콘으로 묶는다', () => {
  const shared = { code: '1', name: '공영주차장', lat: 37.5, lng: 127, capacity: 12 }
  const lots = normalizeParkingResponse([
    { ...shared, id: 'public', source: 'public' },
    { ...shared, id: 'city', source: 'city' },
    { ...shared, id: 'other', code: '2', source: 'city' },
  ])
  const grouped = parkingFacilities(lots)
  expect(grouped).toHaveLength(2)
  expect(grouped[0]).toMatchObject({ memberIds: ['public', 'city'], capacity: 12 })
})

it('구획 평균 좌표와 주소 표기가 달라도 원본 좌표가 일치하는 요약 등록을 묶는다', () => {
  const shared = { code: '1', name: '청계5(남)', lat: 37.5, lng: 127 }
  const lots = normalizeParkingResponse([
    { ...shared, id: 'city-1', source: 'city', address: '지번 주소', capacity: 2 },
    { ...shared, id: 'city-2', source: 'city', address: '도로명 주소', capacity: 2 },
    { ...shared, id: 'bay-1', source: 'public', address: '지번 주소', capacity: 1 },
    { ...shared, id: 'bay-2', source: 'public', address: '지번 주소', lng: 127.0001, capacity: 1 },
  ])
  const grouped = parkingFacilities(lots)
  expect(grouped).toHaveLength(1)
  expect(grouped[0]).toMatchObject({
    capacity: 2,
    memberIds: ['bay-1', 'bay-2', 'city-1', 'city-2'],
  })
})
