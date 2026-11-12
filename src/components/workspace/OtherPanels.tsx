import ParkingRegistration from '../parking/ParkingRegistration'
import { usePages } from '../../api/usePages'
import type { ParkingSearchItem } from '../../api/queries'
import { apiParkingLot, nearbyParkingPage } from '../../api/parking/parkingApi'
import { estimatedWalkMinutes } from '../../lib/parking/walking'
import { compareParkingRows, hourlyBaseRate, type ParkingSort } from '../../lib/parking/sort'
import { useEffect, useRef, useState } from 'react'
import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { useAppState } from '../../state/useAppState'
import { parkingOperatingText } from '../../lib/parking/display'
import type { ParkingFacility } from '../../lib/parking/facilities'
import { useParkingData } from '../../hooks/useParkingData'
import Icon from '../common/Icon'
import {
  EmptyState,
  ErrorState,
  FilterChip,
  LoadingSkeleton,
  PagedList,
  PanelHeader,
  SearchField,
  SecondaryButton,
  StatusBadge,
} from '../common/ui'
import {
  distanceMeters,
  focusMap,
  PARKING_SELECT_EVENT,
  getMapOverlay,
  setMapOverlay,
} from '../../hooks/useRoute'
import type { Route } from '../../hooks/useRoute'

type Base = { lat: number; lng: number; label: string }
const SEOUL: [number, number] = [37.5665, 126.978]

