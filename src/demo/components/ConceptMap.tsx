import { Fragment, useMemo, useState } from 'react'
import { useDemo } from '../useDemo'
import Icon from './Icon'
import type { CSSProperties } from 'react'
import { useParkingData } from '../parking/useParkingData'
import {
  parkingAvailability,
  parkingBadge,
  parkingOperatingText,
  previewPosition,
} from '../parking/display'
const population = [
  { x: 350, y: 210, name: '용산', count: '12,480', level: '여유', color: '#41a889' },
  { x: 815, y: 220, name: '성수', count: '28,360', level: '붐빔', color: '#e39541' },
  { x: 940, y: 660, name: '강남', count: '42,150', level: '매우 붐빔', color: '#dc6b64' },
  { x: 1280, y: 580, name: '잠실', count: '19,820', level: '보통', color: '#c1a64b' },
]
const river = 'M-100 400 C140 620 320 720 500 580 S760 150 970 290 S1320 550 1690 250'
const highway =
  'M-100 490 C140 710 320 810 510 670 S780 235 970 375 S1320 635 1690 335 M-100 310 C140 530 320 630 490 490 S740 65 970 205 S1320 465 1690 165'
const bridges =
  'M315 460L380 745 M620 360L760 520 M895 210L850 430 M1180 335L1145 560 M1450 230L1505 440'
const arteries =
  'M-40 170 Q420 390 750 150 T1640 90 M-40 840 Q430 660 770 720 T1640 680 M220 -40 Q400 200 430 920 M1110 -40 Q1000 400 1140 940 M1450 -40 Q1310 440 1500 940'
const rail =
  'M-30 155L240 275 460 290 690 190 920 140 1200 220 1620 110 M180 910L410 780 660 730 905 650 1100 600 1340 665 1640 570'
const stations: [number, number, string][] = [
  [240, 275, '공덕'],
  [460, 290, '삼각지'],
  [690, 190, '옥수'],
  [920, 140, '성수'],
  [1200, 220, '건대입구'],
  [410, 780, '동작'],
  [660, 730, '고속터미널'],
  [905, 650, '논현'],
  [1100, 600, '선릉'],
  [1340, 665, '잠실'],
]
const districts: [number, number, string][] = [
  [310, 170, '용산구'],
  [760, 90, '성동구'],
  [1320, 145, '광진구'],
  [700, 825, '서초구'],
  [1060, 790, '강남구'],
  [1450, 735, '송파구'],
]
const traffic = [
  ['M-40 490Q125 650 300 700', '#35af86'],
  ['M300 700Q415 725 510 670', '#e8ad43'],
  ['M510 670Q610 580 680 450', '#df6b60'],
  ['M680 450Q830 265 970 375', '#35af86'],
  ['M970 375Q1140 485 1280 480', '#e8ad43'],
  ['M1280 480Q1460 470 1690 335', '#35af86'],
  ['M1110 -40Q1065 165 1060 330', '#35af86'],
  ['M1060 330Q1050 520 1085 700', '#df6b60'],
  ['M1085 700L1140 940', '#e8ad43'],
]
const roads =
  Array.from(
    { length: 21 },
    (_, i) => `M${i * 88 - 140} -50 Q${i * 88 - 30} 420 ${i * 88 + 95} 960 `,
  ).join('') +
  Array.from(
    { length: 13 },
    (_, i) => `M-80 ${i * 86} Q720 ${i * 86 + 80} 1680 ${i * 86 - 75} `,
  ).join('')

