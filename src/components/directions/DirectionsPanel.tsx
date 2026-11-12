import { useEffect, useMemo, useState } from 'react'
import OriginSearch from './OriginSearch'
import {
  fetchLiveDetail,
  LEVEL_COLORS,
  selectLivePlace,
  useLive,
  type LiveDetail,
} from '../../state/live/store'
import { foundPlace } from '../../api/routing'
import { usePages } from '../../api/usePages'
import type { FoundPlaceData } from '../../api/queries'
import Icon from '../common/Icon'
import { NearbyShopsSection, RouteSection, type Target } from '../place/RouteSections'
import { EmptyState, PanelHeader, SearchField, SecondaryButton, StatusBadge } from '../common/ui'
import { focusMap, setMapOverlay } from '../../hooks/useRoute'
import type { Route } from '../../hooks/useRoute'

type Destination = {
  id: string
  name: string
  lat: number
  lon: number
  sub: string
  /** Set when the destination is one of the Seoul real-time city-data places. */
  liveCode?: string
}

/** Congestion around the destination, only available for Seoul real-time places. */
function ArrivalConditions({ code, onOpen }: { code: string; onOpen: () => void }) {
  const live = useLive()
  const place = live.places.find((p) => p.code === code)
  const [detail, setDetail] = useState<LiveDetail | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchLiveDetail(code, controller.signal).then(
      (data) => !controller.signal.aborted && setDetail(data),
      () => undefined,
    )
    return () => controller.abort()
  }, [code])
  if (!place) return null
  return (
    <section className="sn-section" aria-labelledby="sn-d-arrive">
      <h3 id="sn-d-arrive">도착지 주변 상황</h3>
      <p>
        <span className="sn-dot-level" style={{ background: LEVEL_COLORS[place.level] }} /> 혼잡도{' '}
        <strong>{place.level}</strong>
        {place.sourceTime && <span className="sn-note"> · {place.sourceTime} 관측 구역 기준</span>}
      </p>
      {detail?.road.level ? (
        <p>
          도로 소통 <StatusBadge>{detail.road.level}</StatusBadge>
          {detail.road.speed !== null && ` 평균 ${detail.road.speed}km/h`}
        </p>
      ) : null}
      <button
        type="button"
        className="sn-link"
        onClick={() => {
          selectLivePlace(code)
          onOpen()
        }}
      >
        이 장소 상세(상권·주차·교통 구간) 보기
      </button>
    </section>
  )
}

