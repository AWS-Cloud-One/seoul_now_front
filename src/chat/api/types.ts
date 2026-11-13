/**
 * Chat V2 wire types (AWS_back/app/modules/chat_v2, feat/v2 P4).
 * V2 responses are NOT wrapped in the V1 {data, error, server_time} envelope.
 * Only fields the screen needs are typed precisely; internal snapshots stay loose.
 */
import type {
  ApiConditions,
  ApiPlace,
  Coordinates,
  Information,
  Location,
  ParkingSummary,
  RouteValue,
} from '../../api/contracts'

export type { ApiConditions as Conditions, Location, ParkingSummary, RouteValue }

export type Scope = 'persistent' | 'request_only'
export type Topic = 'place_info' | 'driving' | 'parking' | 'recommendation_reason' | 'traffic'
export type RetryTask = 'interpretation' | 'action' | 'recommendation' | 'lookup' | 'search'

/** A server-issued choice. Its meaning/arguments stay on the server; the client sends only the ID. */
export type ActionStatus = 'available' | 'expired' | 'stale' | 'busy' | 'consumed'
export type ActionView = {
  action_id: string
  type: 'choose'
  label: string
  description: string | null
  /** Read-only display/link values; never sent back as action arguments. */
  target_ref: string | null
  collection_id: string | null
  expires_at: string
  expected_condition_version: number
  expected_state_version: number
  status: ActionStatus
  consumed_by_run_id: string | null
}

export type QuestionView = {
  clarification_id: string
  source_run_id: string
  prompt: string
  required_field: string
  scope: 'persistent' | 'request_only' | 'lookup'
  expected_answer_type: 'integer' | 'text' | 'choice'
  allow_free_text: true
  status: 'active' | 'resolved'
  options: ActionView[]
}

export type UserMessage = {
  message_id: string
  input_type: 'message' | 'action' | 'retry'
  text: string
  source_run_id: string | null
}

export type HistoryTurn = {
  sequence: number
  created_at: string
  user_message: UserMessage
  /** Shared by the progress and final answer of this request. */
  assistant_message_id: string
  run: ExecutionView
}

export type HistoryPage = {
  conversation_id: string
  state_version: number
  snapshot_sequence: number
  /** Oldest first within a page; `next_cursor` fetches the page before it. */
  items: HistoryTurn[]
  next_cursor: string | null
  active_run_id: string | null
}

export type SessionCreated = { session_id: string; session_token: string; expires_at: string }

export type DestinationArea = {
  label: string
  kind?: 'administrative' | 'official' | 'radius'
  query?: string | null
  area_ids: string[]
  boundary_ids?: string[]
  boundary_versions?: Record<string, string>
  source?: string | null
  alias_version?: string | null
  anchor?: {
    place_id: string
    name: string
    coordinates: { latitude: number; longitude: number }
    address: string
    category: string
    collected_at: string
  } | null
  radius_m?: number | null
}

export type FoundPlace = {
  place_id: string
  name: string
  category_code: string | null
  category_name: string | null
  coordinates: Coordinates
  address: string | null
  road_address: string | null
  phone: string | null
  provider_url: string | null
  distance_meters: number | null
  source: 'kakao_local'
  collected_at: string
}

export type PlaceReference = {
  ref_id: string
  collection_id: string
  result_id: string | null
  position: number
  place: FoundPlace
}

export type OriginOption = { option_id: string; position: number; location: Location }

export type PendingQuestion = {
  clarification_id: string
  scope: Scope
  question: string
  field: 'headcount' | 'origin' | 'purposes' | 'search_area'
}

export type PendingRead = {
  comparison_metric: 'duration_seconds' | 'distance_meters' | null
  target_refs: string[]
  origin_options: OriginOption[]
  clarification_id: string
  topics: Topic[]
  question: string
}

export type ConversationSnapshot = {
  conversation_id: string
  trip_id: string
  condition_version: number
  state_version: number
  conditions: ApiConditions
  pending_question: PendingQuestion | null
  active_run_id: string | null
  expires_at: string
  /** Questions that can still be answered (condition + separate lookup, at most 2). */
  questions?: QuestionView[]
  search_area?: DestinationArea | null
  draft?: unknown
  references?: PlaceReference[]
  focus_ref?: string | null
  pending_read?: PendingRead | null
  active_flow?: unknown
}

export type MessageInput = {
  type: 'message'
  text: string
  reply_to_clarification_id?: string
}
export type RetryInput = { type: 'retry'; source_run_id: string; task_ids: [RetryTask] }
export type ActionInput = { type: 'action'; action_id: string }
export type ViewedContext = {
  result_id?: string
  clarification_id?: string
  collection_id?: string
  place_ref?: string
}
export type RunRequest = {
  schema_version: 2
  request_id: string
  expected_condition_version: number
  expected_state_version: number
  input: MessageInput | RetryInput | ActionInput
  /** Never set for actions: the server owns their target. */
  viewed_context?: ViewedContext | null
}

