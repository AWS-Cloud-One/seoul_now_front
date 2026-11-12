import type { ApiConditions, ContextResult, ConversationData, ServerTrip } from '../api/contracts'
import type { ApiResponse } from '../api/client'
import type { PreparedRequest } from '../api/requestManager'
import type { Conditions, Result, Trip } from '../types/trip'

const purposeLabels = { cafe: '카페', food: '식사', walk: '산책', exhibition: '전시' } as const
const groupLabels = { solo: '혼자', date: '연인', friends: '친구', family: '가족', other: '기타' }
const ageLabels = {
  under_10: '10세 미만',
  teens: '10대',
  twenties: '20대',
  thirties: '30대',
  forties: '40대',
  fifties: '50대',
  sixty_plus: '60대 이상',
}
export function createServerTrip(tripId: string): ServerTrip {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return {
    tripId: uuid.test(tripId) ? tripId : crypto.randomUUID(),
    version: 0,
    clarification: null,
    seenPlaceIds: [],
    conditions: {
      origin: null,
      purposes: [],
      group_type: null,
      age_groups: null,
      headcount: null,
      max_travel_seconds: null,
    },
  }
}
export function displayConditions(value: ApiConditions): Conditions {
  return {
    departure: value.origin?.label ?? null,
    origin: structuredClone(value.origin),
    purposes: value.purposes.map((item) => purposeLabels[item.purpose]),
    purposeKeywords: Object.fromEntries(value.purposes.map((item) => [item.purpose, item.keyword])),
    keyword: null,
    group: value.group_type ? groupLabels[value.group_type] : null,
    ages: (value.age_groups || []).map((age) => ageLabels[age]),
    headcount: value.headcount,
    maxMinutes: value.max_travel_seconds === null ? null : value.max_travel_seconds / 60,
  }
}
function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
export function resultSnapshot(raw: ContextResult, tripId: string, version: number): Result {
  if (
    !raw.result_id ||
    !validTime(raw.created_at) ||
    !Array.isArray(raw.cards) ||
    raw.cards.length < 1 ||
    raw.cards.length > 3 ||
    (raw.context_token !== null && typeof raw.context_token !== 'string') ||
    (raw.context_expires_at !== null && !validTime(raw.context_expires_at))
  ) {
    throw new Error('추천 결과 형식이 올바르지 않아요.')
  }
  const conditions = displayConditions(raw.conditions)
  const entries = raw.cards.map((card) => {
    const place = card.place.value
    if (
      !place?.place_id ||
      !place.name ||
      !Number.isFinite(place.coordinates.latitude) ||
      Math.abs(place.coordinates.latitude) > 90 ||
      !Number.isFinite(place.coordinates.longitude) ||
      Math.abs(place.coordinates.longitude) > 180 ||
      typeof card.reason.text !== 'string'
    ) {
      throw new Error('추천 장소 정보를 확인할 수 없어요.')
    }
    const route = card.route.status === 'available' ? card.route.value : null
    if (route && (!Number.isFinite(route.duration_seconds) || route.duration_seconds < 0)) {
      throw new Error('이동시간 형식이 올바르지 않아요.')
    }
    return {
      id: place.place_id,
      place: {
        id: place.place_id,
        name: place.name,
        category: place.purpose ? purposeLabels[place.purpose] : place.category_name || '장소',
        area: place.address || place.road_address || '',
        lat: place.coordinates.latitude,
        lon: place.coordinates.longitude,
        address: place.road_address || place.address || '',
        photoUrl: null,
        parkingRadius: card.parking.search_radius_meters,
        parking:
          card.parking.status === 'available'
            ? card.parking.items.map((item) => ({
                name: item.name,
                distance: item.distance_meters,
                source: item.records.map((record) => record.source).join(', '),
                measured: item.records[0]?.registered.observed_at || '',
                collected: item.records[0]?.registered.collected_at || '',
              }))
            : null,
      },
      eta: route ? Math.ceil(route.duration_seconds / 60) : null,
      queryTime: raw.created_at,
      reason: card.reason.text,
      parkingUnknown: card.parking.status !== 'available',
      sourceStatus: route
        ? [
            card.route.source || '출처 미확인',
            card.route.freshness === 'stale'
              ? '오래된 정보'
              : card.route.freshness === 'unknown'
                ? '최신성 미확인'
                : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '이동시간 미확인',
    }
  })
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('추천 장소가 중복되어 있어요.')
  }
  return {
    id: raw.result_id,
    time: raw.created_at,
    conditions,
    entries,
    api: { tripId, conditionVersion: version, result: structuredClone(raw) },
  }
}