export default function DirectionsPanel({ go }: { go: (route: Route) => void }) {
  const live = useLive()
  const [origin, setOrigin] = useState<Target | null>(null)
  const [query, setQuery] = useState('')
  const [dest, setDest] = useState<Destination | null>(null)
  const search = usePages<FoundPlaceData>(
    '/locations/places/search',
    { query: query.trim(), limit: 10 },
    !dest && query.trim().length >= 2,
  )
  const found = {
    status:
      search.busy && !search.items.length
        ? 'loading'
        : search.error && !search.items.length
          ? 'error'
          : 'done',
    data: search.items.map(foundPlace),
    message: search.error,
  }

  const livePlaces = useMemo(
    () =>
      query.trim() ? live.places.filter((p) => p.name.includes(query.trim())).slice(0, 5) : [],
    [live.places, query],
  )
  const choose = (next: Destination) => {
    setDest(next)
    setMapOverlay({ destination: { name: next.name, lat: next.lat, lng: next.lon } })
    focusMap(next.lat, next.lon, 15)
  }
  const searching = query.trim().length > 0
  return (
    <>
      <PanelHeader
        title="길찾기"
        subtitle="출발지와 도착지를 정하면 자동차 경로와 도착지 주변 상황을 보여줘요."
      />
      <div className="sn-scroll">
        <OriginSearch value={origin} onChange={setOrigin} />
        <section className="sn-section" aria-labelledby="sn-dir-dest">
          <h3 id="sn-dir-dest">도착지</h3>
          {dest ? (
            <div className="sn-dest-chosen">
              <Icon name="pin" />
              <span className="sn-place-body">
                <strong>{dest.name}</strong>
                <span className="sn-place-meta">{dest.sub}</span>
              </span>
              <SecondaryButton
                className="is-compact"
                onClick={() => {
                  setDest(null)
                  setMapOverlay({ destination: null })
                  setQuery('')
                }}
              >
                바꾸기
              </SecondaryButton>
            </div>
          ) : (
            <>
              <SearchField
                value={query}
                onChange={(value) => {
                  setQuery(value)
                }}
                label="도착지 검색"
                placeholder="가고 싶은 곳 (예: 강남역, 경복궁, 성수 카페)"
              />
              {searching && (
                <ul className="sn-dest-list">
                  {livePlaces.map((place) => (
                    <li key={place.code}>
                      <button
                        type="button"
                        onClick={() =>
                          choose({
                            id: place.code,
                            name: place.name,
                            lat: place.lat,
                            lon: place.lng,
                            sub: `${place.category} · 서울 실시간 데이터`,
                            liveCode: place.code,
                          })
                        }
                      >
                        <span
                          className="sn-dot-level"
                          style={{ background: LEVEL_COLORS[place.level] }}
                        />
                        <span className="sn-place-body">
                          <strong>{place.name}</strong>
                          <span className="sn-place-meta">
                            {place.category} · 혼잡 {place.level}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {found.status === 'done' &&
                    found.data.map((place) => (
                      <li key={place.id}>
                        <button
                          type="button"
                          onClick={() =>
                            choose({
                              id: place.id,
                              name: place.name,
                              lat: place.lat,
                              lon: place.lng,
                              sub: place.address || place.category,
                            })
                          }
                        >
                          <Icon name="pin" />
                          <span className="sn-place-body">
                            <strong>{place.name}</strong>
                            <span className="sn-place-meta">
                              {place.category}
                              {place.address ? ` · ${place.address}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {found.status === 'loading' && <p className="sn-note">장소를 찾는 중이에요…</p>}
              {search.error && (
                <p role="alert" className="sn-note">
                  {search.error}
                </p>
              )}
              {searching &&
                query.trim().length >= 2 &&
                found.status === 'done' &&
                !found.data.length &&
                !livePlaces.length && (
                  <EmptyState title="검색 결과가 없어요">다른 이름으로 찾아보세요.</EmptyState>
                )}
              {search.wait > 0 && <p>{search.wait}초 후 다시 조회할 수 있어요.</p>}
              {search.error && (
                <SecondaryButton disabled={search.wait > 0} onClick={search.refresh}>
                  도착지 검색 다시 시도
                </SecondaryButton>
              )}
              {search.page?.next_cursor && (
                <SecondaryButton
                  disabled={search.busy || search.wait > 0 || search.expired}
                  onClick={search.more}
                >
                  도착지 더 보기
                </SecondaryButton>
              )}
              {!searching && (
                <p className="sn-note">서울 인구 관측 구역은 혼잡도·도로 소통도 함께 보여줘요.</p>
              )}
            </>
          )}
        </section>
        {dest && (
          <>
            <RouteSection
              key={`route-${dest.id}-${origin?.id || ''}`}
              place={{ id: dest.id, name: dest.name, lat: dest.lat, lon: dest.lon }}
              departure={null}
              originOverride={origin}
            />
            {dest.liveCode && (
              <ArrivalConditions
                key={`arrive-${dest.id}`}
                code={dest.liveCode}
                onOpen={() => go('home')}
              />
            )}
            <NearbyShopsSection
              key={`shops-${dest.id}`}
              place={{ id: dest.id, name: dest.name, lat: dest.lat, lon: dest.lon }}
            />
            <SecondaryButton
              onClick={() => {
                setMapOverlay({ parkingBase: { name: dest.name, lat: dest.lat, lng: dest.lon } })
                go('parking')
              }}
            >
              <Icon name="parking" />
              도착지 주변 주차장 보기
            </SecondaryButton>
          </>
        )}
        {!dest && <p className="sn-note">출발지와 도착지를 검색해 선택해 주세요.</p>}
      </div>
    </>
  )
}
