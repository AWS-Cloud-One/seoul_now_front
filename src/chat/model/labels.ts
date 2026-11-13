import type { Tone } from '../../components/common/ui'
import type {
  ChatResponse,
  ConditionField,
  Conditions,
  ParkingSummary,
  ResponseStatus,
  RetryTask,
  RouteValue,
  StageErrorCode,
} from '../api/types'
import type { Information } from '../../api/contracts'

/** Server stages → user words. Unknown stages are just "처리 중"; no invented percentages. */
const STAGES: Record<string, string> = {
  accepted: '접수됨 · 순서를 기다리는 중',
  interpreting: '요청을 해석하는 중',
  applying_action: '선택을 처리하는 중',
  searching_origin: '출발지를 확인하는 중',
  searching: '장소를 검색하는 중',
  recommending: '후보를 확인하는 중',
  saving: '반영 여부를 확인하는 중',
  looking_up: '정보를 조회하는 중',
  finished: '처리를 마쳤어요',
}
export const stageLabel = (stage: string | null | undefined) =>
  (stage && STAGES[stage]) || '처리 중'

export const STATUS_BADGE: Record<ResponseStatus, [string, Tone] | null> = {
  succeeded: null,
  partial: ['일부 완료', 'warn'],
  failed: ['실패', 'bad'],
  cancelled: ['중단됨', 'neutral'],
  interrupted: ['처리 중단', 'warn'],
  reconciling: ['반영 여부 확인 중', 'warn'],
  waiting_input: ['답변 필요', 'info'],
}

/** Kept apart on purpose: "unsupported", "provider down" and "could not interpret" differ. */
const ERROR_TITLES: Record<StageErrorCode, string> = {
  INTERPRETATION_FAILED: '요청을 해석하지 못했어요',
  VALIDATION_FAILED: '요청 내용을 확인하지 못했어요',
  INTERNAL_ERROR: '처리 중 오류가 났어요',
  RECOMMENDATION_FAILED: '추천 조회에 실패했어요',
  COMMIT_FAILED: '변경을 반영하지 못했어요',
  COMMIT_UNCERTAIN: '반영 여부를 확인하고 있어요',
  CONFLICT: '다른 변경과 겹쳐 반영하지 않았어요',
  CANCELLED: '요청을 중단했어요',
  INTERRUPTED: '처리가 중간에 멈췄어요',
  DEADLINE_EXCEEDED: '처리 시간이 초과됐어요',
  UNSUPPORTED: '지원하지 않는 요청이에요',
}

export function responseTitle(response: ChatResponse): [string, Tone] | null {
  if (response.kind === 'unsupported') return [ERROR_TITLES.UNSUPPORTED, 'neutral']
  if (response.error?.code === 'CANCELLED') return [ERROR_TITLES.CANCELLED, 'neutral']
  if (response.kind === 'failure' && response.error)
    return [ERROR_TITLES[response.error.code] ?? '처리하지 못했어요', 'bad']
  if (response.kind === 'decision')
    return response.evaluation?.guard === 'unknown'
      ? ['판정할 자료가 부족해 조건을 유지했어요', 'warn']
      : ['조건을 유지했어요', 'neutral']
  if (response.kind === 'unchanged') return ['변경할 내용이 없었어요', 'neutral']
  return null
}

const RETRY: Record<RetryTask, string> = {
  interpretation: '요청 다시 해석',
  action: '선택 다시 실행',
  recommendation: '추천 다시 시도',
  lookup: '조회 다시 시도',
  search: '검색 다시 시도',
}
export const retryLabel = (task: string) => RETRY[task as RetryTask] ?? '다시 시도'
export const isRetryTask = (task: string): task is RetryTask => task in RETRY

const REASONS: Record<string, string> = {
  ORIGIN_REQUIRED: '출발지가 있어야 확인할 수 있어요',
  ORIGIN_NOT_SET: '출발지 없이 찾아 이동시간은 계산하지 않았어요',
  NOT_A_RECOMMENDATION: '추천한 장소가 아니라 추천 이유가 없어요',
  EVIDENCE_NOT_RECORDED: '추천 근거가 기록되지 않았어요',
  PROVIDER_TIMEOUT: '제공처 응답이 늦어 확인하지 못했어요',
  DATA_UNAVAILABLE: '제공처 자료를 받지 못했어요',
  REGION_LOOKUP_FAILED: '지역 정보를 확인하지 못했어요',
}
export const reasonText = (code: string | null | undefined, fallback = '확인할 자료가 없어요') =>
  (code && REASONS[code]) || fallback

