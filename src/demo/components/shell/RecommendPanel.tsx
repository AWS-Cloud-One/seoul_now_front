import ApiPlaceDetail from './ApiPlaceDetail'
import ResultContextNotice from '../ResultContextNotice'
import { resultContextStatus, displayConditions } from '../../apiState'
import { conditionsEqual } from '../../domain.js'
import { useSelectedParking } from '../../parking/useSelectedParking'
import { conditionText, dateLabel, DEPARTURES, placeById } from '../../domain.js'
import { PanelTabs } from './ChatPanel'
import { fitMap, focusMap } from './useRoute'
import { useDemo } from '../../useDemo'
import type { Entry, Place } from '../../types'
import ConditionsForm from '../ConditionsForm'
import RecommendationFeedback from '../RecommendationFeedback'
import ResponsePending from '../ResponsePending'
import { validateRecommendation } from '../../recommendationConditions'
import { useSecondsRemaining } from '../../useSecondsRemaining'
import Icon from '../Icon'
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PanelHeader,
  PrimaryButton,
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
  entry.eta === null ? '이동시간 확인 불가' : `자동차 약 ${entry.eta}분`
/** Tags help compare places, so drop ones that repeat the area or category already shown. */
const usefulTags = (place: Place) =>
  (place.tags || []).filter((tag) => ![place.category, place.area, place.district].includes(tag))

