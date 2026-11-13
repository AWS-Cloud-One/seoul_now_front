import { describe, expect, it } from 'vitest'
import { validRegion, validRegionPayload } from './regions'

describe('destination contract', () => {
  it('과거 행정동 상태와 공식 경계를 구분한다', () => {
    expect(validRegion({ label: '성수', area_ids: ['dong'] })).toBe(true)
    expect(
      validRegion({
        label: '홍대',
        kind: 'official',
        area_ids: [],
        boundary_ids: ['POI007'],
        boundary_versions: { POI007: 'v1' },
        source: 'citydata_place_boundaries',
      }),
    ).toBe(true)
    expect(validRegion({ label: '홍대', kind: 'official', area_ids: ['POI007'] })).toBe(false)
  })
  it('반경·좌표·출처를 확인하고 중첩 이력의 잘못된 범위를 거부한다', () => {
    const r = {
      label: '합정역 반경 500m',
      kind: 'radius',
      area_ids: [],
      source: 'kakao_local',
      radius_m: 500,
      anchor: {
        place_id: 'kakao:1',
        name: '합정역',
        coordinates: { latitude: 37.55, longitude: 126.91 },
        collected_at: '2026-11-13T00:00:00Z',
      },
    }
    expect(
      validRegionPayload({ items: [{ response: { recommendation: { search_area: r } } }] }),
    ).toBe(true)
    expect(validRegionPayload({ search_area: { ...r, radius_m: 6000 } })).toBe(false)
    expect(validRegion({ ...r, anchor: null })).toBe(false)
  })
})