const WARNINGS: Record<string, string> = {
  CRITERIA_UNKNOWN: '필수 조건을 확인하지 못한 후보는 제외했어요.',
}
/** Only known warnings are shown; raw codes are developer data. */
export const warningTexts = (codes: string[] | undefined) =>
  [...new Set(codes ?? [])].flatMap((code) => (WARNINGS[code] ? [WARNINGS[code]] : []))

const FIELDS: Record<ConditionField, string> = {
  origin: '출발지',
  purposes: '방문 목적',
  headcount: '인원',
  max_travel_seconds: '이동시간',
}
export const fieldLabel = (field: ConditionField) => FIELDS[field] ?? field

const PURPOSES: Record<string, string> = {
  cafe: '카페',
  food: '식사',
  walk: '산책',
  exhibition: '전시',
}
const GROUPS: Record<string, string> = {
  solo: '혼자',
  date: '데이트',
  friends: '친구',
  family: '가족',
  other: '기타 동행',
}
const AGES: Record<string, string> = {
  under_10: '10세 미만',
  teens: '10대',
  twenties: '20대',
  thirties: '30대',
  forties: '40대',
  fifties: '50대',
  sixty_plus: '60대 이상',
}

export const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))}분`
export const kilometers = (meters: number) =>
  meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`

/** Condition rows in a fixed order; empty values are omitted, not shown as "0". */
export function conditionRows(conditions: Conditions | null | undefined): [string, string][] {
  if (!conditions) return []
  const rows: [string, string][] = []
  if (conditions.origin) rows.push(['출발지', conditions.origin.label])
  if (conditions.purposes.length)
    rows.push([
      '방문 목적',
      conditions.purposes
        .map((p) => `${PURPOSES[p.purpose] ?? p.purpose}${p.keyword ? `(${p.keyword})` : ''}`)
        .join(', '),
    ])
  if (conditions.headcount) rows.push(['인원', `${conditions.headcount}명`])
  if (conditions.max_travel_seconds)
    rows.push(['이동시간', `${minutes(conditions.max_travel_seconds)} 이내`])
  if (conditions.group_type) rows.push(['동행', GROUPS[conditions.group_type] ?? '동행'])
  if (conditions.age_groups?.length)
    rows.push(['연령대', conditions.age_groups.map((a) => AGES[a] ?? a).join(', ')])
  return rows
}
export const conditionLine = (conditions: Conditions | null | undefined) =>
  conditionRows(conditions)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ')

/** Route facts never fall back to 0: an unknown route says why it is unknown. */
export function routeText(route: Information<RouteValue>) {
  if (route.status === 'available' && route.value)
    return `자동차 약 ${minutes(route.value.duration_seconds)} · ${kilometers(route.value.distance_meters)}`
  return reasonText(route.reason_code, '이동시간을 확인하지 못했어요')
}

/** Registered parking list (no live availability); keep "0곳" and "no data" apart. */
export function parkingText(parking: ParkingSummary | null | undefined) {
  if (!parking) return '주차 정보를 확인하지 못했어요'
  const radius = parking.search_radius_meters
    ? `반경 ${kilometers(parking.search_radius_meters)}`
    : null
  if (parking.status === 'available' && parking.total_count)
    return [
      `등록 주차장 ${parking.total_count}곳`,
      parking.nearest_distance_meters !== null
        ? `가장 가까운 곳 ${kilometers(parking.nearest_distance_meters)}`
        : null,
      radius && `${radius} 기준`,
    ]
      .filter(Boolean)
      .join(' · ')
  if (parking.total_count === 0)
    return `${radius ? `${radius} 안에` : '확인한 범위에'} 등록 주차장이 없어요`
  return reasonText(parking.reason_code, '주차 정보를 확인하지 못했어요')
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dateTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dayKey = (date: Date) => date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
export function clock(iso: string | null | undefined, now = new Date()) {
  const date = new Date(iso || '')
  if (Number.isNaN(date.getTime())) return null
  return dayKey(date) === dayKey(now) ? timeFormat.format(date) : dateTimeFormat.format(date)
}
