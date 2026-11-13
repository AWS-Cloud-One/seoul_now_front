import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { dateLabel } from '../../lib/domain.js'
import {
  fetchLiveDetail,
  LEVEL_COLORS,
  LEVELS,
  retryLive,
  selectLivePlace,
  useLive,
  type Level,
  type LiveDetail,
  type LivePlace,
  type MapRoadSegment,
} from '../../state/live/store'
import Icon from '../common/Icon'
import InformationMeta from '../common/InformationMeta'
import { NearbyShopsSection } from '../place/RouteSections'
import { ParkingPanel } from './OtherPanels'
import { useAppState } from '../../state/useAppState'
import { useRoadTraffic } from '../../hooks/useRoadTraffic'
import { SEOUL_QUERY } from '../../api/queries'
import { openDirectionsTo } from '../../state/directionsTarget'
import {
  EmptyState,
  ErrorState,
  FactRows,
  FilterChip,
  LoadingNote,
  LoadingSkeleton,
  PagedList,
  PanelHeader,
  PrimaryButton,
  SearchField,
  SecondaryButton,
  StatusBadge,
  type Tone,
} from '../common/ui'
import { distanceMeters, focusMap, setMapOverlay } from '../../hooks/useRoute'
import type { Route } from '../../hooks/useRoute'

const tone = (level: Level): Tone =>
  level === '여유' ? 'info' : level === '보통' ? 'warn' : level === '정보 없음' ? 'neutral' : 'bad'
const range = (place: LivePlace) =>
  place.populationMin !== null && place.populationMax !== null
    ? `${place.populationMin.toLocaleString('ko-KR')}~${place.populationMax.toLocaleString('ko-KR')}명`
    : '관측값 없음'
