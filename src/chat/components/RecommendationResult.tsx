import { useState } from 'react'
import Icon from '../../components/common/Icon'
import { EmptyState, StatusBadge } from '../../components/common/ui'
import type {
  ContextCard,
  PlaceReference,
  PublishedRecommendation,
  RunSnapshot,
  ViewedContext,
} from '../api/types'
import { conditionLine, kilometers, parkingText, routeText } from '../model/labels'
import { cardRef } from '../model/turns'
import { useChatController, useChatState } from '../state/useChat'
import { prefill, showOnMap, directionsTo } from './actions'
import { saveRecommendation, useSavedRecommendations } from '../state/recommendations'
import { useMapRecommendation } from '../../hooks/useRoute'
import { openPlaceDetails } from '../state/placeDetails'

type Follow = { label: string; text: string }
const CARD_FOLLOWS: Follow[] = [
  { label: '주차 묻기', text: '이 장소 주변 주차 알려줘' },
  { label: '추천 이유', text: '이 장소는 왜 추천했어?' },
  { label: '이동시간', text: '여기까지 차로 얼마나 걸려?' },
]
const SEARCH_FOLLOWS: Follow[] = [
  { label: '주차 묻기', text: '이 장소 주변 주차 알려줘' },
  { label: '장소 정보', text: '이 장소 정보 알려줘' },
]

function FollowUps({
  follows,
  target,
  disabled,
}: {
  follows: Follow[]
  target: { context: ViewedContext; label: string }
  disabled: boolean
}) {
  const controller = useChatController()
  return (
    <div className="sn-chat-follow" role="group" aria-label={`${target.label} 후속 질문`}>
      {follows.map((follow) => (
        <button
          key={follow.label}
          type="button"
          disabled={disabled}
          onClick={() => {
            prefill(controller, follow.text, target)
            window.location.hash = '/chat'
          }}
        >
          {follow.label}
        </button>
      ))}
    </div>
  )
}

