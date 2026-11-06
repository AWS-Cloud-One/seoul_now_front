import { expect, it } from 'vitest'
import { parseBoundary, parseDetail, parsePlaces } from './store'

const square = (x: number, y: number) => [
  [x, y],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
  [x, y],
]
const feature = (props: Record<string, string>) => ({
  geometry: { type: 'Polygon', coordinates: [square(127, 37)] },
  properties: { area_code: 'POI001', name: '강남역', category: '인구밀집지역', ...props },
})

it('좌표를 [위도, 경도]로 뒤집고, 오래됐거나 대체된 관측은 "정보 없음"으로 보여준다', () => {
  const [fresh, stale, replaced] = parsePlaces({
    features: [
      feature({
        status: 'recent',
        congestion: '붐빔',
        population_min: '1000',
        population_max: '2000',
      }),
      feature({
        area_code: 'POI002',
        status: 'stale',
        congestion: '여유',
        population_min: '1',
        population_max: '2',
      }),
      feature({ area_code: 'POI003', status: 'recent', replacement: 'Y', congestion: '보통' }),
    ],
  })
  expect(fresh).toMatchObject({
    level: '붐빔',
    populationMin: 1000,
    populationMax: 2000,
    stale: false,
  })
  expect(fresh.ring[0]).toEqual([37, 127])
  expect(stale).toMatchObject({ level: '정보 없음', populationMin: null, stale: true })
  expect(replaced.level).toBe('정보 없음')
})

it('행정동 경계를 지도용 고리 목록으로 바꾼다', () => {
  const rings = parseBoundary({
    features: [
      feature({}),
      {
        geometry: { type: 'MultiPolygon', coordinates: [[square(1, 2)], [square(3, 4)]] },
        properties: {},
      },
    ],
  })
  expect(rings).toHaveLength(3)
  expect(rings[1][0]).toEqual([2, 1])
})

it('상세 응답에서 도로 구간·상권·주차 정보를 읽고, 없는 값을 0으로 만들지 않는다', () => {
  const detail = parseDetail({
    area_name: '강남역',
    data: {
      ROAD_TRAFFIC_STTS: {
        AVG_ROAD_DATA: { ROAD_TRAFFIC_IDX: '서행', ROAD_TRAFFIC_SPD: 21 },
        ROAD_TRAFFIC_STTS: [
          { IDX: '정체', SPD: 13, ROAD_NM: '테헤란로', XYLIST: '127.02_37.49|127.03_37.5' },
          { IDX: '원활', SPD: 31, ROAD_NM: '이름만', XYLIST: '' },
        ],
      },
      LIVE_CMRCL_STTS: {
        AREA_CMRCL_LVL: '한산한',
        CMRCL_RSB: [{ RSB_MID_CTGR: '편의점', RSB_LRG_CTGR: '유통', RSB_MCT_CNT: 59 }],
      },
      PRK_STTS: [
        { PRK_NM: 'A', CPCTY: '285', CUR_PRK_YN: 'N', CUR_PRK_CNT: '' },
        { PRK_NM: 'B', CPCTY: '10', CUR_PRK_YN: 'Y', CUR_PRK_CNT: '0' },
      ],
    },
  })
  expect(detail.road).toMatchObject({ level: '서행', speed: 21 })
  expect(detail.road.segments).toHaveLength(1)
  expect(detail.road.segments[0].path[0]).toEqual([37.49, 127.02])
  expect(detail.commerce.categories[0]).toMatchObject({ name: '편의점', stores: 59 })
  expect(detail.parking.lots[0].available).toBeNull()
  expect(detail.parking.lots[1].available).toBe(0)
})
