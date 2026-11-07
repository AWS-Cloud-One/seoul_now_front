import { useEffect, useRef, useState } from 'react'
import { DEPARTURES } from '../../domain.js'
import {
  ApiProblem,
  fetchDirections,
  fetchNearbyShops,
  kilometers,
  minutes,
  SHOP_KINDS,
  type FoodPlace,
  type RouteResult,
  type ShopKind,
} from '../../routing/api'
import Icon from '../Icon'
import {
  EmptyState,
  ErrorState,
  FilterChip,
  LoadingSkeleton,
  PrimaryButton,
  SecondaryButton,
} from './ui'
import { focusMap, FOOD_SELECT_EVENT, setMapOverlay } from './useRoute'
import { ROUTE_TRAFFIC } from '../../routing/traffic'

const ME = '__me__'
/** Small stand-in mark (yellow tile + pin), not the official Kakao asset. */
function KakaoMapMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#fee500" />
      <path
        d="M12 5.5a4.6 4.6 0 0 0-4.6 4.6c0 3.3 4.6 8.4 4.6 8.4s4.6-5.1 4.6-8.4A4.6 4.6 0 0 0 12 5.5Zm0 6.3a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z"
        fill="#3b1e1e"
      />
    </svg>
  )
}
export type Target = { id: string; name: string; lat: number; lon: number }
type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: T }
  | { status: 'error'; message: string }

const problem = (error: unknown): Load<never> => ({
  status: 'error',
  message: error instanceof ApiProblem ? error.message : '알 수 없는 오류가 발생했어요.',
})

function useLoader<T>(run: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<Load<T>>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const latest = useRef(run)
  useEffect(() => {
    latest.current = run
  })
  // Callers remount this hook per place (key), so state resets by itself; just cancel on unmount.
  useEffect(() => () => controller.current?.abort(), [])
  const load = () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setState({ status: 'loading' })
    latest.current(current.signal).then(
      (data) => {
        if (!current.signal.aborted) setState({ status: 'done', data })
      },
      (error) => {
        if (!current.signal.aborted) setState(problem(error))
      },
    )
  }
  const reset = () => {
    controller.current?.abort()
    setState({ status: 'idle' })
  }
  return [state, load, reset] as const
}