function Card({
  card,
  resultId,
  ordinal,
  regional,
  readOnly,
  onShowMap,
}: {
  card: ContextCard
  resultId: string
  ordinal: number
  regional: boolean
  readOnly: boolean
  onShowMap?: () => void
}) {
  const state = useChatState()
  const selected = useMapRecommendation()
  const place = card.place.value
  const ref = cardRef(state.refs, resultId, card.rank)
  const name = place?.name ?? '이름을 확인하지 못한 장소'
  const reason = card.reason.text.includes('확인된 지역 경계 안에서') ? null : card.reason.text
  const target = {
    // Keep the exact result: a past card's "2번" must not become the latest result's "2번".
    context: ref ? { result_id: resultId, place_ref: ref.ref_id } : { result_id: resultId },
    label: `${ordinal}회차 추천 · ${card.rank ?? '-'}번 ${name}`,
  }
  const expired = state.boot !== 'ready'
  const openMap = () => {
    if (!place) return
    showOnMap(
      place.coordinates.latitude,
      place.coordinates.longitude,
      onShowMap,
      {
        id: place.place_id,
        name,
        rank: card.rank,
        lat: place.coordinates.latitude,
        lng: place.coordinates.longitude,
        onOpenDetail: () => openPlaceDetails(card, resultId),
      },
      resultId,
    )
  }
  return (
    <li className={`sn-chat-card${selected?.id === place?.place_id ? ' is-selected' : ''}`}>
      <div className="sn-chat-card-head">
        <span
          className="sn-rank"
          aria-label={regional ? `표시 순서 ${card.rank}` : `${card.rank}위`}
        >
          {card.rank ?? '·'}
        </span>
        <strong>{name}</strong>
      </div>
      {place ? (
        <p className="sn-chat-meta">
          {[place.category_name?.split(' > ').at(-1), place.road_address || place.address]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : (
        <p className="sn-chat-meta">장소 정보를 확인하지 못했어요</p>
      )}
      {reason && !regional && <p className="sn-chat-reason">{reason}</p>}
      <ul className="sn-chat-facts">
        {(!regional ||
          card.route.status === 'available' ||
          card.route.reason_code !== 'ORIGIN_NOT_SET') && (
          <li>
            <Icon name="car" />
            <span>{routeText(card.route)}</span>
          </li>
        )}
        <li>
          <Icon name="parking" />
          <span>{parkingText(card.parking)}</span>
        </li>
      </ul>
      {(card.reason.evidence.length > 0 || (regional && reason)) && (
        <details className="sn-chat-explanation">
          <summary>선정 정보</summary>
          {regional && reason && <p className="sn-chat-reason">{reason}</p>}
          {card.reason.evidence.length > 0 && (
            <ul className="sn-chat-evidence" aria-label="추천 근거">
              {card.reason.evidence.map((evidence, i) => (
                <li key={i}>{evidence.text}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      <div className="sn-chat-card-actions">
        {place && (
          <button
            type="button"
            className="sn-chat-action"
            onClick={() => openPlaceDetails(card, resultId)}
          >
            상세 보기
          </button>
        )}
        {place && (
          <button type="button" className="sn-chat-action" onClick={openMap}>
            <Icon name="map" />
            <span>지도에서 보기</span>
          </button>
        )}
        {place && (
          <button type="button" className="sn-chat-action" onClick={() => directionsTo(place)}>
            <Icon name="map" />
            여기로 길찾기
          </button>
        )}
      </div>
      {!readOnly && (
        <details className="sn-chat-explanation">
          <summary>이 장소에 질문하기</summary>
          <FollowUps follows={CARD_FOLLOWS} target={target} disabled={expired} />
        </details>
      )}
    </li>
  )
}

const OUTCOME_EMPTY: Record<string, [string, string]> = {
  no_candidates: ['확인한 범위에 맞는 후보가 없어요', '조건이나 지역을 바꿔 다시 물어보세요.'],
  insufficient_evidence: [
    '자료가 부족해 후보를 확인하지 못했어요',
    '결과가 없는 것과는 달라요. 잠시 뒤 다시 시도할 수 있어요.',
  ],
  error: ['새 추천 조회에 실패했어요', '반영된 조건은 그대로 유지돼요.'],
}

export function PreparedOutcome({ snapshot }: { snapshot: RunSnapshot | null | undefined }) {
  const outcome = snapshot?.finalization.prepared.outcome
  const empty = outcome && OUTCOME_EMPTY[outcome]
  return empty ? <EmptyState title={empty[0]}>{empty[1]}</EmptyState> : null
}

export function RecommendationResult({
  recommendation,
  ordinal,
  onShowMap,
  readOnly = false,
}: {
  recommendation: PublishedRecommendation
  ordinal: number
  onShowMap?: () => void
  readOnly?: boolean
}) {
  const saved = useSavedRecommendations()
  const [saveError, setSaveError] = useState(false)
  const isSaved = saved.some((item) => item.recommendation.result_id === recommendation.result_id)
  const regional = recommendation.selection_mode === 'regional'
  const conditions = conditionLine(recommendation.effective_conditions)
  return (
    <section className="sn-chat-result" aria-label={`${ordinal}회차 추천`}>
      <header>
        <strong>
          {ordinal}회차 추천
          {recommendation.search_area && ` · ${recommendation.search_area.label}`}
        </strong>
        {recommendation.scope === 'request_only' && (
          <StatusBadge tone="info">이번 추천에만 적용</StatusBadge>
        )}
        <button
          type="button"
          className="sn-chat-save"
          disabled={isSaved}
          onClick={() => setSaveError(!saveRecommendation(recommendation, ordinal))}
        >
          <Icon name="bookmark" />
          {isSaved ? '저장됨' : '추천 묶음 저장'}
        </button>
      </header>
      {saveError && (
        <p role="alert">저장하지 못했어요. 브라우저 저장 공간을 확인하고 다시 눌러 주세요.</p>
      )}
      {conditions && <p className="sn-chat-sub">추천 당시 조건 · {conditions}</p>}
      {regional && (
        <p className="sn-chat-sub">지역·업종 기준 후보예요. 번호는 순위가 아닌 표시 순서예요.</p>
      )}
      <ol className="sn-chat-cards">
        {recommendation.cards.map((card, i) => (
          <Card
            key={card.place.value?.place_id ?? i}
            card={card}
            resultId={recommendation.result_id}
            ordinal={ordinal}
            regional={regional}
            readOnly={readOnly}
            onShowMap={onShowMap}
          />
        ))}
      </ol>
    </section>
  )
}

export function SearchPlaces({
  places,
  hasMore,
  onShowMap,
}: {
  places: PlaceReference[]
  hasMore: boolean
  onShowMap?: () => void
}) {
  const state = useChatState()
  return (
    <section className="sn-chat-result" aria-label="검색 결과">
      <header>
        <strong>검색 결과 {places.length}곳</strong>
      </header>
      <ol className="sn-chat-cards">
        {places.map((ref) => (
          <li key={ref.ref_id} className="sn-chat-card">
            <div className="sn-chat-card-head">
              <span className="sn-rank">{ref.position}</span>
              <strong>{ref.place.name}</strong>
            </div>
            <p className="sn-chat-meta">
              {[
                ref.place.category_name,
                ref.place.road_address || ref.place.address,
                ref.place.distance_meters !== null ? kilometers(ref.place.distance_meters) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="sn-chat-card-actions">
              <button
                type="button"
                className="sn-chat-action"
                onClick={() =>
                  showOnMap(
                    ref.place.coordinates.latitude,
                    ref.place.coordinates.longitude,
                    onShowMap,
                    {
                      id: ref.place.place_id,
                      name: ref.place.name,
                      rank: ref.position,
                      lat: ref.place.coordinates.latitude,
                      lng: ref.place.coordinates.longitude,
                    },
                  )
                }
              >
                <Icon name="map" />
                <span>지도에서 보기</span>
              </button>
              <FollowUps
                follows={SEARCH_FOLLOWS}
                target={{
                  context: { collection_id: ref.collection_id, place_ref: ref.ref_id },
                  label: `검색 결과 · ${ref.position}번 ${ref.place.name}`,
                }}
                disabled={state.boot !== 'ready'}
              />
            </div>
          </li>
        ))}
      </ol>
      {hasMore && <p className="sn-chat-sub">결과가 더 있어요. 지역이나 이름을 좁혀 물어보세요.</p>}
    </section>
  )
}
