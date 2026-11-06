import { useEffect, useMemo, useState } from 'react'
import { useDemo } from '../../useDemo'
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
} from '../../live/store'
import Icon from '../Icon'
import { NearbyShopsSection, RouteSection } from './RouteSections'
import {
  EmptyState,
  ErrorState,
  FilterChip,
  LoadingSkeleton,
  PagedList,
  PanelHeader,
  PrimaryButton,
  SearchField,
  SecondaryButton,
  StatusBadge,
  type Tone,
} from './ui'
import { setMapOverlay } from './useRoute'
import type { Route } from './useRoute'

const tone = (level: Level): Tone =>
  level === '여유' ? 'info' : level === '보통' ? 'warn' : level === '정보 없음' ? 'neutral' : 'bad'
const range = (place: LivePlace) =>
  place.populationMin !== null && place.populationMax !== null
    ? `${place.populationMin.toLocaleString('ko-KR')}~${place.populationMax.toLocaleString('ko-KR')}명`
    : '관측값 없음'
/** Provider timestamps are Korea time without a zone. */
function minutesSince(value: string | null) {
  if (!value) return null
  const time = Date.parse(`${value.replace(' ', 'T')}:00+09:00`)
  return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 60000)) : null
}

function LiveDetailView({ place, go }: { place: LivePlace; go: (route: Route) => void }) {
  const { active } = useDemo()
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
            {place.sourceTime && ` 관측 ${place.sourceTime}`}
            {age !== null && age > 60 && ` · ${Math.floor(age / 60)}시간 이상 지난 값`}
          </p>
        </section>
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
        <RouteSection
          key={`r-${place.code}`}
          place={{ id: place.code, name: place.name, lat: place.lat, lon: place.lng }}
          departure={active.conditions.departure}
        />
        <NearbyShopsSection
          key={`s-${place.code}`}
          place={{ id: place.code, name: place.name, lat: place.lat, lon: place.lng }}
        />
        <SecondaryButton onClick={() => go('parking')}>
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
  const hasCommerce = detail.commerce.level || detail.commerce.categories.length
  return (
    <>
      <section className="sn-section" aria-labelledby="sn-l-road">
        <h3 id="sn-l-road">도로 소통</h3>
        {detail.road.level ? (
          <>
            <p>
              <StatusBadge tone={ROAD_TONE[detail.road.level] || 'neutral'}>
                {detail.road.level}
              </StatusBadge>{' '}
              평균 {detail.road.speed !== null ? `${detail.road.speed}km/h` : '속도 정보 없음'}
            </p>
            {detail.road.message && <p className="sn-note">{detail.road.message}</p>}
            {detail.road.segments.length > 0 && (
              <div className="sn-chips">
                {['정체', '서행', '원활'].map((level) => (
                  <StatusBadge key={level} tone={ROAD_TONE[level]}>
                    {level} {counts[level] || 0}구간
                  </StatusBadge>
                ))}
              </div>
            )}
            {worst.length > 0 && (
              <ul className="sn-plain">
                {worst.map((s, i) => (
                  <li key={i}>
                    <strong>{s.name}</strong>
                    <span>{s.speed !== null ? ` ${s.speed}km/h` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="sn-note">지도에 구간별 소통 상태가 표시돼요. {detail.road.time}</p>
          </>
        ) : (
          <p>도로 소통 정보가 제공되지 않았어요.</p>
        )}
      </section>
      <section className="sn-section" aria-labelledby="sn-l-shop">
        <h3 id="sn-l-shop">상권 현황</h3>
        {hasCommerce ? (
          <>
            {detail.commerce.level && (
              <p>
                상권 분위기 <StatusBadge>{detail.commerce.level}</StatusBadge>
                {detail.commerce.payments !== null &&
                  ` 최근 결제 ${detail.commerce.payments.toLocaleString('ko-KR')}건`}
              </p>
            )}
            {detail.commerce.categories.length > 0 && (
              <ul className="sn-plain">
                {detail.commerce.categories.slice(0, 6).map((c) => (
                  <li key={c.group + c.name}>
                    <strong>{c.name}</strong>
                    <span>
                      {' '}
                      {c.group}
                      {c.stores !== null ? ` · 가맹점 ${c.stores}곳` : ''}
                      {c.level ? ` · ${c.level}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
        {detail.parking.total ? (
          <>
            <p>등록된 주차장 {detail.parking.total}개</p>
            <ul className="sn-plain">
              {detail.parking.lots.slice(0, 4).map((lot, i) => (
                <li key={i}>
                  <strong>{lot.name}</strong>
                  <span>
                    {lot.capacity !== null ? ` · 총 ${lot.capacity}면` : ''}
                    {lot.available !== null
                      ? lot.available === 0
                        ? ' · 만차'
                        : ` · 잔여 ${lot.available}면`
                      : ''}
                    {lot.fee ? ` · ${lot.fee}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="sn-note">
              잔여 대수는 제공되는 주차장에만 표시돼요. 외부 차량 이용 가능 여부와 영업시간은
              확인되지 않으니 방문 전 확인하세요.
            </p>
          </>
        ) : (
          <p>이 구역에 연결된 주차장 정보가 없어요.</p>
        )}
      </section>
      {detail.weather && (
        <section className="sn-section" aria-labelledby="sn-l-wx">
          <h3 id="sn-l-wx">날씨</h3>
          <p>
            {detail.weather.temp !== null && `${detail.weather.temp}°C`}
            {detail.weather.air && ` · 대기 ${detail.weather.air}`}
          </p>
          {detail.weather.rain && <p className="sn-note">{detail.weather.rain}</p>}
        </section>
      )}
    </>
  )
}

export function HomePanel({ go }: { go: (route: Route) => void }) {
  const live = useLive()
  const { result } = useDemo()
  const [query, setQuery] = useState('')
  const [levels, setLevels] = useState<Level[]>([])
  const [category, setCategory] = useState<string | null>(null)
  const categories = useMemo(
    () => [...new Set(live.places.map((p) => p.category))].sort(),
    [live.places],
  )
  const shown = useMemo(
    () =>
      live.places
        .filter(
          (p) =>
            (!query || p.name.includes(query)) &&
            (!levels.length || levels.includes(p.level)) &&
            (!category || p.category === category),
        )
        .sort((a, b) => (b.populationMax ?? -1) - (a.populationMax ?? -1)),
    [live.places, query, levels, category],
  )
  const selected = live.places.find((p) => p.code === live.selected)
  if (selected) return <LiveDetailView key={selected.code} place={selected} go={go} />
  const toggle = (level: Level) =>
    setLevels((current) =>
      current.includes(level) ? current.filter((l) => l !== level) : [...current, level],
    )
  return (
    <>
      <PanelHeader
        title="서울 실시간"
        count={live.status === 'ready' ? shown.length : undefined}
        subtitle="서울시 실시간 도시데이터 · 장소를 누르면 혼잡도·교통·상권을 볼 수 있어요"
      />
      <div className="sn-scroll">
        <SearchField
          value={query}
          onChange={setQuery}
          label="장소 검색"
          placeholder="장소 이름 (예: 강남역)"
        />
        <div className="sn-chips" role="group" aria-label="혼잡도 필터">
          {[...LEVELS, '정보 없음' as const].map((level) => (
            <FilterChip key={level} pressed={levels.includes(level)} onClick={() => toggle(level)}>
              <i className="sn-chip-dot" style={{ background: LEVEL_COLORS[level] }} />
              {level}
            </FilterChip>
          ))}
        </div>
        <div className="sn-chips" role="group" aria-label="장소 유형 필터">
          <FilterChip pressed={category === null} onClick={() => setCategory(null)}>
            전체 유형
          </FilterChip>
          {categories.map((c) => (
            <FilterChip
              key={c}
              pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </FilterChip>
          ))}
        </div>
        {live.status === 'loading' && !live.places.length ? (
          <LoadingSkeleton rows={4} />
        ) : live.status === 'error' && !live.places.length ? (
          <ErrorState title="서울 실시간 데이터를 불러오지 못했어요" onRetry={retryLive}>
            {live.error}
          </ErrorState>
        ) : shown.length ? (
          <PagedList
            key={`${query}${levels.join()}${category}`}
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
                  <span
                    className="sn-dot-level"
                    style={{ background: LEVEL_COLORS[place.level] }}
                  />
                  <span className="sn-place-body">
                    <strong>{place.name}</strong>
                    <span className="sn-place-meta">
                      {place.category} · {range(place)}
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
        <section className="sn-section">
          <h3>조건에 맞춰 추천받기</h3>
          <p>출발지와 하고 싶은 일을 알려주면 장소를 추천해요.</p>
          <PrimaryButton onClick={() => go('recommend')}>
            <Icon name="sparkle" />
            {result ? `추천 ${result.entries.length}곳 보기` : 'AI 추천 시작'}
          </PrimaryButton>
        </section>
        <details className="sn-section sn-more">
          <summary>데이터 출처와 유의사항</summary>
          <p className="sn-note">
            서울시 실시간 도시데이터(관측 구역 단위, 약 1분마다 갱신)입니다. 인구는 추정·가공
            통계이며 범위로 표시해요. 값이 없거나 갱신이 늦으면 "정보 없음"으로 보여줘요.
          </p>
        </details>
      </div>
    </>
  )
}