/** Provider timestamps are Korea time without a zone. */
function minutesSince(value: string | null) {
  if (!value) return null
  const time = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}:00+09:00`)
  return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 60000)) : null
}

function LiveDetailView({ place, go }: { place: LivePlace; go: (route: Route) => void }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'done'; data: LiveDetail }
  >({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchLiveDetail(place.code, controller.signal).then(
      (data) => !controller.signal.aborted && setState({ status: 'done', data }),
      (error: Error) =>
        !controller.signal.aborted && setState({ status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [place.code, attempt])
  useEffect(() => {
    setMapOverlay({ traffic: state.status === 'done' ? state.data.road.segments : null })
    return () => setMapOverlay({ traffic: null })
  }, [state])
  const age = minutesSince(place.sourceTime)
  return (
    <>
      <PanelHeader
        title={place.name}
        back={{ label: '실시간 장소 목록', onClick: () => selectLivePlace(null) }}
        subtitle={<>{place.category} · 서울시 실시간 도시데이터</>}
      />
      <div className="sn-scroll">
        <section className="sn-section" aria-labelledby="sn-l-now">
          <h3 id="sn-l-now">지금 혼잡도</h3>
          <div className="sn-big-level" style={{ borderColor: LEVEL_COLORS[place.level] }}>
            <span className="sn-dot-level" style={{ background: LEVEL_COLORS[place.level] }} />
            <strong>{place.level}</strong>
            <span>{place.stale ? '갱신 지연 또는 대체값' : `관측 인구 ${range(place)}`}</span>
          </div>
          <p className="sn-note">
            {place.name} 관측 구역 전체 기준이에요(개별 가게 안의 인원이 아니에요).
            {place.sourceTime &&
              ` 관측 ${Number.isFinite(Date.parse(place.sourceTime)) ? dateLabel(place.sourceTime) : place.sourceTime}`}
            {age !== null && age > 60 && ` · ${Math.floor(age / 60)}시간 이상 지난 값`}
          </p>
        </section>
        {place.information && <InformationMeta information={place.information} />}
        {state.status === 'loading' ? (
          <LoadingSkeleton rows={3} />
        ) : state.status === 'error' ? (
          <ErrorState
            title="상세 정보를 불러오지 못했어요"
            onRetry={() => {
              setState({ status: 'loading' })
              setAttempt(attempt + 1)
            }}
          >
            {state.message}
          </ErrorState>
        ) : (
          <DetailBody detail={state.data} />
        )}
        <section className="sn-section" aria-labelledby="sn-l-route">
          <h3 id="sn-l-route">가는 길</h3>
          <PrimaryButton
            onClick={() => {
              openDirectionsTo({
                id: place.code,
                name: place.name,
                lat: place.lat,
                lon: place.lng,
                sub: `${place.category} · 서울 실시간 데이터`,
                liveCode: place.code,
              })
              go('directions')
            }}
          >
            <Icon name="car" />
            {place.name}까지 길찾기
          </PrimaryButton>
        </section>
        <NearbyShopsSection
          key={`s-${place.code}`}
          place={{ id: place.code, name: place.name, lat: place.lat, lon: place.lng }}
        />
        <SecondaryButton
          onClick={() => {
            setMapOverlay({ parkingBase: { name: place.name, lat: place.lat, lng: place.lng } })
            go('parking')
          }}
        >
          <Icon name="parking" />
          주변 주차장 보기
        </SecondaryButton>
      </div>
    </>
  )
}

const ROAD_TONE: Record<string, Tone> = { 원활: 'good', 서행: 'warn', 정체: 'bad' }
function DetailBody({ detail }: { detail: LiveDetail }) {
  const counts = detail.road.segments.reduce<Record<string, number>>((m, s) => {
    m[s.level] = (m[s.level] || 0) + 1
    return m
  }, {})
  const worst = detail.road.segments
    .filter((s) => s.level === '정체')
    .sort((a, b) => (a.speed ?? 99) - (b.speed ?? 99))
    .slice(0, 4)
  const links = detail.information?.roads.value?.items || []
  // Without a city-data summary, summarise the per-link speeds (legend buckets: <20, 20~40, ≥40).
  const speeds = links.flatMap((item) =>
    item.traffic.status === 'available' && item.traffic.value?.speed_kmh != null
      ? [item.traffic.value.speed_kmh]
      : [],
  )
  const linkAverage = speeds.length
    ? Math.round((speeds.reduce((sum, v) => sum + v, 0) / speeds.length) * 10) / 10
    : null
  const hasCommerce = detail.commerce.level || detail.commerce.categories.length
  return (
    <>
      <section className="sn-section" aria-labelledby="sn-l-road">
        <h3 id="sn-l-road">도로 소통</h3>
        {detail.road.level ? (
          <>
            <FactRows
              rows={[
                [
                  '전체 소통',
                  <StatusBadge tone={ROAD_TONE[detail.road.level] || 'neutral'}>
                    {detail.road.level}
                  </StatusBadge>,
                ],
                [
                  '평균 속도',
                  detail.road.speed !== null ? `${detail.road.speed}km/h` : '속도 정보 없음',
                ],
                ...(detail.road.segments.length
                  ? [
                      [
                        '구간',
                        ['정체', '서행', '원활']
                          .map((level) => `${level} ${counts[level] || 0}`)
                          .join(' · '),
                      ] as [string, string],
                    ]
                  : []),
                ...worst.map(
                  (s) =>
                    [`정체 · ${s.name}`, s.speed !== null ? `${s.speed}km/h` : '속도 미확인'] as [
                      string,
                      string,
                    ],
                ),
              ]}
            />
            {detail.road.message && <p className="sn-note">{detail.road.message}</p>}
            <p className="sn-note">지도에 구간별 소통 상태가 표시돼요. {detail.road.time}</p>
          </>
        ) : speeds.length ? (
          <FactRows
            rows={[
              ['평균 속도', `${linkAverage}km/h · ${speeds.length}개 링크`],
              [
                '속도 분포',
                `20 미만 ${speeds.filter((v) => v < 20).length} · 20~40 ${
                  speeds.filter((v) => v >= 20 && v < 40).length
                } · 40 이상 ${speeds.filter((v) => v >= 40).length}`,
              ],
            ]}
          />
        ) : (
          <p>도로 소통 정보가 제공되지 않았어요.</p>
        )}
        {links.length > 0 && (
          <details className="sn-more-rows">
            <summary>도로 링크별 속도 {links.length}개 보기</summary>
            <FactRows
              label="도로 링크별 속도"
              rows={links.map((item) => [
                `링크 ${item.link_id}`,
                item.traffic.status === 'available' && item.traffic.value?.speed_kmh != null
                  ? `${item.traffic.value.speed_kmh}km/h`
                  : '속도 미확인',
              ])}
            />
            {detail.information && <InformationMeta information={detail.information.roads} />}
          </details>
        )}
      </section>
      <section className="sn-section" aria-labelledby="sn-l-shop">
        <h3 id="sn-l-shop">상권 현황</h3>
        {hasCommerce ? (
          <>
            <FactRows
              rows={[
                ...(detail.commerce.level
                  ? [
                      ['상권 분위기', <StatusBadge>{detail.commerce.level}</StatusBadge>] as [
                        string,
                        ReactNode,
                      ],
                    ]
                  : []),
                ...(detail.commerce.payments !== null
                  ? [
                      ['최근 결제', `${detail.commerce.payments.toLocaleString('ko-KR')}건`] as [
                        string,
                        string,
                      ],
                    ]
                  : []),
                ...detail.commerce.categories
                  .slice(0, 6)
                  .map(
                    (c) =>
                      [
                        `${c.name} · ${c.group}`,
                        [c.stores !== null ? `${c.stores}곳` : null, c.level]
                          .filter(Boolean)
                          .join(' · ') || '-',
                      ] as [string, string],
                  ),
              ]}
            />
            <p className="sn-note">
              업종 단위 집계예요. 개별 가게는 아래 "근처 상가"에서 확인하세요.{' '}
              {detail.commerce.time}
            </p>
          </>
        ) : (
          <p>상권 정보가 제공되지 않았어요.</p>
        )}
      </section>
      <section className="sn-section" aria-labelledby="sn-l-prk">
        <h3 id="sn-l-prk">주차</h3>
        {detail.parking.total !== null ? (
          <>
            <FactRows
              rows={[
                ['등록 주차장', `${detail.parking.total}개`],
                ...detail.parking.lots
                  .slice(0, 4)
                  .map(
                    (lot) =>
                      [
                        lot.name,
                        [
                          lot.capacity !== null ? `총 ${lot.capacity}면` : null,
                          lot.available !== null
                            ? lot.available === 0
                              ? '만차'
                              : `잔여 ${lot.available}면`
                            : null,
                          lot.fee,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '정보 없음',
                      ] as [string, string],
                  ),
              ]}
            />
            <p className="sn-note">
              등록 시설 수는 현재 빈자리가 아니에요. 빈자리와 외부 차량 이용 가능 여부는
              미확인입니다.
            </p>
          </>
        ) : (
          <p>이 구역에 연결된 주차장 정보가 없어요.</p>
        )}
      </section>
      {detail.weather && (
        <section className="sn-section" aria-labelledby="sn-l-wx">
          <h3 id="sn-l-wx">날씨</h3>
          <FactRows
            rows={[
              ...(detail.weather.temp !== null
                ? [['기온', `${detail.weather.temp}°C`] as [string, string]]
                : []),
              ...(detail.weather.air ? [['대기', detail.weather.air] as [string, string]] : []),
            ]}
          />
          {detail.weather.rain && <p className="sn-note">{detail.weather.rain}</p>}
        </section>
      )}
      {detail.information && (
        <details className="sn-section sn-more">
          <summary>관측 자료 출처</summary>
          <FactRows
            rows={(['population', 'roads', 'parking', 'commerce', 'weather'] as const).map(
              (key) => [
                {
                  population: '인구',
                  roads: '도로',
                  parking: '주차',
                  commerce: '상권',
                  weather: '날씨',
                }[key],
                <InformationMeta information={detail.information![key]} />,
              ],
            )}
          />
        </details>
      )}
    </>
  )
}

type Topic = 'crowd' | 'roads' | 'parking'
const TOPIC_LAYER = { crowd: 'population', roads: 'roads', parking: 'parking' } as const
const LEVEL_RANK: Record<Level, number> = {
  붐빔: 4,
  '약간 붐빔': 3,
  보통: 2,
  여유: 1,
  '정보 없음': 0,
}
const km = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`
/** City-wide road picture from the observed links (one speed per link). */
function useRoadSummary() {
  const { roads, error, status, refresh } = useRoadTraffic(SEOUL_QUERY, true)
  return useMemo(() => {
    const links = new Map<string, MapRoadSegment>()
    for (const road of roads)
      if (road.speed !== null && !links.has(road.id)) links.set(road.id, road)
    const speeds = [...links.values()].map((road) => road.speed!)
    const byName = new Map<string, { speeds: number[]; at: [number, number] }>()
    for (const road of links.values()) {
      if (!road.name || road.name === '도로명 미확인') continue
      const entry = byName.get(road.name) || {
        speeds: [],
        at: road.path[Math.floor(road.path.length / 2)] || road.path[0],
      }
      entry.speeds.push(road.speed!)
      byName.set(road.name, entry)
    }
    const slow = [...byName.entries()]
      .map(([name, entry]) => ({
        name,
        speed: entry.speeds.reduce((sum, v) => sum + v, 0) / entry.speeds.length,
        links: entry.speeds.length,
        at: entry.at,
      }))
      .sort((a, b) => a.speed - b.speed)
    return {
      loaded: status !== 'loading',
      status,
      refresh,
      error,
      links: speeds.length,
      average: speeds.length ? speeds.reduce((sum, v) => sum + v, 0) / speeds.length : null,
      slowShare: speeds.length ? speeds.filter((v) => v < 20).length / speeds.length : null,
      buckets: [
        speeds.filter((v) => v < 20).length,
        speeds.filter((v) => v >= 20 && v < 40).length,
        speeds.filter((v) => v >= 40).length,
      ],
      slow,
    }
  }, [roads, error, status, refresh])
}