export type RunIdentity = {
  conversation_id: string
  trip_id: string
  run_id: string
  request_id: string
}

export type StageErrorCode =
  | 'INTERPRETATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'INTERNAL_ERROR'
  | 'RECOMMENDATION_FAILED'
  | 'COMMIT_FAILED'
  | 'COMMIT_UNCERTAIN'
  | 'CONFLICT'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'DEADLINE_EXCEEDED'
  | 'UNSUPPORTED'
export type StageError = { code: StageErrorCode; safe_message: string; retryable: boolean }

export type ConditionField = 'origin' | 'purposes' | 'headcount' | 'max_travel_seconds'
export type CommitReceipt = {
  phase: 'committed'
  identity: RunIdentity
  previous_version: number
  current_version: number
  conditions: ApiConditions
  changed_fields: ConditionField[]
  result_id: string | null
  committed_at: string
}
export type Commit =
  | { state: 'committed'; receipt: CommitReceipt }
  | { state: 'not_applied' | 'unknown'; error: StageError }

/** Internal hand-off; the screen reads only outcome/selection_mode/prepared_at and the commit. */
export type RunSnapshot = {
  schema_version: 1
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'reconciling'
  finalization: {
    prepared: {
      outcome: 'recommendation' | 'no_candidates' | 'insufficient_evidence' | 'error'
      selection_mode?: 'driving' | 'regional'
      prepared_at: string
      [key: string]: unknown
    }
    commit: Commit
  }
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
  ranking?: unknown
}

export type PublishedRecommendation = {
  selection_mode: 'driving' | 'regional'
  search_area: DestinationArea | null
  result_id: string
  cards: ContextCard[]
  effective_conditions: ApiConditions
  scope: Scope
  flow_id: string | null
  constraints: unknown
}

export type SourceReference = {
  source_id: string
  provider: string
  record_ref: string
  collected_at: string | null
  checked_at?: string | null
}

export type ReadItem = {
  topic: Topic
  place_ref: string
  status: 'ok' | 'empty' | 'unavailable' | 'error'
  data: unknown
  sources: SourceReference[]
  reason_code: string | null
  retryable: boolean
}

export type LookupResult = {
  outcome: 'ok' | 'partial' | 'empty' | 'unavailable' | 'error'
  items: ReadItem[]
  places: PlaceReference[]
  has_more: boolean
  reason_code: string | null
}

export type ComparisonResult = {
  metric: 'duration_seconds' | 'distance_meters'
  unit: 'seconds' | 'meters'
  origin_label: string
  outcome: 'complete' | 'incomplete'
  values: Record<string, number | null>
  best_refs: string[]
  reason_code: string | null
}

export type ContinuationResult = {
  status:
    'pending' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'interrupted' | 'waiting_input'
  lookup: LookupResult | null
  reason_code: string | null
}

export type NeedsInput = {
  kind: 'needs_input'
  question: string
  required_field: 'headcount' | 'origin' | 'purposes' | 'search_area' | 'lookup_origin' | 'target'
}

export type EvaluationSummary = {
  assessments?: unknown[]
  branch?: 'primary' | 'alternative'
  primary_outcome?: string | null
  guard?: 'true' | 'false' | 'unknown' | null
}

export type ResponseKind =
  'result' | 'clarification' | 'unchanged' | 'unsupported' | 'failure' | 'answer' | 'decision'
export type ResponseStatus =
  'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'reconciling' | 'waiting_input'

export type ChatResponse = {
  identity: RunIdentity
  kind: ResponseKind
  status: ResponseStatus
  answer: string
  conditions: ApiConditions | null
  condition_version: number | null
  snapshot?: RunSnapshot | null
  recommendation?: PublishedRecommendation | null
  clarification?: NeedsInput | null
  error?: StageError | null
  warnings?: string[]
  lookup?: LookupResult | null
  origin_options?: OriginOption[]
  comparison?: ComparisonResult | null
  continuation?: ContinuationResult | null
  evaluation?: EvaluationSummary | null
}

export type RunStatus = 'accepted' | 'running' | 'reconciling' | 'finished'
export type ExecutionView = {
  identity: RunIdentity
  state_version: number
  status: RunStatus
  response: ChatResponse | null
  stage: string
  event_seq: number
  cancel_requested_at: string | null
  retryable_tasks: string[]
  /** This run's question (may be resolved later); current options come from the conversation. */
  question?: QuestionView | null
}

export type RunEvent = {
  event_seq: number
  type: string
  state_version: number
  payload: Record<string, unknown>
  created_at: string
}

export type SubmitResult = { run: ExecutionView; status_url: string }
export type RunPoll = { run: ExecutionView; events: RunEvent[] }