export function RouteSection({
  place,
  departure,
  originOverride,
}: {
  place: Target
  departure: string | null
  originOverride?: Target | null
}) {
  const [chosen, setChosen] = useState(departure && DEPARTURES[departure] ? departure : '')
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null)
  const [locating, setLocating] = useState<string | null>(null)
  const origin =
    originOverride !== undefined
      ? originOverride
      : chosen === ME
        ? (me ?? undefined)
        : chosen
          ? DEPARTURES[chosen]
          : undefined
  const [state, load, reset] = useLoader<RouteResult>((signal) =>
    fetchDirections(origin!, place, signal),
  )
  const choose = (value: string) => {
    setChosen(value)
    setLocating(null)
    reset()
    if (value !== ME) return
    if (!navigator.geolocation) {
      setLocating('이 브라우저는 위치 기능을 지원하지 않아요.')
      return
    }
    setLocating('내 위치를 확인하는 중이에요…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMe({ lat: position.coords.latitude, lon: position.coords.longitude })
        setLocating(null)
      },
      (error) =>
        setLocating(
          error.code === error.PERMISSION_DENIED
            ? '위치 권한이 거부됐어요. 브라우저 설정에서 허용하거나 목록에서 출발지를 골라 주세요.'
            : '내 위치를 가져오지 못했어요. 목록에서 출발지를 골라 주세요.',
        ),
      { timeout: 10000 },
    )
  }
  useEffect(() => {
    setMapOverlay({
      route: state.status === 'done' ? state.data.path : null,
      routeSegments: state.status === 'done' ? state.data.segments || [] : null,
      origin:
        state.status === 'done' && origin
          ? { ...origin, name: originOverride?.name || (chosen === ME ? '내 위치' : chosen) }
          : null,
    })
    return () => setMapOverlay({ route: null, routeSegments: null, origin: null })
  }, [state, origin, originOverride?.name, chosen])
  return (
    <section className="sn-section" aria-labelledby="sn-route-title">
      <h3 id="sn-route-title">가는 길</h3>
      {originOverride === undefined && (
        <label className="sn-field">
          출발지
          <select value={chosen} onChange={(event) => choose(event.target.value)}>
            <option value="">출발지를 선택해 주세요</option>
            <option value={ME}>내 위치</option>
            {Object.keys(DEPARTURES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {locating ? (
        <p className="sn-note" role="status">
          {locating}
        </p>
      ) : (
        !origin && <p className="sn-note">출발지를 선택하면 길찾기를 할 수 있어요.</p>
      )}
      {state.status === 'idle' || state.status === 'loading' ? (
        <PrimaryButton onClick={load} disabled={!origin || state.status === 'loading'}>
          <Icon name="car" />
          {state.status === 'loading' ? '경로 찾는 중…' : `${place.name}까지 길찾기`}
        </PrimaryButton>
      ) : state.status === 'error' ? (
        <ErrorState title="경로를 불러오지 못했어요" onRetry={load}>
          {state.message}
        </ErrorState>
      ) : (
        <>
          <dl className="sn-facts is-two">
            <div>
              <dt>소요 시간</dt>
              <dd>자동차 {minutes(state.data.duration)}분</dd>
              <small>실제 경로 · 카카오모빌리티</small>
            </div>
            <div>
              <dt>거리</dt>
              <dd>{kilometers(state.data.distance)}</dd>
              <small>
                {state.data.taxiFare !== null
                  ? `택시 약 ${state.data.taxiFare.toLocaleString('ko-KR')}원`
                  : '요금 정보 없음'}
              </small>
            </div>
          </dl>
          <p className="sn-note">
            지금 교통 상황 기준 추천 경로예요. 주차 시간과 도보 시간은 포함되지 않아요.
          </p>
          <div className="sn-route-legend" aria-label="경로 교통 상태 색상">
            {ROUTE_TRAFFIC.map((item) => (
              <span key={item.state}>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
          <SecondaryButton className="is-compact" onClick={load}>
            <Icon name="refresh" />
            다시 조회
          </SecondaryButton>
        </>
      )}
    </section>
  )
}

export function NearbyShopsSection({ place }: { place: Target }) {
  const RADIUS = 800
  const [kind, setKind] = useState<ShopKind>('food')
  const [state, load] = useLoader<FoodPlace[]>((signal) =>
    fetchNearbyShops(kind, place, RADIUS, signal),
  )
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => {
    setMapOverlay({ food: state.status === 'done' ? state.data : null })
    return () => setMapOverlay({ food: null })
  }, [state])
  useEffect(() => {
    const select = (event: Event) => setPicked((event as CustomEvent<{ id: string }>).detail.id)
    window.addEventListener(FOOD_SELECT_EVENT, select)
    return () => window.removeEventListener(FOOD_SELECT_EVENT, select)
  }, [])
  const label = SHOP_KINDS[kind].label
  return (
    <section className="sn-section" aria-labelledby="sn-shop-title">
      <h3 id="sn-shop-title">근처 상가</h3>
      <div className="sn-chips" role="group" aria-label="상가 종류">
        {(Object.keys(SHOP_KINDS) as ShopKind[]).map((key) => (
          <FilterChip
            key={key}
            pressed={kind === key}
            onClick={() => {
              setKind(key)
              setPicked(null)
              setMapOverlay({ food: null })
            }}
          >
            {SHOP_KINDS[key].label}
          </FilterChip>
        ))}
      </div>
      {state.status === 'idle' ? (
        <SecondaryButton onClick={load}>
          <Icon name="food" />
          {place.name} 반경 {RADIUS}m {label} 찾기
        </SecondaryButton>
      ) : state.status === 'loading' ? (
        <LoadingSkeleton rows={2} />
      ) : state.status === 'error' ? (
        <ErrorState title={`${label}을 불러오지 못했어요`} onRetry={load}>
          {state.message}
        </ErrorState>
      ) : state.data.length ? (
        <>
          <ol className="sn-list">
            {state.data.slice(0, 8).map((shop) => (
              <li key={shop.id} className="sn-food-item">
                <button
                  type="button"
                  className={`sn-food-card ${picked === shop.id ? 'is-selected' : ''}`}
                  aria-pressed={picked === shop.id}
                  onClick={() => {
                    setPicked(shop.id)
                    focusMap(shop.lat, shop.lng, 17)
                  }}
                >
                  <strong>{shop.name}</strong>
                  <span className="sn-place-meta">
                    {shop.category} · 직선 {kilometers(shop.meters)}
                  </span>
                  {shop.address && <span className="sn-place-meta">{shop.address}</span>}
                </button>
                {shop.url && (
                  <a
                    className="sn-kakao-link"
                    href={shop.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${shop.name} 카카오맵에서 보기 (새 창)`}
                    title="카카오맵에서 보기"
                  >
                    <KakaoMapMark />
                  </a>
                )}
              </li>
            ))}
          </ol>
          <p className="sn-note">
            카카오 장소 검색 결과예요. 영업 여부와 평점은 확인되지 않아 표시하지 않아요.
          </p>
          <SecondaryButton className="is-compact" onClick={load}>
            <Icon name="refresh" />
            다시 조회
          </SecondaryButton>
        </>
      ) : (
        <EmptyState title={`반경 안에 ${label}이 없어요`}>다른 장소를 선택해 보세요.</EmptyState>
      )}
    </section>
  )
}
