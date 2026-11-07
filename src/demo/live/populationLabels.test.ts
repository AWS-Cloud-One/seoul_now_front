import { expect, it } from 'vitest'
import { populationCount, visiblePopulationPlaces } from './populationLabels'
import type { LivePlace } from './store'

it('인구 범위를 표시하고 누락되거나 오래된 데이터를 0명으로 표시하지 않는다', () => {
  expect(populationCount({ populationMin: 1000, populationMax: 2000, stale: false })).toBe(
    '1,000~2,000명',
  )
  expect(populationCount({ populationMin: 1000, populationMax: 1000, stale: false })).toBe(
    '1,000명',
  )
  expect(populationCount({ populationMin: null, populationMax: null, stale: false })).toBe(
    '인원 정보 없음',
  )
  expect(populationCount({ populationMin: 1000, populationMax: 2000, stale: true })).toBe(
    '갱신 대기',
  )
})
it('겹치는 라벨 중 선택 장소를 우선 표시하고 화면 밖 라벨은 제외한다', () => {
  const places = [
    { code: 'a', lat: 100, lng: 100 },
    { code: 'b', lat: 105, lng: 105 },
    { code: 'c', lat: 900, lng: 900 },
  ] as LivePlace[]
  const shown = visiblePopulationPlaces(
    places,
    (place) => ({ x: place.lng, y: place.lat }),
    400,
    400,
    'b',
  )
  expect(shown.map((place) => place.code)).toEqual(['b'])
})
