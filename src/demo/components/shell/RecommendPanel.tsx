import { useState } from 'react'
import { conditionText, dateLabel, placeById, validateConditions } from '../../domain.js'
import { PanelTabs } from './ChatPanel'
import { SelectionSummary } from './MapOverlays'
import { focusMap } from './useRoute'
import { useDemo } from '../../useDemo'
import type { Entry, Place } from '../../types'
import ConditionsForm from '../ConditionsForm'
import Icon from '../Icon'
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PanelHeader,
  PrimaryButton,
  SearchField,
  SecondaryButton,
  StatusBadge,
} from './ui'
import { NearbyShopsSection, RouteSection } from './RouteSections'
import type { Route } from './useRoute'

const categoryIcon: Record<string, string> = {
  카페: 'coffee',
  식사: 'food',
  산책: 'walk',
  전시: 'art',
}
const iconFor = (category: string) => categoryIcon[category] || 'pin'
const etaText = (entry: Entry) =>
  entry.eta === null ? '이동시간 확인 불가' : `목적지까지 자동차 ${entry.eta}분`
/** Straight-line metres are not a walking time; scale by 1.3 for street detours at ~4km/h and say it is an estimate. */
const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 67))
/** Car time plus the walk from the nearest registered lot; both are estimates, so say so. */
const doorToDoor = (entry: Entry, place: Place) =>
  entry.eta === null || entry.parkingUnknown || !place.parking?.length
    ? null
    : entry.eta + walkMinutes(Math.min(...place.parking.map((p) => p.distance)))

/** Tags help compare places, so drop ones that repeat the area or category already shown. */
const usefulTags = (place: Place) =>
  (place.tags || []).filter((tag) => ![place.category, place.area, place.district].includes(tag))