// Once per missing-data period, including when the user leaves and returns to Home.
let crowdNoticeShown = false
const refreshCrowd = () => {
  crowdNoticeShown = false
  retryLive()
}

export function HomePanel({ go }: { go: (route: Route) => void }) {
  const live = useLive()
  const { active, layers, toggleLayer, notify } = useAppState()
  const center = active.workspaceView?.map?.center
  const base = center ? { name: '지도 중심', lat: center[0], lng: center[1] } : null
  const [topic, setTopic] = useState<Topic>('crowd')
  const roads = useRoadSummary()
  const observed = live.places.filter((p) => p.level !== '정보 없음').length
  const crowded = live.places.filter((p) => p.level === '붐빔' || p.level === '약간 붐빔').length
  const announceNoObservation = useEffectEvent(() =>
    notify('혼잡 관측값이 없어요. 한산하다는 뜻은 아니에요.', {
      label: '다시 확인',
      onClick: refreshCrowd,
    }),
  )
  useEffect(() => {
    if (observed > 0) crowdNoticeShown = false
    if (live.status === 'ready' && live.places.length > 0 && !observed && !crowdNoticeShown) {
      crowdNoticeShown = true
      announceNoObservation()
    }
  }, [live.status, live.places.length, observed])
  const choose = (next: Topic) => {
    setTopic(next)
    const layer = TOPIC_LAYER[next]
    if (!layers[layer]) toggleLayer(layer)
  }
  const selected = live.places.find((p) => p.code === live.selected)
  if (selected) return <LiveDetailView key={selected.code} place={selected} go={go} />
  const cards: { key: Topic; label: string; value: string; sub: string; icon: string }[] = [
    {
      key: 'crowd',
      label: '혼잡',
      icon: 'people',
      value:
        live.status === 'ready'
          ? observed
            ? `붐빔 ${crowded}곳`
            : '관측값 없음'
          : live.status === 'error'
            ? '조회 실패'
            : '확인 중',
      sub:
        live.status === 'ready'
          ? `확인 ${observed}곳 · 정보 없음 ${live.places.length - observed}곳`
          : '서울 실시간 인구',
    },
    {
      key: 'roads',
      label: '도로',
      icon: 'car',
      value:
        roads.average !== null
          ? `평균 ${Math.round(roads.average)}km/h`
          : roads.status === 'error'
            ? '조회 실패'
            : roads.status === 'loading'
              ? '확인 중'
              : '관측값 없음',
      sub:
        roads.slowShare !== null
          ? `20km/h 미만 ${Math.round(roads.slowShare * 100)}%`
          : '수집 도로 구간',
    },
    {
      key: 'parking',
      label: '주차',
      icon: 'parking',
      value: '주변 찾기',
      sub: '지도 위치 기준',
    },
  ]
  return (
    <>
      <PanelHeader title="밖과사전" subtitle="혼잡·도로·주차를 한눈에 보고 지도에서 확인해요." />
      <div className="sn-home-cards" role="tablist" aria-label="서울 지도 정보">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            role="tab"
            aria-selected={topic === card.key}
            className={`sn-home-card ${topic === card.key ? 'is-on' : ''}`}
            onClick={() => choose(card.key)}
          >
            <span className="sn-home-card-label">
              <Icon name={card.icon} />
              {card.label}
            </span>
            <strong>{card.value}</strong>
            <small>{card.sub}</small>
          </button>
        ))}
      </div>
      {topic === 'crowd' ? (
        <CrowdTopic base={base} />
      ) : topic === 'roads' ? (
        <RoadsTopic summary={roads} />
      ) : (
        <ParkingPanel from="home" />
      )}
    </>
  )
}

