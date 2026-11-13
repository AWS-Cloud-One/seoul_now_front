import ApiPlaceDetail from '../place/ApiPlaceDetail'
import ResultContextNotice from '../common/ResultContextNotice'
import { resultContextStatus, displayConditions } from '../../state/apiState'
import { conditionsEqual } from '../../lib/domain.js'
import { useSelectedParking } from '../../hooks/useSelectedParking'
import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { DEPARTURES } from '../../lib/departures'
import { PanelTabs } from '../common/PanelTabs'
import { fitMap, focusMap } from '../../hooks/useRoute'
import { useAppState } from '../../state/useAppState'
import type { Entry, Place } from '../../types/trip'
import ConditionsForm from './ConditionsForm'
import RecommendationFeedback from './RecommendationFeedback'
import ResponsePending from '../common/ResponsePending'
import { validateRecommendation } from '../../lib/recommendationConditions'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'
import Icon from '../common/Icon'
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '../common/ui'
import type { Route } from '../../hooks/useRoute'
import { useOrigin } from '../../state/origin'

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
  const { selectPlace, openDetail, patchUI, ui, result } = useAppState()
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

export default function RecommendPanel({ go }: { go: (route: Route) => void }) {
  const {
    active,
    result,
    ui,
    newTrip,
    openEdit,
    recommendMore,
    retryRoute,
    submitRecommendation,
    updateDraft,
  } = useAppState()
  const origin = useOrigin()
  const retryWait = useSecondsRemaining(ui.apiFailure?.retryAt)
  useSecondsRemaining(Date.parse(result?.api?.result.context_expires_at || ''))
  const blocked = ui.busy || !!ui.apiFailure?.canResend || retryWait > 0
  if (!active.onboardingComplete) {
    const draft = active.onboardingDraft || active.conditions
    const invalid = validateRecommendation(
      origin.status === 'ready' && origin.location
        ? { ...draft, origin: origin.location, departure: origin.location.label }
        : { ...draft, origin: null },
    )
    return (
      <>
        <PanelTabs route="recommend" go={go} recommendLabel="조건으로 찾기" />
        <PanelHeader
          title="AI 추천"
          subtitle="조건을 고르거나 AI 대화 탭에서 하고 싶은 일을 말해 주세요."
        />
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
    return (
      <ApiPlaceDetail
        key={`${active.trip}:${active.api?.version ?? 0}:${result.id}:${ui.detail.id}`}
        result={result}
        placeId={ui.detail.id}
        go={go}
      />
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
              <ErrorState title={ui.notice.type === 'info' ? '안내' : '추천을 불러오지 못했어요'}>
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