function PlaceCard({
  index,
  entry,
  place,
  selected,
  go,
}: {
  index: number
  entry: Entry
  place: Place
  selected: boolean
  go: (route: Route) => void
}) {
  const { selectPlace, openDetail, patchUI, ui, result } = useDemo()
  const departure = result?.conditions.departure
  const origin = result?.conditions.origin
    ? {
        lat: result.conditions.origin.coordinates.latitude,
        lon: result.conditions.origin.coordinates.longitude,
      }
    : departure
      ? DEPARTURES[departure]
      : undefined
  const parking = useSelectedParking(place.id)
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
          aria-expanded={selected}
          aria-controls={selected ? `place-extra-${entry.id}` : undefined}
          aria-label={`${index + 1}번 ${place.name} 선택`}
          onClick={() => {
            selectPlace(entry.id)
            focusMap(place.lat, place.lon, 16)
          }}
        >
          <span className="sn-place-body">
            <span className="sn-place-heading">
              <span className="sn-rank" aria-hidden="true">
                {result?.api?.result.cards[index]?.rank === null ? '·' : index + 1}
              </span>
              <strong>{place.name}</strong>
            </span>
            <span className="sn-place-meta">
              <Icon name={iconFor(place.category)} />
              {place.category} · {place.area}
            </span>
            <span className="sn-place-reason">{place.description || entry.reason}</span>
            <span className="sn-place-facts">
              <StatusBadge tone={entry.eta === null ? 'neutral' : 'info'}>
                {etaText(entry)}
              </StatusBadge>
            </span>
            {usefulTags(place).length > 0 && (
              <span className="sn-place-tags">
                {usefulTags(place)
                  .slice(0, 2)
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
        {selected && (
          <section
            className="sn-place-expanded"
            id={`place-extra-${entry.id}`}
            aria-label="선택한 장소 추가 정보"
          >
            <p className="sn-place-walk">
              <Icon name="walk" />
              {parking
                ? `${parking.lot.name} · 도보 약 ${parking.minutes}분 · 추정`
                : '주차장을 선택해 주세요'}
            </p>
            <div className="sn-place-expanded-actions">
              <PrimaryButton className="is-compact" onClick={() => openDetail(entry.id)}>
                상세 보기
              </PrimaryButton>
              {origin && (
                <SecondaryButton
                  className="is-compact"
                  onClick={() =>
                    fitMap([
                      [origin.lat, origin.lon],
                      [place.lat, place.lon],
                    ])
                  }
                >
                  경로 범위 보기
                </SecondaryButton>
              )}
              <SecondaryButton className="is-compact" onClick={() => go('parking')}>
                주변 주차장
              </SecondaryButton>
            </div>
          </section>
        )}
      </div>
    </li>
  )
}

function PlaceDetailView({ go }: { go: (route: Route) => void }) {
  const { active, result, ui, patchUI, exclude, saveCurrentTrip, currentTripSaved } = useDemo()
  const detail = ui.detail
  const parking = useSelectedParking(detail?.id)
  const place = placeById(detail?.id, result)
  const entry = result?.entries.find((e) => e.id === detail?.id)
  if (!detail || !place || !entry || !result) return null
  const number = result.entries.findIndex((e) => e.id === entry.id) + 1
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
            {parking ? '주차장 변경' : '주변 주차장'}
          </PrimaryButton>
          <SecondaryButton disabled={currentTripSaved} onClick={saveCurrentTrip}>
            <Icon name="bookmark" />
            {currentTripSaved ? '저장됨' : '저장'}
          </SecondaryButton>
        </div>
        <section className="sn-section" aria-labelledby="sn-d-now">
          <h3 id="sn-d-now">현재 상황</h3>
          <dl className="sn-facts sn-current-facts">
            <div>
              <dt>
                <Icon name="car" />
                자동차 이동
              </dt>
              <dd>{entry.eta === null ? '확인 불가' : `약 ${entry.eta}분`}</dd>
              <small>목적지까지 · 예시 경로 · 도보 제외</small>
            </div>
            <div>
              <dt>
                <Icon name="walk" />
                주차 후 도보
              </dt>
              <dd>{parking ? `약 ${parking.minutes}분` : '선택 필요'}</dd>
              <small>
                {parking
                  ? `${parking.lot.name} · 직선거리 기반 추정`
                  : '주변 주차장에서 선택해 주세요'}
              </small>
            </div>
            <div>
              <dt>
                <Icon name="people" />
                혼잡도
              </dt>
              <dd>정보 없음</dd>
              <small>연결된 관측 정보 없음</small>
            </div>
          </dl>
          <p className="sn-current-note">
            주차장 외부 이용 가능 여부와 빈자리는 확인되지 않았어요.
          </p>
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
            <dd>
              {place.parkingRadius === null
                ? '조회 반경 미확인'
                : `직선 반경 ${place.parkingRadius === 1000 ? '1km' : `${place.parkingRadius}m`}`}
            </dd>
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
    recommendMore,
    retryRoute,
    retrySearch,
    submitRecommendation,
    updateDraft,
  } = useDemo()
  const retryWait = useSecondsRemaining(ui.apiFailure?.retryAt)
  useSecondsRemaining(Date.parse(result?.api?.result.context_expires_at || ''))
  const blocked = ui.busy || !!ui.apiFailure?.canResend || retryWait > 0
  if (!active.onboardingComplete) {
    const draft = active.onboardingDraft || active.conditions
    const invalid = validateRecommendation(draft)
    return (
      <>
        <PanelHeader title="AI 추천" subtitle="출발지와 하고 싶은 일을 알려주세요." />
        <div className="sn-scroll sn-form">
          <RecommendationFeedback />
          {ui.busy && (
            <div className="sn-banner is-busy" role="status">
              <ResponsePending>{ui.progress?.detail || '추천을 찾는 중이에요…'}</ResponsePending>
            </div>
          )}
          {ui.notice && !ui.apiFailure && <p role="status">{ui.notice.text}</p>}
          <ConditionsForm
            initial={draft}
            mode="onboarding"
            onSubmit={(c) => void submitRecommendation(c, true)}
            onChange={updateDraft}
          />
        </div>
        <footer className="sn-panel-foot">
          <PrimaryButton type="submit" form="onboarding-form" disabled={!!invalid || blocked}>
            {ui.busy ? '찾는 중…' : '이 조건으로 찾아보기'}
          </PrimaryButton>
        </footer>
      </>
    )
  }
  if (
    ui.detail &&
    result &&
    ui.detail.resultId === result.id &&
    result.entries.some((entry) => entry.id === ui.detail!.id)
  )
    return result.api && active.api ? (
      <ApiPlaceDetail
        key={`${active.trip}:${active.api.version}:${result.id}:${ui.detail.id}`}
        result={result}
        placeId={ui.detail.id}
        go={go}
      />
    ) : (
      <PlaceDetailView go={go} />
    )
  const stale = result && active.retainedResult?.id === result.id && !ui.busy
  const entries = (result?.entries || []).filter((entry) => {
    const place = placeById(entry.id, result)
    return !!place
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
        <RecommendationFeedback />
        {ui.notice && !ui.apiFailure && (
          <div
            className={ui.notice.type === 'info' ? 'sn-banner' : 'sn-state is-error'}
            role="status"
          >
            {!active.api && (
              <ErrorState
                title={ui.notice.type === 'info' ? '안내' : '추천을 불러오지 못했어요'}
                onRetry={active.api ? undefined : () => void retrySearch()}
              >
                {ui.notice.text}
                {stale && ' 아래 목록은 이전에 찾은 결과예요.'}
              </ErrorState>
            )}
            {active.api && <p>{ui.notice.text}</p>}
          </div>
        )}
        {active.general?.id === result?.id && result && (
          <div className="sn-banner" role="status">
            <p>이동시간을 확인하지 못한 일반 후보예요. 추천 순위와 성공 기록에 포함하지 않아요.</p>
            {active.api &&
              !conditionsEqual(displayConditions(active.api.conditions), result.conditions) && (
                <p>현재 조건이 후보 조회 당시와 달라요. 새 조건으로 추천받아 주세요.</p>
              )}
            <SecondaryButton
              disabled={
                blocked ||
                (!!result.api &&
                  (resultContextStatus(result) !== 'available' ||
                    !conditionsEqual(displayConditions(active.api!.conditions), result.conditions)))
              }
              onClick={() => void retryRoute()}
            >
              같은 후보 이동시간 재확인
            </SecondaryButton>
          </div>
        )}
        {result && (
          <>
            <ResultContextNotice result={result} />
            <p className="sn-note">
              {active.general?.id === result.id ? '후보 조회' : '추천 당시 조회'}:{' '}
              {dateLabel(result.time)}
            </p>
          </>
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
            <ResponsePending>{ui.progress?.detail || '추천을 찾는 중이에요…'}</ResponsePending>
          </div>
        )}
        {result?.entries.length ? (
          <>
            {entries.length ? (
              <ol className="sn-list">
                {entries.map((entry) => (
                  <PlaceCard
                    key={entry.id}
                    index={result.entries.indexOf(entry)}
                    entry={entry}
                    place={placeById(entry.id, result)!}
                    selected={active.selected === entry.id}
                    go={go}
                  />
                ))}
              </ol>
            ) : (
              <EmptyState title="표시할 추천 장소가 없어요">
                다른 장소를 추천받아 보세요.
              </EmptyState>
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
          disabled={blocked}
          onClick={() => void recommendMore()}
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