function PlaceCard({
  index,
  entry,
  place,
  selected,
}: {
  index: number
  entry: Entry
  place: Place
  selected: boolean
}) {
  const { selectPlace, openDetail, patchUI, ui } = useDemo()
  return (
    <li>
      <div
        className={`sn-place-card ${selected ? 'is-selected' : ''} ${ui.hover === entry.id ? 'is-hover' : ''}`}
        onMouseEnter={() => patchUI({ hover: entry.id })}
        onMouseLeave={() => patchUI({ hover: null })}
      >
        <button
          type="button"
          className="sn-place-main"
          aria-pressed={selected}
          aria-label={`${index + 1}번 ${place.name} 선택`}
          onClick={() => {
            selectPlace(entry.id)
            focusMap(place.lat, place.lon, 16)
          }}
        >
          <span className="sn-rank" aria-hidden="true">
            {index + 1}
          </span>
          <span className="sn-place-body">
            <strong>{place.name}</strong>
            <span className="sn-place-meta">
              <Icon name={iconFor(place.category)} />
              {place.category} · {place.area}
            </span>
            <span className="sn-place-reason">{entry.reason}</span>
            <span className="sn-place-facts">
              <StatusBadge tone={entry.eta === null ? 'neutral' : 'info'}>
                {etaText(entry)}
              </StatusBadge>
              {doorToDoor(entry, place) !== null && (
                <StatusBadge tone="neutral">
                  주행·도보 합계 약 {doorToDoor(entry, place)}분(추정)
                </StatusBadge>
              )}
            </span>
            {usefulTags(place).length > 0 && (
              <span className="sn-place-tags">
                {usefulTags(place)
                  .slice(0, 3)
                  .map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          className="sn-place-more"
          aria-label={`${place.name} 상세 보기`}
          onClick={() => openDetail(entry.id)}
        >
          <Icon name="chevronRight" />
        </button>
      </div>
    </li>
  )
}

function PlaceDetailView({ go }: { go: (route: Route) => void }) {
  const { active, result, ui, patchUI, exclude, saveCurrentTrip, currentTripSaved } = useDemo()
  const detail = ui.detail
  const place = placeById(detail?.id)
  const entry = result?.entries.find((e) => e.id === detail?.id)
  if (!detail || !place || !entry || !result) return null
  const number = result.entries.findIndex((e) => e.id === entry.id) + 1
  const unknown = entry.parkingUnknown || !place.parking?.length
  return (
    <div className="sn-detail">
      <PanelHeader
        title={place.name}
        back={{ label: '추천 목록', onClick: () => patchUI({ detail: null }) }}
        subtitle={
          <>
            <span className="sn-rank is-small">{number}</span> {place.category} · {place.address}
          </>
        }
      />
      <div className="sn-scroll">
        <div className="sn-action-row">
          <PrimaryButton onClick={() => go('parking')}>
            <Icon name="parking" />
            주변 주차장
          </PrimaryButton>
          <SecondaryButton disabled={currentTripSaved} onClick={saveCurrentTrip}>
            <Icon name="bookmark" />
            {currentTripSaved ? '저장됨' : '저장'}
          </SecondaryButton>
        </div>
        <section className="sn-section" aria-labelledby="sn-d-now">
          <h3 id="sn-d-now">현재 상황</h3>
          <dl className="sn-facts">
            <div>
              <dt>이동시간</dt>
              <dd>{entry.eta === null ? '확인 불가' : `자동차 ${entry.eta}분`}</dd>
              <small>목적지까지 · 모의 경로 · 도보 제외</small>
            </div>
            <div>
              <dt>주차장에서 목적지까지</dt>
              <dd>
                {unknown
                  ? '정보 없음'
                  : `도보 약 ${walkMinutes(Math.min(...place.parking!.map((p) => p.distance)))}분(추정)`}
              </dd>
              <small>외부 이용·빈자리는 확인 안 됨</small>
            </div>
            <div>
              <dt>혼잡도</dt>
              <dd>정보 없음</dd>
              <small>이 장소엔 연결된 관측 없음</small>
            </div>
          </dl>
        </section>
        <RouteSection key={place.id} place={place} departure={result.conditions.departure} />
        <NearbyShopsSection key={`food-${place.id}`} place={place} />
        <section className="sn-section" aria-labelledby="sn-d-why">
          <h3 id="sn-d-why">추천 이유</h3>
          <p>{entry.reason}</p>
        </section>
        <details className="sn-section sn-more">
          <summary>출처와 상세 정보</summary>
          <dl className="sn-kv">
            <dt>추천 당시 조건</dt>
            <dd>{conditionText(result.conditions)}</dd>
            <dt>출처</dt>
            <dd>
              모의 장소 · 모의 경로 응답
              <br />
              추천 계산 {dateLabel(entry.queryTime)} 기준 · {entry.sourceStatus}
              <br />
              주차 잔여 대수는 실시간이 아니에요
            </dd>
            <dt>주차 탐색 범위</dt>
            <dd>직선 반경 {place.parkingRadius === 1000 ? '1km' : `${place.parkingRadius}m`}</dd>
          </dl>
          <p className="sn-note">실시간 교통·영업 여부·주차 여유는 확인되지 않은 예시 정보예요.</p>
          <SecondaryButton
            disabled={active.excluded.includes(place.id)}
            onClick={() => exclude(place.id)}
          >
            {active.excluded.includes(place.id) ? '다음 탐색에서 제외돼요' : '이번 여행에서 제외'}
          </SecondaryButton>
        </details>
      </div>
    </div>
  )
}

export default function RecommendPanel({ go }: { go: (route: Route) => void }) {
  const {
    active,
    result,
    ui,
    newTrip,
    openEdit,
    search,
    retrySearch,
    startTrip,
    updateDraft,
    openDetail,
  } = useDemo()
  const [query, setQuery] = useState('')
  if (!active.onboardingComplete) {
    const draft = active.onboardingDraft || active.conditions
    const invalid = validateConditions(draft)
    return (
      <>
        <PanelHeader title="AI 추천" subtitle="출발지와 하고 싶은 일을 알려주세요." />
        <div className="sn-scroll sn-form">
          <ConditionsForm
            initial={draft}
            mode="onboarding"
            onSubmit={(c) => void startTrip(c)}
            onChange={updateDraft}
          />
        </div>
        <footer className="sn-panel-foot">
          <PrimaryButton type="submit" form="onboarding-form" disabled={!!invalid || ui.busy}>
            {ui.busy ? '찾는 중…' : '이 조건으로 찾아보기'}
          </PrimaryButton>
        </footer>
      </>
    )
  }
  if (ui.detail && result) return <PlaceDetailView go={go} />
  const stale = result && active.retainedResult?.id === result.id && !ui.busy
  const entries = (result?.entries || []).filter((entry) => {
    const place = placeById(entry.id)
    return place && (!query || `${place.name} ${place.category} ${place.area}`.includes(query))
  })
  const conditions = result?.conditions || ui.progress?.conditions || active.conditions
  return (
    <>
      <PanelTabs route="recommend" go={go} />
      <PanelHeader
        title="추천 장소"
        count={result?.entries.length}
        actions={
          <SecondaryButton className="is-compact" onClick={openEdit} disabled={ui.busy}>
            <Icon name="edit" />
            조건 수정
          </SecondaryButton>
        }
        subtitle={<span className="sn-summary">{conditionText(conditions)}</span>}
      />
      <div className="sn-scroll">
        <SelectionSummary
          variant="panel"
          onDetail={() => active.selected && openDetail(active.selected)}
          onParking={() => go('parking')}
        />
        {ui.notice && (
          <ErrorState
            title={ui.notice.type === 'info' ? '안내' : '추천을 불러오지 못했어요'}
            onRetry={() => void retrySearch()}
          >
            {ui.notice.text}
            {result && ' 아래 목록은 이전에 찾은 결과예요.'}
          </ErrorState>
        )}
        {stale && (
          <div className="sn-banner" role="status">
            <Icon name="history" />
            {new Date(result.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 결과를
            유지하고 있어요.
          </div>
        )}
        {ui.busy && (
          <div className="sn-banner is-busy" role="status">
            {ui.progress?.detail || '추천을 찾는 중이에요…'}
          </div>
        )}
        {result?.entries.length ? (
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              label="추천 장소 검색"
              placeholder="추천 결과에서 검색"
            />
            {entries.length ? (
              <ol className="sn-list">
                {entries.map((entry) => (
                  <PlaceCard
                    key={entry.id}
                    index={result.entries.indexOf(entry)}
                    entry={entry}
                    place={placeById(entry.id)!}
                    selected={active.selected === entry.id}
                  />
                ))}
              </ol>
            ) : (
              <EmptyState title="검색 결과가 없어요">다른 이름으로 찾아보세요.</EmptyState>
            )}
          </>
        ) : ui.busy ? (
          <LoadingSkeleton />
        ) : (
          <EmptyState
            title="조건에 맞는 장소가 없어요"
            action={<PrimaryButton onClick={openEdit}>조건 수정</PrimaryButton>}
          >
            이동시간이나 키워드를 바꿔보세요.
          </EmptyState>
        )}
      </div>
      <footer className="sn-panel-foot is-row">
        <SecondaryButton
          className="is-compact"
          disabled={ui.busy}
          onClick={() => void search(active.conditions)}
        >
          <Icon name="refresh" />
          {ui.busy ? '찾는 중…' : '다른 곳도'}
        </SecondaryButton>
        <SecondaryButton className="is-compact" onClick={() => go('chat')}>
          <Icon name="sparkle" />
          AI에게 조건 수정
        </SecondaryButton>
        <button type="button" className="sn-link" onClick={newTrip} disabled={ui.busy}>
          새 여행
        </button>
      </footer>
    </>
  )
}