function CrowdTopic({ base }: { base: { name: string; lat: number; lng: number } | null }) {
  const live = useLive()
  const [query, setQuery] = useState('')
  const [levels, setLevels] = useState<Level[]>([])
  const [sort, setSort] = useState<'near' | 'crowded'>('crowded')
  const distance = (p: LivePlace) =>
    base ? distanceMeters([base.lat, base.lng], [p.lat, p.lng]) : 0
  const shown = useMemo(
    () =>
      live.places
        .filter(
          (p) => (!query || p.name.includes(query)) && (!levels.length || levels.includes(p.level)),
        )
        .sort((a, b) =>
          sort === 'near' && base
            ? distance(a) - distance(b)
            : LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
              (b.populationMax ?? -1) - (a.populationMax ?? -1),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live.places, query, levels, sort, base?.lat, base?.lng],
  )
  const toggle = (level: Level) =>
    setLevels((current) =>
      current.includes(level) ? current.filter((l) => l !== level) : [...current, level],
    )
  return (
    <div className="sn-scroll">
      <SearchField
        value={query}
        onChange={setQuery}
        label="장소 검색"
        placeholder="장소 이름 (예: 강남역)"
      />
      <div className="sn-chips" role="group" aria-label="정렬">
        <FilterChip pressed={sort === 'crowded'} onClick={() => setSort('crowded')}>
          붐비는 순
        </FilterChip>
        <FilterChip pressed={sort === 'near'} disabled={!base} onClick={() => setSort('near')}>
          지도 중심에서 가까운 순
        </FilterChip>
      </div>
      <div className="sn-chips" role="group" aria-label="혼잡도 필터">
        {[...LEVELS, '정보 없음' as const].map((level) => (
          <FilterChip key={level} pressed={levels.includes(level)} onClick={() => toggle(level)}>
            <i className="sn-chip-dot" style={{ background: LEVEL_COLORS[level] }} />
            {level}
          </FilterChip>
        ))}
      </div>
      {live.error && live.places.length > 0 && (
        <p role="status">{live.error} 기존 위치를 유지하며 현재 값은 미확인으로 표시해요.</p>
      )}
      {live.status === 'loading' && !live.places.length ? (
        <LoadingSkeleton rows={4} />
      ) : live.status === 'error' && !live.places.length ? (
        <ErrorState title="서울 실시간 데이터를 불러오지 못했어요" onRetry={retryLive}>
          {live.error}
        </ErrorState>
      ) : shown.length ? (
        <PagedList
          key={`${query}${levels.join()}${sort}`}
          items={shown}
          initial={8}
          step={8}
          render={(place) => (
            <li key={place.code}>
              <button
                type="button"
                className="sn-live-card"
                onClick={() => selectLivePlace(place.code)}
              >
                <span className="sn-dot-level" style={{ background: LEVEL_COLORS[place.level] }} />
                <span className="sn-place-body">
                  <strong>{place.name}</strong>
                  <span className="sn-place-meta">
                    {range(place)}
                    {base && ` · ${km(distance(place))}`}
                  </span>
                </span>
                <StatusBadge tone={tone(place.level)}>{place.level}</StatusBadge>
              </button>
            </li>
          )}
        />
      ) : (
        <EmptyState title="조건에 맞는 장소가 없어요">
          필터를 바꾸거나 이름을 다시 확인해 보세요.
        </EmptyState>
      )}
      <details className="sn-section sn-more">
        <summary>데이터 출처와 유의사항</summary>
        <p className="sn-note">
          서울시 실시간 도시데이터(관측 구역 단위, 약 1분마다 갱신)입니다. 인구는 추정·가공 통계이며
          범위로 표시해요. 값이 없거나 갱신이 늦으면 "정보 없음"으로 보여줘요.
        </p>
        <SecondaryButton onClick={refreshCrowd}>혼잡 정보 다시 확인</SecondaryButton>
      </details>
    </div>
  )
}

