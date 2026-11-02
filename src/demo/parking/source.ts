import { loadSeoulMapData } from '../data/seoulMapData'
import type { ParkingSource } from './types'

// Fixtures retain the original positions, counts and detail contents.
export const previewParkingFixtures = [
  {
    id: 'preview-yongsan',
    name: '용산 공영주차장',
    lat: 37.532,
    lng: 126.97,
    totalSpaces: 80,
    availableSpaces: 24,
    previewPosition: { x: 380, y: 365 },
  },
  {
    id: 'preview-banpo',
    name: '반포 공영주차장',
    lat: 37.508,
    lng: 127.0,
    totalSpaces: 65,
    availableSpaces: 8,
    previewPosition: { x: 700, y: 660 },
  },
  {
    id: 'preview-gangnam',
    name: '강남 공영주차장',
    lat: 37.5,
    lng: 127.03,
    totalSpaces: 120,
    availableSpaces: 0,
    previewPosition: { x: 1040, y: 590 },
  },
  {
    id: 'preview-jamsil',
    name: '잠실 공영주차장',
    lat: 37.514,
    lng: 127.1,
    totalSpaces: 150,
    availableSpaces: 42,
    previewPosition: { x: 1260, y: 470 },
  },
].map((lot) => ({
  ...lot,
  source: 'mock',
  baseRate: { amount: 500, minutes: 10 },
  hours: { 평일: ['00:00', '24:00'] },
}))
export const mockParkingSource: ParkingSource = {
  kind: 'mock',
  initialData: { preview: previewParkingFixtures },
  async load(scope, signal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (scope === 'preview') return { items: previewParkingFixtures }
    const data = await loadSeoulMapData()
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return { items: data.parking }
  },
}
// Enable this source only after the team's endpoint/DTO is agreed. No live endpoint is used today.
export function createParkingApiSource(endpoint: string): ParkingSource {
  return {
    kind: 'api',
    async load(_scope, signal) {
      const response = await fetch(endpoint, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('주차장 요청에 실패했습니다.')
      return response.json()
    },
  }
}
