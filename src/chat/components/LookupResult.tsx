import type { ReactNode } from 'react'
import Icon from '../../components/common/Icon'
import { showLookupOnMap, directionsTo } from './actions'
import type { PlaceReference } from '../api/types'
import { EmptyState, StatusBadge } from '../../components/common/ui'
import type { Information } from '../../api/contracts'
import type {
  ComparisonResult,
  LookupResult as Lookup,
  ParkingSummary,
  ReadItem,
  RouteValue,
} from '../api/types'
import {
  clock,
  conditionLine,
  kilometers,
  minutes,
  parkingText,
  reasonText,
  routeText,
} from '../model/labels'
import { placeName } from '../model/turns'
import { useChatState } from '../state/useChat'
import { SearchPlaces } from './RecommendationResult'

const TOPICS: Record<ReadItem['topic'], string> = {
  place_info: '장소 정보',
  driving: '자동차 이동',
  parking: '주변 주차장',
  recommendation_reason: '추천 이유',
  traffic: '도착지 주변 도로',
}

const record = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)
const safeUrl = (value: unknown) => {
  const url = text(value)
  return url && /^https:\/\//.test(url) ? url : null
}

function ItemBody({ item, onShowMap }: { item: ReadItem; onShowMap?: () => void }) {
  if (item.status === 'empty') return <p>확인한 범위에 결과가 없어요.</p>
  if (item.status === 'unavailable') return <p>{reasonText(item.reason_code)}</p>
  if (item.status === 'error')
    return <p>조회하지 못했어요 · {reasonText(item.reason_code, '잠시 뒤 다시 시도해 주세요')}</p>
  const data = record(item.data)
  const source = item.sources[0]
  switch (item.topic) {
    case 'driving': {
      const route = data.route as Information<RouteValue> | undefined
      const origin = text(data.origin_label)
      return (
        <p>
          {origin && `${origin}에서 `}
          {route ? routeText(route) : '이동시간을 확인하지 못했어요'}
          {source?.checked_at && <small> · 조회 {clock(source.checked_at)}</small>}
        </p>
      )
    }
    case 'parking': {
      const parking = item.data as ParkingSummary
      return (
        <>
          <p>{parkingText(parking)}</p>
          {parking?.items?.length > 0 && (
            <ul className="sn-chat-sublist">
              {parking.items.slice(0, 3).map((lot) => (
                <li key={lot.parking_id}>
                  <span>
                    <strong>{lot.name}</strong>
                    <small>직선거리 {kilometers(lot.distance_meters)}</small>
                  </span>
                  <button
                    type="button"
                    className="sn-chat-map-link"
                    aria-label={`${lot.name} 지도에서 보기`}
                    onClick={() =>
                      showLookupOnMap(
                        {
                          id: lot.parking_id,
                          name: lot.name,
                          lat: lot.coordinates.latitude,
                          lng: lot.coordinates.longitude,
                          kind: 'parking',
                        },
                        onShowMap,
                      )
                    }
                  >
                    <Icon name="map" />
                    지도
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )
    }
    case 'traffic': {
      const radius = typeof data.radius_meters === 'number' ? data.radius_meters : 100
      const observed = clock(source?.collected_at)
      return (
        <>
          <p>
            반경 {radius}m 도로 {text(data.grade) ?? '확인 불가'}
          </p>
          <small>
            전체 주행 경로의 정체가 아니에요 ·{' '}
            {observed ? `관측 ${observed}` : '관측 시각 정보 없음'}
          </small>
        </>
      )
    }
    case 'recommendation_reason': {
      const reason = record(data.reason)
      const at = clock(text(data.recommended_at))
      const conditions = conditionLine(data.conditions as never)
      return (
        <>
          <p>{text(reason.text) ?? '기록된 추천 이유가 없어요.'}</p>
          <small>
            {at ? `추천 당시 ${at}` : '추천 당시 기록'}
            {conditions && ` · 당시 조건: ${conditions}`}
          </small>
        </>
      )
    }
    default: {
      const url = safeUrl(data.provider_url)
      const rows = [
        ['업종', text(data.category_name)?.split(' > ').at(-1)],
        ['주소', text(data.road_address) ?? text(data.address)],
        ['전화', text(data.phone)],
      ].filter(([, value]) => value)
      return (
        <>
          {rows.length ? (
            <dl className="sn-chat-place-facts">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>등록된 정보가 없어요.</p>
          )}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              장소 페이지 열기
            </a>
          )}
        </>
      )
    }
  }
}

const STATUS_TONE: Record<ReadItem['status'], ['good' | 'neutral' | 'warn' | 'bad', string]> = {
  ok: ['good', '확인'],
  empty: ['neutral', '결과 없음'],
  unavailable: ['warn', '자료 없음'],
  error: ['bad', '조회 실패'],
}

function PlaceActions({
  place,
  onShowMap,
}: {
  place: PlaceReference['place']
  onShowMap?: () => void
}) {
  return (
    <div className="sn-chat-card-actions">
      <button
        type="button"
        className="sn-chat-action"
        onClick={() =>
          showLookupOnMap(
            {
              id: place.place_id,
              name: place.name,
              lat: place.coordinates.latitude,
              lng: place.coordinates.longitude,
              kind: 'place',
            },
            onShowMap,
          )
        }
      >
        <Icon name="map" />
        지도에서 보기
      </button>
      <button type="button" className="sn-chat-action" onClick={() => directionsTo(place)}>
        <Icon name="car" />
        여기로 길찾기
      </button>
    </div>
  )
}

export function LookupResult({ lookup, onShowMap }: { lookup: Lookup; onShowMap?: () => void }) {
  const { refs } = useChatState()
  const groups = new Map<string, ReadItem[]>()
  for (const item of lookup.items)
    groups.set(item.place_ref, [...(groups.get(item.place_ref) ?? []), item])
  const names = new Map(lookup.places.map((ref) => [ref.ref_id, ref.place.name]))
  const blocks: ReactNode[] = []
  groups.forEach((items, ref) => {
    const target = refs[ref] ?? lookup.places.find((place) => place.ref_id === ref)
    blocks.push(
      <section
        key={ref}
        className="sn-chat-lookup"
        aria-label={names.get(ref) ?? placeName(refs, ref) ?? '대상 장소'}
      >
        <strong>{names.get(ref) ?? placeName(refs, ref) ?? '대상 장소'}</strong>
        <dl>
          {items.map((item, i) => (
            <div key={`${item.topic}:${i}`}>
              <dt>
                {TOPICS[item.topic] ?? '정보'}{' '}
                {item.status !== 'ok' && (
                  <StatusBadge tone={STATUS_TONE[item.status][0]}>
                    {STATUS_TONE[item.status][1]}
                  </StatusBadge>
                )}
              </dt>
              <dd>
                <ItemBody item={item} onShowMap={onShowMap} />
              </dd>
            </div>
          ))}
        </dl>
        {target && items.some((item) => item.topic === 'place_info') && (
          <PlaceActions place={target.place} onShowMap={onShowMap} />
        )}
      </section>,
    )
  })
  return (
    <>
      {blocks}
      {lookup.places.length > 0 && (
        <SearchPlaces places={lookup.places} hasMore={lookup.has_more} onShowMap={onShowMap} />
      )}
      {!lookup.items.length && !lookup.places.length && (
        <EmptyState
          title={
            lookup.outcome === 'empty'
              ? '확인한 범위에서 결과가 없어요'
              : lookup.outcome === 'error'
                ? '조회하지 못했어요'
                : '확인할 자료가 없어요'
          }
        >
          {lookup.outcome === 'empty' ? null : reasonText(lookup.reason_code, '')}
        </EmptyState>
      )}
    </>
  )
}

/** Follows the server's comparison exactly; an incomplete comparison never shows a winner. */
export function ComparisonView({ comparison }: { comparison: ComparisonResult }) {
  const { refs } = useChatState()
  const complete = comparison.outcome === 'complete'
  const tie = complete && comparison.best_refs.length > 1
  const metric = comparison.metric === 'duration_seconds' ? '이동시간' : '거리'
  return (
    <section className="sn-chat-compare" aria-label={`${metric} 비교`}>
      <strong>
        {comparison.origin_label} 출발 · {metric} 비교
      </strong>
      <dl>
        {Object.entries(comparison.values).map(([ref, value]) => (
          <div key={ref}>
            <dt>{placeName(refs, ref) ?? '대상 장소'}</dt>
            <dd>
              {value === null
                ? '자료 없음'
                : comparison.unit === 'seconds'
                  ? `약 ${minutes(value)}`
                  : kilometers(value)}
              {complete && comparison.best_refs.includes(ref) && (
                <StatusBadge tone="good">
                  {tie
                    ? '동률'
                    : comparison.metric === 'duration_seconds'
                      ? '가장 빠름'
                      : '가장 가까움'}
                </StatusBadge>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {!complete && (
        <p className="sn-chat-sub">
          일부 자료가 없어 우열을 정하지 않았어요. 확인된 값만 보여드려요.
        </p>
      )}
    </section>
  )
}