function RoadsTopic({ summary }: { summary: ReturnType<typeof useRoadSummary> }) {
  return (
    <div className="sn-scroll">
      {summary.status === 'loading' && !summary.links ? (
        <LoadingNote>서울 도로 소통 정보를 불러오는 중이에요…</LoadingNote>
      ) : !summary.links ? (
        summary.error ? (
          <ErrorState title="도로 소통 정보를 불러오지 못했어요" onRetry={summary.refresh}>
            {summary.error}
          </ErrorState>
        ) : (
          <EmptyState
            title="속도가 확인된 도로가 없어요"
            action={<SecondaryButton onClick={summary.refresh}>다시 확인</SecondaryButton>}
          >
            도로 위치와 현재 소통 정보는 달라요. 관측값이 들어오면 표시할게요.
          </EmptyState>
        )
      ) : (
        <>
          <section className="sn-section" aria-labelledby="sn-home-roads">
            <h3 id="sn-home-roads">지금 서울 도로</h3>
            <FactRows
              rows={[
                ['평균 속도', `${Math.round(summary.average!)}km/h`],
                ['20km/h 미만', `${summary.buckets[0]}개 구간`],
                ['20~40km/h', `${summary.buckets[1]}개 구간`],
                ['40km/h 이상', `${summary.buckets[2]}개 구간`],
              ]}
            />
            <p className="sn-note">
              속도가 확인된 {summary.links.toLocaleString('ko-KR')}개 링크 기준이에요. 수집 중인
              도로만 포함되며 서울의 모든 도로는 아니에요.
            </p>
          </section>
          <section className="sn-section" aria-labelledby="sn-home-slow">
            <h3 id="sn-home-slow">느린 도로</h3>
            <PagedList
              items={summary.slow}
              initial={8}
              step={8}
              render={(road) => (
                <li key={road.name}>
                  <button
                    type="button"
                    className="sn-road-row"
                    onClick={() => focusMap(road.at[0], road.at[1], 15)}
                  >
                    <span className="sn-place-body">
                      <strong>{road.name}</strong>
                      <span className="sn-place-meta">{road.links}개 구간 평균</span>
                    </span>
                    <StatusBadge tone={road.speed < 20 ? 'bad' : road.speed < 40 ? 'warn' : 'good'}>
                      {Math.round(road.speed)}km/h
                    </StatusBadge>
                  </button>
                </li>
              )}
            />
          </section>
        </>
      )}
    </div>
  )
}
