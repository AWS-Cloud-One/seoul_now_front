/** Wire contracts from AWS_back/app/schemas; UI labels and units live in adapters. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ApiError = {
  code: string
  message: string
  retryable: boolean
  retry_after_seconds?: number | null
  details: { field: string; code: string; message: string }[]
}
export type ApiEnvelope<T> = {
  request_id: string
  server_time: string
  data: T | null
  error: ApiError | null
}
export type Information<T> = {
  value: T | null
  status: 'available' | 'unavailable' | 'unsupported' | 'error'
  freshness: 'fresh' | 'stale' | 'unknown' | 'not_applicable'
  observed_at: string | null
  collected_at: string | null
  source: string | null
  reason_code: string | null
}
export type Coordinates = { latitude: number; longitude: number }
export type Location = {
  label: string
  coordinates: Coordinates
  address: string | null
  region: 'seoul' | 'incheon' | 'gyeonggi' | 'other' | null
  supported: boolean
}
export type Purpose = 'cafe' | 'food' | 'walk' | 'exhibition'
export type GroupType = 'solo' | 'date' | 'friends' | 'family' | 'other'
export type AgeGroup =
  'under_10' | 'teens' | 'twenties' | 'thirties' | 'forties' | 'fifties' | 'sixty_plus'
export type ApiConditions = {
  origin: Location | null
  purposes: { purpose: Purpose; keyword: string | null }[]
  group_type: GroupType | null
  age_groups: AgeGroup[] | null
  headcount: number | null
  max_travel_seconds: number | null
}
// Optional properties must remain omitted; explicit null clears only optional conditions.
export type ConditionsPatch = Partial<Omit<ApiConditions, 'origin'>> & { origin?: Location }
export type RequestContext = {
  request_id: string
  trip_id: string
  condition_version: number
  current_conditions: ApiConditions
  excluded_place_ids: string[]
}
export type RecommendationRequest = RequestContext & { conditions_patch: ConditionsPatch }
export type OriginContext = {
  context_token: string
  mode: 'confirm' | 'choose' | 'refine' | 'confirmed'
  preferred_candidate_id: string | null
  expires_at: string
  search_limited: boolean
}
export type OriginChoiceValue = {
  candidate_id: string
  location: Location
  match_reasons: string[]
}
export type Clarification = {
  question: string
  required_fields: string[]
  pending_patch: ConditionsPatch
  choices: { label: string; value: JsonValue }[]
  origin_context: OriginContext | null
}
export type OriginAction =
  | { action: 'select'; context_token: string; candidate_id: string }
  | { action: 'show_alternatives' | 'restart'; context_token: string; candidate_id?: never }
export type ChatTarget = { result_id: string; place_id: string; context_token: string }
export type ChatRequest = RequestContext & {
  message: string
  recent_messages?: { role: 'user' | 'assistant'; content: string }[]
  pending_clarification?: Clarification | null
} & (
    | { origin_action: OriginAction; target?: never }
    | { origin_action?: null; target?: ChatTarget | null }
  )
export type ApiPlace = {
  place_id: string
  name: string
  purpose: Purpose | null
  category_code: string | null
  category_name: string | null
  coordinates: Coordinates
  address: string | null
  road_address: string | null
  phone: string | null
  provider_url: string | null
}
export type RouteValue = { duration_seconds: number; distance_meters: number }
export type ParkingSourceRecord = {
  source_record_id: string
  source: string
  reference_date: string | null
  registered: Information<{
    address: string | null
    registered_capacity: number | null
    fees: {
      base_minutes: number | null
      base_fee_krw: number | null
      additional_minutes: number | null
      additional_fee_krw: number | null
      daily_max_krw: number | null
      notes: string | null
    } | null
    operating_hours: {
      weekdays: string | null
      saturday: string | null
      sunday_holidays: string | null
      notes: string | null
    } | null
  }>
}
export type ParkingSummary = {
  status: 'available' | 'unavailable' | 'error'
  reason_code: string | null
  checked_at: string
  search_radius_meters: 300 | 500 | 1000 | null
  nearest_distance_meters: number | null
  items: {
    parking_id: string
    identity_status: 'verified' | 'unverified'
    name: string
    coordinates: Coordinates
    distance_meters: number
    records: ParkingSourceRecord[]
    availability: Information<null>
  }[]
  total_count: number | null
  next_cursor: string | null
}
type TrafficGrade = '원활' | '서행' | '정체'
export type ContextCard = {
  rank: number | null
  place: Information<ApiPlace>
  route: Information<RouteValue>
  parking: ParkingSummary
  reason: {
    text: string
    source: 'ai' | 'fallback' | 'none'
    evidence: (
      | { type: 'eta'; text: string; information: Information<RouteValue> }
      | { type: 'parking'; text: string; information: Information<{ distance_meters: number }> }
      | { type: 'traffic'; text: string; information: Information<{ grade: TrafficGrade }> }
    )[]
  }
  ranking?: {
    evaluated_at: string
    eta_bucket: number
    traffic_applied: boolean
    parking_adjustment: number
    adjusted_traffic_grade: TrafficGrade | null
  } | null
}
export type ContextResult = {
  result_id: string
  created_at: string
  conditions: ApiConditions
  context_token: string | null
  context_expires_at: string | null
  cards: ContextCard[]
  ranking_policy?: {
    name: 'eta_traffic_parking_v1'
    time_bucket_seconds: number
    parking_bonus_radius_m: number
    traffic_max_age_seconds: number
  } | null
  search_scope?: {
    fallback: boolean
    more_available: boolean
    areas: {
      area_id: string
      name: string
      center: Coordinates
      source: string
      geometry_version: string
      congestion: TrafficGrade | '확인 불가'
      road_observed_at: string | null
      registered_parking_count: number | null
      parking_checked_at: string | null
    }[]
  } | null
}
export type ConversationData = {
  trip_id: string
  base_condition_version: number
  kind:
    | 'clarification'
    | 'recommendation'
    | 'general_candidates'
    | 'no_candidates'
    | 'failure'
    | 'answer'
  message: string
  condition_update: {
    applied: boolean
    conditions: ApiConditions
    version: number
    changes: { field: string; before: JsonValue; after: JsonValue }[]
  }
  stages: {
    interpretation: 'skipped' | 'ok' | 'failed'
    routes: 'skipped' | 'ok' | 'partial' | 'failed'
    explanation: 'skipped' | 'ok' | 'fallback'
  }
  result: ContextResult | null
  clarification: Clarification | null
  answer: {
    topic:
      | 'recommendation_reason'
      | 'travel_time'
      | 'parking'
      | 'population'
      | 'scope_notice'
      | 'conversation'
    place_id: string | null
    text: string
    original_result_id: string | null
    original_recommended_at: string | null
    checked_at: string | null
    information: Information<JsonValue>[]
  } | null
  pending_update?: 'keep' | 'clear'
  task_results?: {
    task_id: string
    topic: NonNullable<ConversationData['answer']>['topic']
    status: 'completed' | 'needs_input' | 'failed' | 'waiting'
    message: string
    answer: ConversationData['answer']
    error_code: string | null
    retryable: boolean
  }[]
  task_clarification?: Clarification | null
  warnings: { code: string; message: string }[]
}
export type ServerTrip = {
  tripId: string
  seenPlaceIds: string[]
  conditions: ApiConditions
  version: number
  clarification: Clarification | null
  clarificationInvalid?: string | null
}
export type PlaceDetailData = {
  result_id: string
  place: Information<ApiPlace>
  parking: ParkingSummary
  original_recommended_at: string | null
  checked_at: string
}
export type TravelTimeRequest = {
  request_id: string
  trip_id: string
  condition_version: number
  result_id: string
  context_token: string
}
export type TravelTimeData = {
  trip_id: string
  base_condition_version: number
  result_id: string
  place_id: string
  original_recommended_at: string | null
  checked_at: string
  route: Information<RouteValue>
}
export type RetryRoutesRequest = RequestContext & { result_id: string; context_token: string }