export function ParkingPanel({ go }: { go: (route: Route) => void }) {
  const { active, result, layers, toggleLayer, workspaceCenter, selectParking, openDetail } =
    useParkingContext()
  const cached = useParkingData('map')
  const [incomingBase] = useState(() => getMapOverlay().parkingBase)
  const selected = result && !incomingBase ? placeById(active.selected, result) : undefined
  const center = workspaceCenter || SEOUL
  const [base, setBase] = useState<Base>(() =>
    incomingBase
      ? { lat: incomingBase.lat, lng: incomingBase.lng, label: incomingBase.name }
      : selected
        ? { lat: selected.lat, lng: selected.lon, label: selected.name }
        : { lat: center[0], lng: center[1], label: '지도 중심' },
  )
  const [radius, setRadius] = useState(0)
  const [sort, setSort] = useState<ParkingSort>('distance')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(() =>
    selected ? active.parkingSelections?.[selected.id] || null : null,
  )
  const nearby = radius === 0 && !query.trim() && sort === 'distance'
  const pages = usePages<ParkingSearchItem>(
    nearby ? '/parking/nearby' : '/parking/search',
    {
      latitude: base.lat,
      longitude: base.lng,
      ...(!nearby ? { radius_meters: radius || 1000, sort, name: query.trim() || undefined } : {}),
      limit: 20,
    },
    cached.kind === 'api',
    350,
    nearby ? nearbyParkingPage : undefined,
  )
  useEffect(() => () => setMapOverlay({ parkingBase: null }), [])
  const api = cached.kind === 'api'
  const { remember } = cached
  useEffect(() => {
    if (api && pages.items.length)
      remember(pages.items.map((item) => apiParkingLot(item.facility, item)))
  }, [api, pages.items, remember])
  const data = api
    ? {
        ...cached,
        status:
          pages.busy && !pages.items.length
            ? 'loading'
            : pages.error && !pages.items.length
              ? 'error'
              : 'success',
        error: pages.error,
        refresh: pages.refresh,
      }
    : cached
  const list = useRef<HTMLDivElement>(null)
  const pickedId = data.lots.find((lot) => picked && lot.memberIds.includes(picked))?.id
  const savedId = selected ? active.parkingSelections?.[selected.id] : undefined
  const savedLotId = data.lots.find((lot) => savedId && lot.memberIds.includes(savedId))?.id
  useEffect(() => {
    if (!layers.parking) toggleLayer('parking')
    // enable the marker layer once on entering this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    focusMap(base.lat, base.lng, 15)
  }, [base])
  useEffect(() => {
    const select = (event: Event) => setPicked((event as CustomEvent<{ id: string }>).detail.id)
    window.addEventListener(PARKING_SELECT_EVENT, select)
    return () => window.removeEventListener(PARKING_SELECT_EVENT, select)
  }, [])
  useEffect(() => {
    list.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [pickedId])
  const rows = api
    ? pages.items.map((item) => ({
        lot: {
          ...apiParkingLot(item.facility, item),
          memberIds: [item.facility.parking_id],
          lat: item.facility.coordinates.latitude,
          lng: item.facility.coordinates.longitude,
        },
        meters: Math.round(item.facility.distance_meters),
      }))
    : data.lots
        .filter(
          (lot): lot is ParkingFacility & { lat: number; lng: number } =>
            lot.lat !== null && lot.lng !== null,
        )
        .map((lot) => ({
          lot,
          meters: Math.round(distanceMeters([base.lat, base.lng], [lot.lat, lot.lng])),
        }))
        .filter((row) => row.meters <= (radius || 1000) && (!query || row.lot.name.includes(query)))
        .sort((a, b) => compareParkingRows(a, b, sort))
  return (
    <>
      <PanelHeader
        title="주차장"
        count={api ? pages.page?.total_count : data.status === 'success' ? rows.length : undefined}
        subtitle={
          <>
            <Icon name="pin" />
            {base.label} 주변 ·{' '}
            {nearby
              ? pages.page?.radius_meters
                ? `탐색 반경 ${pages.page.radius_meters}m`
                : '가까운 범위 탐색'
              : `반경 ${(radius || 1000) >= 1000 ? `${(radius || 1000) / 1000}km` : `${radius}m`}`}
          </>
        }
      />
      <div className="sn-scroll">
        <div className="sn-chips" role="group" aria-label="검색 기준">
          {selected && (
            <FilterChip
              pressed={base.label === selected.name}
              onClick={() =>
                setBase({ lat: selected.lat, lng: selected.lon, label: selected.name })
              }
            >
              선택한 장소
            </FilterChip>
          )}
          <FilterChip
            pressed={base.label === '지도 중심'}
            onClick={() => setBase({ lat: center[0], lng: center[1], label: '지도 중심' })}
          >
            이 지도 위치에서 재검색
          </FilterChip>
        </div>
        <div className="sn-chips" role="group" aria-label="검색 반경 및 정렬">
          <FilterChip
            pressed={nearby}
            onClick={() => {
              setRadius(0)
              setQuery('')
              setSort('distance')
            }}
          >
            가까운 범위
          </FilterChip>
          {[500, 1000, 2000].map((r) => (
            <FilterChip key={r} pressed={radius === r} onClick={() => setRadius(r)}>
              {r >= 1000 ? `${r / 1000}km` : `${r}m`}
            </FilterChip>
          ))}
          <span className="sn-spacer" />
          <label className="sn-parking-sort">
            <span className="sr-only">주차장 정렬</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as ParkingSort)}>
              <option value="distance">가까운 순</option>
              <option value="price">저렴한 순</option>
            </select>
          </label>
        </div>
        {nearby && (
          <p className="sn-note">
            300m → 500m → 1km 중 등록 시설이 처음 확인되는 범위를 조회해요. 반경이나 정렬을 선택하면
            전체 범위를 검색해요.
          </p>
        )}
        {sort === 'price' && (
          <p className="sn-note sn-parking-price-note">
            기본요금을 1시간으로 환산한 순서예요. 추가요금·할인은 반영되지 않으며, 요금 미확인·원천
            충돌은 뒤에 표시해요.
          </p>
        )}
        <SearchField
          value={query}
          onChange={setQuery}
          label="주차장 검색"
          placeholder="주차장 이름"
        />
        {data.error && rows.length > 0 && (
          <div className="sn-banner" role="status">
            갱신하지 못해 이전 정보를 보여주고 있어요.
          </div>
        )}
        {data.status === 'loading' && !rows.length ? (
          <LoadingSkeleton rows={4} />
        ) : data.status === 'error' && !rows.length ? (
          <ErrorState
            title="주차장 정보를 불러오지 못했어요"
            onRetry={pages.wait > 0 ? undefined : () => void data.refresh()}
          >
            {data.error}
          </ErrorState>
        ) : rows.length ? (
          <div ref={list}>
            <PagedList
              key={`${base.label}${radius}${sort}${query}`}
              items={rows}
              keep={rows.findIndex((row) => row.lot.id === pickedId)}
              render={({ lot, meters }) => (
                <li
                  key={lot.id}
                  className={`sn-parking-item ${pickedId === lot.id ? 'is-picked' : ''}`}
                >
                  <button
                    type="button"
                    className={`sn-parking-card ${pickedId === lot.id ? 'is-selected' : ''}`}
                    aria-pressed={pickedId === lot.id}
                    onClick={() => {
                      setPicked(lot.id)
                      window.dispatchEvent(
                        new CustomEvent(PARKING_SELECT_EVENT, { detail: { id: lot.id } }),
                      )
                      focusMap(lot.lat, lot.lng, 17)
                    }}
                  >
                    <span className="sn-parking-icon" aria-hidden="true">
                      <Icon name="car" />
                    </span>
                    <span className="sn-place-body">
                      <strong>{lot.name}</strong>
                      <span className="sn-place-meta sn-parking-address">
                        {lot.address || '주소 정보 없음'}
                      </span>
                      <span className="sn-place-meta">
                        {base.label}에서 직선{' '}
                        {meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`}
                      </span>
                      <span className="sn-place-facts">
                        {selected && savedLotId === lot.id && (
                          <StatusBadge tone="info">
                            <span className="sn-parking-confirmed">
                              <Icon name="check" />
                              선택한 주차장
                            </span>
                          </StatusBadge>
                        )}
                        {lot.available === null ? (
                          <StatusBadge>잔여 정보 없음</StatusBadge>
                        ) : lot.available === 0 ? (
                          <StatusBadge tone="bad">만차</StatusBadge>
                        ) : (
                          <StatusBadge tone="good">
                            잔여 {lot.available}
                            {lot.capacity !== null ? ` / 총 ${lot.capacity}` : ''}
                          </StatusBadge>
                        )}
                      </span>
                      <span className="sn-place-meta">
                        {lot.api ? lot.feeStatus : parkingOperatingText(lot)}
                      </span>
                      {sort === 'price' && hourlyBaseRate(lot) !== null && (
                        <span className="sn-place-meta sn-parking-price">
                          기본요금 환산 약{' '}
                          {Math.round(hourlyBaseRate(lot)!).toLocaleString('ko-KR')}원/시간
                        </span>
                      )}
                      {lot.collectedAt && (
                        <span className="sn-place-meta">갱신 {dateLabel(lot.collectedAt)}</span>
                      )}
                    </span>
                  </button>
                  {picked === lot.id && lot.api && <ParkingRegistration key={lot.id} lot={lot} />}
                  {picked === lot.id && selected && (
                    <div className="sn-parking-confirm">
                      <p>
                        {selected.name}까지 도보 약{' '}
                        {estimatedWalkMinutes(
                          distanceMeters([selected.lat, selected.lon], [lot.lat, lot.lng]),
                        )}
                        분 <span>· 추정</span>
                      </p>
                      <small>직선거리 기반 추정이며 실제 도보 경로와 다를 수 있어요.</small>
                      <SecondaryButton
                        onClick={() => {
                          selectParking(selected.id, lot.id, lot)
                          // Navigate to the detail route atomically so the hash listener keeps it open.
                          window.location.hash = '/recommend/detail'
                          openDetail(selected.id)
                        }}
                      >
                        이 주차장 선택
                      </SecondaryButton>
                    </div>
                  )}
                </li>
              )}
            />
          </div>
        ) : (
          <EmptyState title="이 범위에 주차장이 없어요">
            반경을 넓히거나 지도를 옮겨 다시 검색해 보세요.
          </EmptyState>
        )}
        {api && pages.page?.checked_at && (
          <p className="sn-note">조회: {dateLabel(pages.page.checked_at)}</p>
        )}
        {pages.wait > 0 && <p role="status">{pages.wait}초 후 다시 조회할 수 있어요.</p>}
        {api && pages.error && (
          <SecondaryButton disabled={pages.wait > 0} onClick={pages.refresh}>
            처음부터 다시 조회
          </SecondaryButton>
        )}
        {api && pages.page?.next_cursor && (
          <SecondaryButton
            disabled={pages.busy || pages.wait > 0 || pages.expired}
            onClick={pages.more}
          >
            주차장 더 보기
          </SecondaryButton>
        )}
        <p className="sn-note">
          거리는 직선거리예요. 요금 정보가 없다고 무료는 아니며, 잔여 면수가 없으면 “정보 없음”으로
          표시해요.
        </p>
        {selected && (
          <SecondaryButton onClick={() => go('recommend')}>
            <Icon name="chevronLeft" />
            추천 결과로 돌아가기
          </SecondaryButton>
        )}
      </div>
    </>
  )
}

function useParkingContext() {
  const app = useAppState()
  return {
    ...app,
    workspaceCenter: app.active.workspaceView?.map?.center as [number, number] | undefined,
  }
}

export function SavedPanel({ go }: { go: (route: Route) => void }) {
  const { savedTrips, result, currentTripSaved, saveCurrentTrip, openSavedTrip, removeSavedTrip } =
    useAppState()
  return (
    <>
      <PanelHeader
        title="저장"
        count={savedTrips.length}
        subtitle="이 브라우저에 보관된 추천이에요."
        actions={
          <SecondaryButton
            className="is-compact"
            disabled={!result?.entries.length || currentTripSaved}
            onClick={saveCurrentTrip}
          >
            <Icon name="bookmark" />
            {currentTripSaved ? '저장됨' : '현재 추천 저장'}
          </SecondaryButton>
        }
      />
      <div className="sn-scroll">
        {savedTrips.length ? (
          <ul className="sn-list">
            {savedTrips.map((saved) => (
              <li key={saved.id} className="sn-saved-card">
                <button
                  type="button"
                  className="sn-place-main"
                  aria-label={`${saved.title} 열기`}
                  onClick={() => {
                    openSavedTrip(saved.id)
                    go('recommend')
                  }}
                >
                  <span className="sn-place-body">
                    <strong>{saved.title}</strong>
                    <span className="sn-place-meta">{conditionText(saved.result.conditions)}</span>
                    <span className="sn-place-reason">
                      {saved.result.entries
                        .map((e) => placeById(e.id, saved.result)?.name)
                        .join(' · ')}
                    </span>
                    <span className="sn-place-meta">
                      {dateLabel(saved.savedAt)} 저장 · {saved.result.entries.length}곳
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="sn-saved-remove"
                  aria-label={`${saved.title} 저장 취소`}
                  title="저장 취소"
                  onClick={() => removeSavedTrip(saved.id)}
                >
                  <Icon name="bookmarkRemove" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="저장한 여행이 없어요">추천을 받은 뒤 저장해 보세요.</EmptyState>
        )}
      </div>
    </>
  )
}
