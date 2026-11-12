// Trip and condition helpers shared by the API and mock flows.
import { DEPARTURES } from './departures'
const clone = (value) => structuredClone(value)
const PURPOSES = ['카페', '식사', '산책', '전시']
const EMPTY_CONDITIONS = {
  departure: null,
  purposes: [],
  keyword: null,
  group: null,
  ages: [],
  headcount: null,
  maxMinutes: null,
}
function newTripId() {
  return crypto.randomUUID()
}
function newState() {
  const now = new Date().toISOString()
  return {
    schema: 1,
    trip: newTripId(),
    title: '',
    createdAt: now,
    updatedAt: now,
    conditionVersion: 0,
    conditions: clone(EMPTY_CONDITIONS),
    onboardingComplete: false,
    onboardingDraft: clone(EMPTY_CONDITIONS),
    groups: [],
    seen: [],
    excluded: [],
    general: null,
    chat: [],
    pendingChat: null,
    current: null,
    selected: null,
    view: 'list',
    sequence: 0,
    retainedResult: null,
    workspaceView: null,
  }
}
function validSavedTrip(saved) {
  return (
    saved?.schema === 1 &&
    Array.isArray(saved.groups) &&
    saved.conditions &&
    Array.isArray(saved.seen) &&
    Array.isArray(saved.excluded) &&
    Array.isArray(saved.chat)
  )
}
function normalizeTrip(saved) {
  const base = newState(),
    conditions = { ...clone(EMPTY_CONDITIONS), ...saved.conditions }
  const complete = saved.onboardingComplete !== false && !validateConditions(conditions)
  const draft =
    saved.onboardingDraft ||
    saved.workspaceView?.homeDraft ||
    (saved.pendingChat ? patchConditions(conditions, saved.pendingChat.patch) : conditions)
  return {
    ...base,
    ...saved,
    conditions,
    onboardingComplete: complete,
    onboardingDraft: { ...clone(EMPTY_CONDITIONS), ...clone(draft) },
    createdAt:
      saved.createdAt ||
      (typeof saved.trip === 'number' ? new Date(saved.trip).toISOString() : saved.chat[0]?.time) ||
      base.createdAt,
    updatedAt: saved.updatedAt || saved.chat.at(-1)?.time || base.updatedAt,
  }
}

function dateLabel(t) {
  return t
    ? new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul',
      }).format(new Date(t))
    : '확인 불가'
}
const minuteFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
  useGrouping: false,
})
function conditionText(c) {
  return [
    c.departure || '출발지 미정',
    c.purposes.length ? c.purposes.join(' 또는 ') : '목적 미정',
    c.maxMinutes === null
      ? '이동시간 제한 없음'
      : `차로 ${minuteFormatter.format(c.maxMinutes)}분 이내`,
    c.purposeKeywords
      ? Object.entries(c.purposeKeywords)
          .filter(([, value]) => value)
          .map(
            ([key, value]) =>
              `${{ cafe: '카페', food: '식사', walk: '산책', exhibition: '전시' }[key]} “${value}”`,
          )
          .join(' · ')
      : c.keyword
        ? `키워드 “${c.keyword}”`
        : null,
    c.group,
    c.headcount ? `${c.headcount}명` : null,
    c.ages.length ? c.ages.join('·') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
function patchConditions(base, patch) {
  const next = clone(base)
  for (const k of Object.keys(EMPTY_CONDITIONS))
    if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = clone(patch[k])
  return next
}
function validateConditions(c) {
  const verifiedOrigin =
    c.origin?.supported &&
    c.origin.label === c.departure &&
    Number.isFinite(c.origin.coordinates?.latitude) &&
    Number.isFinite(c.origin.coordinates?.longitude)
  if (!verifiedOrigin && !DEPARTURES[c.departure])
    return '출발지를 선택해 주세요. 서울·인천·경기의 예시 출발지를 지원해요.'
  if (!Array.isArray(c.purposes) || !c.purposes.length)
    return '카페·식사·산책·전시 중 목적을 선택해 주세요.'
  if (c.purposes.some((p) => !PURPOSES.includes(p)))
    return '카페·식사·산책·전시 중 목적을 선택해 주세요.'
  if (c.purposes.length > 2)
    return '목적은 최대 2개까지 선택해 주세요. 두 목적은 코스가 아닌 대안이에요.'
  if (c.headcount !== null && (!Number.isInteger(c.headcount) || c.headcount < 1))
    return '인원은 1 이상의 정확한 정수로 입력해 주세요.'
  if (
    c.maxMinutes !== null &&
    (verifiedOrigin
      ? !Number.isFinite(c.maxMinutes) || c.maxMinutes <= 0
      : !Number.isInteger(c.maxMinutes) || c.maxMinutes < 1)
  )
    return '최대 운전 시간은 1분 이상의 정수로 입력하거나 비워 주세요.'
  return ''
}
function conditionsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
function conditionChanges(a, b) {
  const labels = {
    departure: '출발지',
    purposes: '목적',
    keyword: '키워드',
    group: '동행',
    ages: '연령대',
    headcount: '인원',
    maxMinutes: '최대 운전 시간',
  }
  const fmt = (k, v) =>
    v === null || v === '' || (Array.isArray(v) && !v.length)
      ? k === 'maxMinutes'
        ? '제한 없음'
        : '선택 안 함'
      : Array.isArray(v)
        ? v.join(' 또는 ')
        : k === 'maxMinutes'
          ? `${minuteFormatter.format(v)}분`
          : `${v}${k === 'headcount' ? '명' : ''}`
  return Object.keys(labels)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${labels[k]}: ${fmt(k, a[k])} → ${fmt(k, b[k])}`)
}
// Results carry their own place snapshots (API responses); there is no local catalog.
function placeById(id, result) {
  return result?.entries.find((entry) => entry.id === id)?.place
}
export {
  PURPOSES,
  EMPTY_CONDITIONS,
  newState,
  normalizeTrip,
  validSavedTrip,
  dateLabel,
  conditionText,
  patchConditions,
  validateConditions,
  conditionsEqual,
  conditionChanges,
  placeById,
}