export function LayerButtons({
  quick = true,
  onParkingClick,
}: {
  quick?: boolean
  onParkingClick?: (enabled: boolean) => void
}) {
  const { layers, toggleLayer } = useDemo()
  const options = (
    quick
      ? [
          ['parking', '주차장', 'parking', '#3885dc'],
          ['population', '관측 인구', 'people', '#ad65ce'],
          ['roads', '도로교통량', 'car', '#ee9750'],
        ]
      : [
          ['roads', '도로 교통량', 'car', '#ee9750'],
          ['population', '관측 인구', 'people', '#ad65ce'],
        ]
  ) as readonly (readonly [keyof typeof layers, string, string, string])[]
  const Container = quick ? 'nav' : 'div'
  return (
    <Container
      className={quick ? 'map-quick-layers' : 'layer-controls'}
      aria-label={quick ? '지도 표시 선택' : '지도 정보 레이어'}
    >
      {options.map(([key, label, symbol, color]) => (
        <button
          type="button"
          key={key}
          aria-pressed={layers[key]}
          style={quick ? ({ '--layer-accent': color } as CSSProperties) : undefined}
          onClick={() => {
            toggleLayer(key)
            if (key === 'parking') onParkingClick?.(!layers.parking)
          }}
        >
          <Icon name={symbol} />
          {label}
        </button>
      ))}
    </Container>
  )
}
export default function ConceptMap() {
  const { layers } = useDemo()
  const parkingData = useParkingData('preview')
  const parking = useMemo(
    () =>
      parkingData.lots.flatMap((lot) => {
        const position = previewPosition(lot)
        return position ? [{ ...lot, ...position }] : []
      }),
    [parkingData.lots],
  )
  const [detail, setDetail] = useState<
    { kind: 'parking'; id: string } | { kind: 'population'; index: number } | null
  >(null)
  const selectedParking =
    detail?.kind === 'parking' ? parkingData.lots.find((lot) => lot.id === detail.id) : null
  const item =
    detail?.kind === 'parking' ? selectedParking : detail ? population[detail.index] : null
  return (
    <div
      className={`concept-map ${layers.parking ? 'show-parking' : ''} ${layers.population ? 'show-population' : ''} ${layers.roads ? '' : 'hide-roads'}`}
      id="concept-map"
    >
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="서울 중심부 지도 시안"
      >
        <rect width="1600" height="900" fill="#fafbf9" />
        {Array.from({ length: 13 * 23 }, (_, i) => {
          const r = Math.floor(i / 23),
            c = i % 23,
            x = c * 76 - 60 + (r % 3) * 13,
            y = r * 78 - 55,
            w = 40 + ((c * 7 + r * 3) % 22),
            h = 40 + ((r * 9 + c * 3) % 24)
          return (
            <path
              key={i}
              d={`M${x} ${y + 7}l${w - 7} -7 7 ${h - 10} -${w - 4} 10Z`}
              fill={
                (c * 3 + r) % 17 === 0 ? '#e3efd7' : (c + r * 2) % 5 === 0 ? '#f2e7db' : '#eff0ee'
              }
              stroke="#e2e4e0"
              strokeWidth=".7"
            />
          )
        })}
        <g fill="none" strokeLinecap="round">
          <path d={roads} stroke="#daddd9" strokeWidth="10" />
          <path d={roads} stroke="white" strokeWidth="8" />
        </g>
        <g fill="#e2efd5">
          <path d="M260 80L375 50 460 125 415 230 305 245 245 170Z" />
          <path d="M790 115L875 105 905 175 820 220 770 170Z" />
          <path d="M1240 35L1360 45 1390 145 1290 170 1210 100Z" />
          <path d="M1170 600L1280 575 1320 650 1210 680Z" />
        </g>
        <path d={river} fill="none" stroke="#e1eed5" strokeWidth="168" />
        <path d={river} fill="none" stroke="#a9d6ed" strokeWidth="140" />
        <path d={river} fill="none" stroke="#80b8d6" strokeWidth="1.5" strokeDasharray="6 7" />
        <g fill="none">
          <path d={`${highway} ${arteries}`} stroke="#e4b983" strokeWidth="17" />
          <path d={`${highway} ${arteries}`} stroke="#ffe0a7" strokeWidth="13" />
          <path d={bridges} stroke="#c4cbc7" strokeWidth="18" />
          <path d={bridges} stroke="#fff" strokeWidth="14" />
          <path d={rail} stroke="white" strokeWidth="6" />
          <path d={rail} stroke="#86a676" strokeWidth="2.5" />
        </g>
        <g fontFamily="sans-serif" textAnchor="middle">
          {districts.map(([x, y, text]) => (
            <text
              key={text}
              x={x}
              y={y}
              fontSize="25"
              fill="#969c8e"
              fontWeight="600"
              stroke="#fafbf9"
              strokeWidth="4"
              paintOrder="stroke"
            >
              {text}
            </text>
          ))}
          {stations.map(([x, y, text]) => (
            <Fragment key={text}>
              <circle cx={x} cy={y} r="7" fill="white" stroke="#82a071" strokeWidth="2" />
              <circle cx={x} cy={y} r="2.5" fill="#6e985d" />
              <text
                x={x}
                y={y + 24}
                fontSize="14"
                fill="#636c63"
                stroke="white"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {text}역
              </text>
            </Fragment>
          ))}
          <text x="570" y="610" fill="#629dbb" fontSize="21">
            한강
          </text>
          <text x="1110" y="440" fill="#629dbb" fontSize="21">
            한강
          </text>
          <text x="340" y="155" fill="#8a9d78" fontSize="14">
            용산공원
          </text>
          <text x="840" y="160" fill="#8a9d78" fontSize="14">
            서울숲
          </text>
        </g>
        <g className="concept-traffic" fill="none" strokeWidth="6" strokeLinecap="round">
          {traffic.map(([d, color]) => (
            <Fragment key={d}>
              <path d={d} stroke="white" strokeWidth="9" />
              <path d={d} stroke={color}>
                <title>
                  {color === '#35af86' ? '원활' : color === '#e8ad43' ? '서행' : '정체'} · 예시
                  교통량
                </title>
              </path>
            </Fragment>
          ))}
        </g>
        <g className="concept-population" fontFamily="sans-serif" textAnchor="middle">
          {population.map((p, index) => (
            <Fragment key={p.name}>
              <circle cx={p.x} cy={p.y} r="65" fill={p.color} opacity=".12" />
              <circle cx={p.x} cy={p.y} r="40" fill={p.color} opacity=".12" />
              <g
                data-preview-population={index}
                role="button"
                tabIndex={0}
                aria-label={`${p.name} 관측 인구 ${p.count}명 ${p.level}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setDetail({ kind: 'population', index })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setDetail({ kind: 'population', index })
                  }
                }}
              >
                <rect
                  x={p.x - 52}
                  y={p.y - 17}
                  width="104"
                  height="34"
                  rx="17"
                  fill="white"
                  stroke={p.color}
                  strokeWidth="2"
                />
                <circle cx={p.x - 36} cy={p.y} r="4" fill={p.color} />
                <text x={p.x + 5} y={p.y + 5} fill={p.color} fontSize="13" fontWeight="600">
                  {p.level}
                </text>
              </g>
            </Fragment>
          ))}
        </g>
        <g className="concept-parking" fontFamily="sans-serif">
          {parking.map((p, index) => (
            <g
              key={p.id}
              data-preview-parking={index}
              role="button"
              tabIndex={0}
              aria-label={`${p.name} ${p.available === null ? '정보 미확인' : p.available > 0 ? '주차 가능' : '만차'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setDetail({ kind: 'parking', id: p.id })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDetail({ kind: 'parking', id: p.id })
                }
              }}
            >
              <rect
                x={p.x - 18}
                y={p.y - 21}
                width="36"
                height="40"
                rx="10"
                fill={p.available ? '#427bc4' : '#8b929c'}
                stroke="white"
                strokeWidth="3"
              />
              <text
                x={p.x}
                y={p.y + 6}
                fill="white"
                fontSize="23"
                fontWeight="700"
                textAnchor="middle"
              >
                P
              </text>
              <rect
                x={p.x + 12}
                y={p.y - 27}
                width="42"
                height="22"
                rx="11"
                fill="white"
                stroke="#d9dfe3"
              />
              <text
                x={p.x + 33}
                y={p.y - 12}
                textAnchor="middle"
                fill={p.available ? '#427bc4' : '#8b929c'}
                fontSize="11"
                fontWeight="600"
              >
                {parkingBadge(p.available)}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {detail && item && layers[detail.kind] && (
        <div className="concept-detail">
          <button
            type="button"
            className="concept-detail-close"
            aria-label="정보 닫기"
            onClick={() => setDetail(null)}
          >
            ×
          </button>
          <small>{detail.kind === 'parking' ? '주차장 정보' : '관측 인구'}</small>
          <strong>{item.name}</strong>
          {detail.kind === 'parking' && selectedParking ? (
            <>
              <p>
                <b>{parkingAvailability(selectedParking.available)}</b>
                <span>
                  전체{' '}
                  {selectedParking.capacity === null ? '미확인' : `${selectedParking.capacity}면`}
                </span>
              </p>
              <div>{parkingOperatingText(selectedParking)}</div>
            </>
          ) : (
            <>
              <p>
                <b
                  style={{
                    color:
                      detail.kind === 'population' ? population[detail.index].color : undefined,
                  }}
                >
                  {detail.kind === 'population' ? population[detail.index].level : ''}
                </b>
                <span>{detail.kind === 'population' ? population[detail.index].count : ''}명</span>
              </p>
              <div>주변 구역의 인구 혼잡도</div>
            </>
          )}
          <footer>
            {detail.kind === 'parking' && parkingData.error
              ? '정보를 갱신하지 못해 마지막 정상 자료를 표시합니다.'
              : detail.kind === 'parking' && parkingData.kind === 'api'
                ? '제공된 주차장 정보 기준 · 운영정보 변동 가능'
                : '시안용 예시 데이터 · 실시간 정보 아님'}
          </footer>
        </div>
      )}
      <div className="concept-legend">
        <strong>지도 표시</strong>
        {layers.roads && (
          <span className="traffic-key">
            <i style={{ background: '#35af86' }} />
            원활 <i style={{ background: '#e8ad43' }} />
            서행 <i style={{ background: '#df6b60' }} />
            정체
          </span>
        )}
        {layers.population && (
          <span className="population-key">관측 인구 · 여유 / 보통 / 붐빔</span>
        )}
        <small>디자인 시안 · 위치와 수치는 예시</small>
      </div>
    </div>
  )
}
