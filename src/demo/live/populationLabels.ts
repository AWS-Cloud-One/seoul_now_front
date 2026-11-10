import type { LivePlace } from './store'
import type { MapRecord } from '../mapLayers'

export function livePopulationRecord(
  place: LivePlace,
  lat = place.lat,
  lng = place.lng,
): MapRecord {
  return {
    kind: 'population',
    data: {
      live: !place.saved,
      information: place.information,
      lat,
      lng,
      properties: {
        name: place.name,
        min: place.populationMin,
        max: place.populationMax,
        congestion: place.level,
        observedAt: place.sourceTime || '',
      },
    },
  }
}

export function populationCount(
  place: Pick<LivePlace, 'stale' | 'populationMin' | 'populationMax'>,
) {
  if (place.stale) return '갱신 대기'
  const min = place.populationMin,
    max = place.populationMax
  if (min === null && max === null) return '인원 정보 없음'
  if (min === null || max === null || min === max)
    return `${(min ?? max)!.toLocaleString('ko-KR')}명`
  return `${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')}명`
}

export function visiblePopulationPlaces(
  places: LivePlace[],
  project: (place: LivePlace) => { x: number; y: number },
  width: number,
  height: number,
  selected: string | null,
) {
  const anchors: { x: number; y: number }[] = []
  return [...places]
    .sort((a, b) => Number(b.code === selected) - Number(a.code === selected))
    .filter((place) => {
      const point = project(place)
      if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return false
      if (
        anchors.some(
          (anchor) => Math.abs(anchor.x - point.x) < 155 && Math.abs(anchor.y - point.y) < 62,
        )
      )
        return false
      anchors.push(point)
      return true
    })
}