/** Rebuild display fields from the retained server snapshot, including expired results. */
export function normalizeResult(result: Result): Result {
  if (!result.api) return result
  if (
    typeof result.api.tripId !== 'string' ||
    !Number.isInteger(result.api.conditionVersion) ||
    result.api.conditionVersion < 0 ||
    result.api.result.result_id !== result.id
  ) {
    throw new Error('저장된 추천 문맥이 올바르지 않아요.')
  }
  return {
    ...resultSnapshot(result.api.result, result.api.tripId, result.api.conditionVersion),
    ...(result.number === undefined ? {} : { number: result.number }),
  }
}
export function resultContextStatus(result: Result, now = Date.now()) {
  const api = result.api?.result
  if (!api?.context_token || !api.context_expires_at) return 'missing'
  return Date.parse(api.context_expires_at) <= now ? 'expired' : 'available'
}

/** Mutates only the provided trip draft; invoke after the request scope check. */
export function applyConversationResponse(
  trip: Trip,
  request: PreparedRequest,
  response: ApiResponse<ConversationData>,
): boolean {
  const api = trip.api
  const data = response.envelope.data
  if (
    !api ||
    response.envelope.request_id !== request.requestId ||
    request.scope.tripId !== trip.trip ||
    request.scope.version !== api.version
  )
    return false
  if (!data) return false
  if (
    data.trip_id !== api.tripId ||
    data.base_condition_version !== api.version ||
    !Number.isInteger(data.condition_update.version) ||
    data.condition_update.version < api.version
  )
    return false
  const update = data.condition_update
  const isResult = data.kind === 'recommendation' || data.kind === 'general_candidates'
  // Validate before mutating: a malformed card cannot partially replace a valid result.
  const result =
    isResult && data.result
      ? resultSnapshot(data.result, api.tripId, update.applied ? update.version : api.version)
      : null
  if (isResult && !result) throw new Error('추천 카드가 없는 응답이에요.')
  if (update.applied) {
    api.conditions = structuredClone(update.conditions)
    api.version = update.version
    trip.conditions = displayConditions(update.conditions)
    trip.conditionVersion = update.version
    trip.onboardingDraft = structuredClone(trip.conditions)
    trip.onboardingComplete = !!update.conditions.origin && update.conditions.purposes.length > 0
    api.clarification = null
    api.clarificationInvalid = null
    trip.pendingChat = null
  }
  if (data.kind === 'clarification') {
    api.clarification = structuredClone(data.clarification)
    api.clarificationInvalid = null
  }
  if (data.pending_update === 'clear' && !api.clarification?.origin_context) {
    api.clarification = null
    api.clarificationInvalid = null
  }
  if (
    data.kind === 'answer' &&
    api.clarification?.required_fields.some((field) => field === 'target' || field === 'intent')
  ) {
    api.clarification = null
    api.clarificationInvalid = null
  }
  if (result) {
    api.clarification = null
    api.clarificationInvalid = null
    trip.retainedResult = null
    trip.selected = result.entries[0].id
    if (data.kind === 'general_candidates') {
      trip.general = result
      trip.current = null
    } else {
      const existing = trip.groups.find((group) => group.id === result.id)
      result.number = existing?.number ?? ++trip.sequence
      trip.groups = [result, ...trip.groups.filter((group) => group.id !== result.id)].slice(0, 5)
      trip.current = result.id
      trip.general = null
      trip.seen = [...new Set([...trip.seen, ...result.entries.map((entry) => entry.id)])]
      api.seenPlaceIds = [
        ...new Set([...api.seenPlaceIds, ...result.entries.map((entry) => entry.id)]),
      ]
    }
  } else if (data.kind === 'failure' || data.kind === 'no_candidates') {
    const retained = trip.groups.find((group) => group.id === trip.current) || trip.general
    trip.retainedResult = retained
      ? { id: retained.id, reason: data.kind === 'failure' ? 'failed' : 'empty' }
      : null
  }
  trip.chat.push({
    role: 'assistant',
    text: data.task_results?.length ? data.message : data.answer?.text || data.message,
    time: response.envelope.server_time,
    kind: data.kind,
    ...(data.answer ? { answer: structuredClone(data.answer) } : {}),
    ...(data.task_results?.length ? { taskResults: structuredClone(data.task_results) } : {}),
    ...(result ? { resultId: result.id } : {}),
  })
  // The result may be accepted while an independent information question still needs a card.
  // Keep an origin/condition question visible first; the server owns the remaining tasks.
  if (data.task_clarification && !data.clarification && !api.clarification?.origin_context) {
    api.clarification = structuredClone(data.task_clarification)
    api.clarificationInvalid = null
  }
  trip.chat = trip.chat.slice(-120)
  return true
}
