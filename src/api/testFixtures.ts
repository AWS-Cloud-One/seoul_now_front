import type {
  ApiConditions,
  ApiEnvelope,
  ContextResult,
  ConversationData,
  Information,
} from './contracts'
export const FIXTURE_TIME = '2026-11-10T03:00:00+09:00'
export const apiConditions: ApiConditions = {
  origin: {
    label: '새 출발지',
    coordinates: { latitude: 37.55, longitude: 126.97 },
    address: '서울 중구',
    region: 'seoul',
    supported: true,
  },
  purposes: [
    { purpose: 'cafe', keyword: '커피' },
    { purpose: 'walk', keyword: '공원' },
  ],
  group_type: 'friends',
  age_groups: ['twenties'],
  headcount: 4,
  max_travel_seconds: 1801,
}
export function information<T>(value: T | null): Information<T> {
  return {
    value,
    status: value === null ? 'unavailable' : 'available',
    freshness: 'unknown',
    observed_at: null,
    collected_at: FIXTURE_TIME,
    source: 'test-provider',
    reason_code: value === null ? 'NOT_OBSERVED' : null,
  }
}
export function contextResult(
  id = crypto.randomUUID(),
  placeId = 'provider-place-123',
): ContextResult {
  return {
    result_id: id,
    created_at: FIXTURE_TIME,
    conditions: structuredClone(apiConditions),
    context_token: 'test-result-token',
    context_expires_at: '2026-11-10T03:30:00+09:00',
    cards: [
      {
        rank: 1,
        place: information({
          place_id: placeId,
          name: 'API에서 받은 장소',
          purpose: 'cafe',
          category_code: 'CE7',
          category_name: '카페',
          coordinates: { latitude: 37.57, longitude: 126.98 },
          address: null,
          road_address: '서울 종로구 테스트로',
          phone: null,
          provider_url: null,
        }),
        route: information({ duration_seconds: 451, distance_meters: 1234.5 }),
        parking: {
          status: 'unavailable',
          reason_code: 'NOT_OBSERVED',
          checked_at: FIXTURE_TIME,
          search_radius_meters: null,
          nearest_distance_meters: null,
          items: [],
          total_count: null,
          next_cursor: null,
        },
        reason: { text: '서버가 보존한 추천 근거', source: 'fallback', evidence: [] },
      },
    ],
  }
}
export function conversation(
  request: { request_id: string; trip_id: string; condition_version: number },
  patch: Partial<ConversationData> = {},
): ApiEnvelope<ConversationData> {
  return {
    request_id: request.request_id,
    server_time: FIXTURE_TIME,
    error: null,
    data: {
      trip_id: request.trip_id,
      base_condition_version: request.condition_version,
      kind: 'recommendation',
      message: '추천 결과입니다.',
      condition_update: {
        applied: true,
        version: request.condition_version + 1,
        conditions: structuredClone(apiConditions),
        changes: [],
      },
      stages: { interpretation: 'skipped', routes: 'ok', explanation: 'fallback' },
      result: contextResult(),
      clarification: null,
      answer: null,
      warnings: [],
      ...patch,
    },
  }
}
