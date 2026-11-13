/**
 * In-memory stand-in for the V2 chat API, shaped exactly like the wire types.
 * Used by tests and by `VITE_CHAT_MODE=mock` for screen work without a backend.
 * A mock success is NOT a verified server result; keyword rules here are only test fixtures.
 *
 * P5 behaviour mirrored from AWS_back/app/modules/chat_v2 (storage/interaction_store/history):
 * - messages API: latest page first, oldest-first inside a page, opaque cursor, fixed sequence
 * - questions[] (max 2) with server-issued choose actions; GET conversation re-issues them
 * - action: consumed → original run; expired → 410 ACTION_EXPIRED; moved on → 409 ACTION_STALE
 */
import { ChatError, type ChatClient } from './client'
import type {
  ActionView,
  ChatResponse,
  ContextCard,
  Conditions,
  ConversationSnapshot,
  ExecutionView,
  FoundPlace,
  HistoryTurn,
  LookupResult,
  OriginOption,
  PlaceReference,
  QuestionView,
  ReadItem,
  RouteValue,
  RunEvent,
  RunRequest,
  UserMessage,
} from './types'
import type { Information, Location, ParkingSummary, Purpose } from '../../api/contracts'

type Decision =
  | { kind: 'purpose'; purpose: Purpose }
  | { kind: 'origin'; location: Location; target_ref: string | null }

type Choice = {
  key: string
  label: string
  description: string | null
  target_ref: string | null
  decision: Decision
}
type QuestionDef = {
  clarification_id: string
  source_run_id: string
  prompt: string
  required_field: string
  scope: QuestionView['scope']
  expected_answer_type: QuestionView['expected_answer_type']
  choices: Choice[]
}
type MockAction = {
  action_id: string
  conversation_id: string
  clarification_id: string
  key: string
  expires: number
  condition_version: number
  state_version: number
  consumed_by: string | null
}

type MockRun = {
  view: ExecutionView
  stages: string[]
  events: RunEvent[]
  request: RunRequest
  sequence: number
  created_at: string
  message: UserMessage
  assistant_message_id: string
  decision: Decision | null
}
type MockConversation = Omit<ConversationSnapshot, 'questions'> & {
  session: string
  deleted?: boolean
  pending: string[]
  sequence: number
}

export type MockOptions = {
  /** Polls before a run finishes (one stage per poll). */
  stepsPerRun?: number
  now?: () => number
  /** Makes the next N submissions fail without a response (network loss after storing). */
  dropResponses?: number
  /** Choice lifetime; the server uses at most 5 minutes. */
  actionTtlMs?: number
}

const uuid = () => crypto.randomUUID()
const iso = (ms: number) => new Date(ms).toISOString()

const info = <T>(value: T | null, extra: Partial<Information<T>> = {}): Information<T> => ({
  value,
  status: value === null ? 'unavailable' : 'available',
  freshness: value === null ? 'not_applicable' : 'fresh',
  observed_at: null,
  collected_at: null,
  source: null,
  reason_code: null,
  ...extra,
})

const emptyConditions = (): Conditions => ({
  origin: null,
  purposes: [],
  group_type: null,
  age_groups: null,
  headcount: null,
  max_travel_seconds: null,
})

const SPOTS: Record<string, [string, number, number][]> = {
  성수: [
    ['성수 로스터리', 37.5446, 127.0557],
    ['서울숲 브루어스', 37.5439, 127.0446],
    ['뚝섬 커피랩', 37.5472, 127.0474],
  ],
  강남: [
    ['강남 갤러리 카페', 37.4979, 127.0276],
    ['역삼 브런치', 37.5006, 127.0364],
    ['논현 티룸', 37.5112, 127.0216],
  ],
}
const PURPOSE_LABELS: Record<Purpose, string> = {
  cafe: '카페',
  food: '식사',
  walk: '산책',
  exhibition: '전시',
}

const STATION: Location = {
  label: '서울역',
  coordinates: { latitude: 37.5547, longitude: 126.9706 },
  address: '서울 중구 한강대로 405',
  region: 'seoul',
  supported: true,
}
const TERMINAL: Location = {
  ...STATION,
  label: '서울역 버스환승센터',
  address: '서울 용산구 한강대로 지하 392',
}

function parking(
  total: number | null,
  status: ParkingSummary['status'] = 'available',
): ParkingSummary {
  return {
    status: total === 0 ? 'unavailable' : status,
    reason_code:
      total === 0 ? 'NO_PARKING_NEARBY' : status === 'available' ? null : 'DATA_UNAVAILABLE',
    checked_at: new Date().toISOString(),
    search_radius_meters: 500,
    nearest_distance_meters: total ? 140 : null,
    items: total
      ? [
          {
            parking_id: uuid(),
            identity_status: 'verified',
            name: '성수동 공영주차장',
            coordinates: { latitude: 37.5442, longitude: 127.0561 },
            distance_meters: 140,
            records: [],
            availability: info<null>(null, { status: 'unsupported' }),
          },
        ]
      : [],
    total_count: total,
    next_cursor: null,
  }
}

function found(name: string, lat: number, lng: number, now: number): FoundPlace {
  return {
    place_id: `kakao:${name}`,
    name,
    category_code: 'CE7',
    category_name: '카페',
    coordinates: { latitude: lat, longitude: lng },
    address: '서울 성동구 성수동',
    road_address: null,
    phone: null,
    provider_url: null,
    distance_meters: null,
    source: 'kakao_local',
    collected_at: iso(now),
  }
}

/** Opaque to the client, like the server's cursor. */
const encodeCursor = (snapshot: number, before: number) => btoa(`${snapshot}:${before}`)
const decodeCursor = (cursor: string) => {
  try {
    const [snapshot, before] = atob(cursor).split(':').map(Number)
    if (Number.isInteger(snapshot) && Number.isInteger(before)) return { snapshot, before }
  } catch {
    // fall through
  }
  throw new ChatError('invalid', 422, 'INVALID_CURSOR')
}

export function createMockChatClient(options: MockOptions = {}): ChatClient & {
  conversations: Map<string, MockConversation>
  runs: Map<string, MockRun>
  actions: Map<string, MockAction>
  dropNext(count?: number): void
} {
  const steps = options.stepsPerRun ?? 2
  const now = options.now ?? Date.now
  const ttl = options.actionTtlMs ?? 5 * 60_000
  const sessions = new Map<string, { token: string; expires: number }>()
  const conversations = new Map<string, MockConversation>()
  const runs = new Map<string, MockRun>()
  const byRequest = new Map<string, string>()
  const questions = new Map<string, QuestionDef>()
  const actions = new Map<string, MockAction>()
  let drop = options.dropResponses ?? 0

  const auth = (token: string) => {
    const [id, secret] = token.split('.')
    const session = sessions.get(id)
    if (!session || session.token !== secret)
      throw new ChatError('unauthorized', 401, 'UNAUTHORIZED')
    if (session.expires <= now()) throw new ChatError('expired', 410, 'EXPIRED')
    return id
  }
  const owned = (token: string, id: string) => {
    const session = auth(token)
    const conversation = conversations.get(id)
    if (!conversation || conversation.session !== session || conversation.deleted)
      throw new ChatError('not_found', 404, 'NOT_FOUND')
    if (Date.parse(conversation.expires_at) <= now()) throw new ChatError('expired', 410, 'EXPIRED')
    return conversation
  }

  // ---- questions / actions ------------------------------------------------------------------
  const actionStatus = (c: MockConversation, a: MockAction): ActionView['status'] =>
    a.consumed_by
      ? 'consumed'
      : a.expires <= now()
        ? 'expired'
        : a.condition_version !== c.condition_version ||
            a.state_version !== c.state_version ||
            !c.pending.includes(a.clarification_id)
          ? 'stale'
          : c.active_run_id
            ? 'busy'
            : 'available'

  /** Only GET conversation (and question creation) issues fresh choices, like the server. */
  function issue(c: MockConversation, def: QuestionDef) {
    for (const choice of def.choices) {
      const existing = [...actions.values()].filter(
        (a) => a.clarification_id === def.clarification_id && a.key === choice.key,
      )
      if (existing.some((a) => ['available', 'busy', 'consumed'].includes(actionStatus(c, a))))
        continue
      const id = uuid()
      actions.set(id, {
        action_id: id,
        conversation_id: c.conversation_id,
        clarification_id: def.clarification_id,
        key: choice.key,
        expires: Math.min(now() + ttl, Date.parse(c.expires_at)),
        condition_version: c.condition_version,
        state_version: c.state_version,
        consumed_by: null,
      })
    }
  }

  function questionView(c: MockConversation, def: QuestionDef): QuestionView {
    const active = c.pending.includes(def.clarification_id)
    const options: ActionView[] = []
    for (const choice of def.choices) {
      const candidates = [...actions.values()].filter(
        (a) => a.clarification_id === def.clarification_id && a.key === choice.key,
      )
      const action = candidates.at(-1)
      if (!action) continue
      options.push({
        action_id: action.action_id,
        type: 'choose',
        label: choice.label,
        description: choice.description,
        target_ref: choice.target_ref,
        collection_id: null,
        expires_at: iso(action.expires),
        expected_condition_version: action.condition_version,
        expected_state_version: action.state_version,
        status: actionStatus(c, action),
        consumed_by_run_id: action.consumed_by,
      })
    }
    return {
      clarification_id: def.clarification_id,
      source_run_id: def.source_run_id,
      prompt: def.prompt,
      required_field: def.required_field,
      scope: def.scope,
      expected_answer_type: def.expected_answer_type,
      allow_free_text: true,
      status: active ? 'active' : 'resolved',
      options,
    }
  }

  function ask(c: MockConversation, run: MockRun, def: Omit<QuestionDef, 'source_run_id'>) {
    const full: QuestionDef = { ...def, source_run_id: run.view.identity.run_id }
    questions.set(full.clarification_id, full)
    // One condition question and one separate lookup question at most.
    const lookup = full.scope === 'lookup'
    c.pending = [
      ...c.pending.filter((id) => (questions.get(id)?.scope === 'lookup') !== lookup),
      full.clarification_id,
    ]
    return full
  }

  const resolve = (c: MockConversation, id: string) => {
    c.pending = c.pending.filter((q) => q !== id)
  }

  const snapshotOf = (c: MockConversation, reissue: boolean): ConversationSnapshot => {
    const defs = c.pending.map((id) => questions.get(id)!).filter(Boolean)
    if (reissue) defs.forEach((def) => issue(c, def))
    const copy = structuredClone(c) as Partial<MockConversation>
    delete copy.session
    delete copy.deleted
    delete copy.pending
    delete copy.sequence
    return { ...(copy as ConversationSnapshot), questions: defs.map((d) => questionView(c, d)) }
  }

  const viewOf = (c: MockConversation, run: MockRun): ExecutionView => {
    const view = structuredClone(run.view)
    const def = [...questions.values()].find((q) => q.source_run_id === run.view.identity.run_id)
    view.question = def ? questionView(c, def) : null
    return view
  }

  // ---- run execution --------------------------------------------------------------------------
  const event = (run: MockRun, type: string, payload: Record<string, unknown>) => {
    run.view.event_seq += 1
    run.events.push({
      event_seq: run.view.event_seq,
      type,
      state_version: run.view.state_version,
      payload,
      created_at: iso(now()),
    })
  }
  const base = (c: MockConversation, run: MockRun) => ({
    identity: structuredClone(run.view.identity),
    conditions: structuredClone(c.conditions),
    condition_version: c.condition_version,
  })

  function finish(
    c: MockConversation,
    run: MockRun,
    response: ChatResponse,
    retry: string[] = [],
    question?: Omit<QuestionDef, 'source_run_id'>,
  ) {
    run.view.status = 'finished'
    run.view.stage = 'finished'
    run.view.response = response
    run.view.retryable_tasks = retry
    c.active_run_id = null
    c.state_version += 1
    run.view.state_version = c.state_version
    if (question) issue(c, ask(c, run, question))
    event(run, 'run_finished', { status: response.status })
  }

  function recommend(
    c: MockConversation,
    run: MockRun,
    text: string,
    purpose: Purpose = 'cafe',
  ): ChatResponse {
    const area = Object.keys(SPOTS).find((key) => text.includes(key)) ?? '성수'
    const headcount = /셋|3명/.test(text) ? 3 : /둘|2명/.test(text) ? 2 : null
    const requestOnly = text.includes('이번만')
    const previous = c.condition_version
    const changed: ('purposes' | 'headcount' | 'max_travel_seconds')[] = []
    const effective = structuredClone(c.conditions)
    if (!effective.purposes.length || effective.purposes[0].purpose !== purpose) {
      effective.purposes = [{ purpose, keyword: null }]
      changed.push('purposes')
    }
    if (headcount && effective.headcount !== headcount) {
      effective.headcount = headcount
      changed.push('headcount')
    }
    if (requestOnly) effective.max_travel_seconds = 1200
    if (!requestOnly) {
      c.conditions = effective
      if (changed.length) c.condition_version += 1
      c.search_area = { label: `${area} 일대`, area_ids: [area] }
    }
    const resultId = uuid()
    const t = now()
    const label = PURPOSE_LABELS[purpose]
    const cards: ContextCard[] = SPOTS[area].map(([name, lat, lng], i) => ({
      rank: i + 1,
      place: info(
        {
          place_id: `kakao:${name}`,
          name,
          purpose,
          category_code: 'CE7',
          category_name: label,
          coordinates: { latitude: lat, longitude: lng },
          address: `서울 ${area}`,
          road_address: null,
          phone: null,
          provider_url: null,
        },
        { collected_at: iso(t), source: 'kakao_local' },
      ),
      route: info<RouteValue>(null, { status: 'unavailable', reason_code: 'ORIGIN_NOT_SET' }),
      parking: i === 1 ? parking(0) : parking(i === 2 ? null : 4, i === 2 ? 'error' : 'available'),
      reason: {
        text: `${area}에서 ${label}로 들르기 좋은 곳이에요.`,
        source: 'fallback',
        evidence: [],
      },
      ranking: null,
    }))
    c.references = [
      ...(c.references ?? []).filter((ref) => ref.collection_id !== resultId),
      ...cards.map((card) => ({
        ref_id: `result:${resultId}:${card.rank}`,
        collection_id: resultId,
        result_id: resultId,
        position: card.rank!,
        place: found(
          card.place.value!.name,
          card.place.value!.coordinates.latitude,
          card.place.value!.coordinates.longitude,
          t,
        ),
      })),
    ].slice(-30)
    const withParking = text.includes('주차도')
    const lookup = withParking ? parkingLookup(`result:${resultId}:1`, text.includes('실패')) : null
    const continuation = withParking
      ? {
          status: lookup!.outcome === 'error' ? ('failed' as const) : ('completed' as const),
          lookup,
          reason_code: null,
        }
      : null
    const status = continuation?.status === 'failed' ? 'partial' : 'succeeded'
    return {
      ...base(c, run),
      kind: 'result',
      status,
      answer: requestOnly
        ? `여행 기본 조건은 유지하고 이번 추천에만 조건을 적용했어요. ${area} 일대 탐색 범위에서 3곳을 추천했어요.`
        : `요청한 조건을 반영했어요. ${area} 일대 탐색 범위에서 3곳을 추천했어요. 지역·방문 목적에 맞는 후보이며, 이동시간과 주행 순위는 계산하지 않았어요.`,
      snapshot: {
        schema_version: 1,
        status: 'succeeded',
        finalization: {
          prepared: { outcome: 'recommendation', selection_mode: 'regional', prepared_at: iso(t) },
          commit: {
            state: 'committed',
            receipt: {
              phase: 'committed',
              identity: structuredClone(run.view.identity),
              previous_version: previous,
              current_version: c.condition_version,
              conditions: structuredClone(c.conditions),
              changed_fields: requestOnly ? [] : changed,
              result_id: resultId,
              committed_at: iso(t),
            },
          },
        },
      },
      recommendation: {
        selection_mode: 'regional',
        search_area: { label: `${area} 일대`, area_ids: [area] },
        result_id: resultId,
        cards,
        effective_conditions: effective,
        scope: requestOnly ? 'request_only' : 'persistent',
        flow_id: requestOnly ? uuid() : null,
        constraints: null,
      },
      continuation,
      warnings: [],
    }
  }

  function parkingLookup(ref: string, fail: boolean): LookupResult {
    const item: ReadItem = fail
      ? {
          topic: 'parking',
          place_ref: ref,
          status: 'error',
          data: null,
          sources: [],
          reason_code: 'PROVIDER_TIMEOUT',
          retryable: true,
        }
      : {
          topic: 'parking',
          place_ref: ref,
          status: 'ok',
          data: parking(4),
          sources: [
            {
              source_id: 'registered_parking',
              provider: 'registered_parking',
              record_ref: ref,
              collected_at: null,
              checked_at: iso(now()),
            },
          ],
          reason_code: null,
          retryable: false,
        }
    return {
      outcome: fail ? 'error' : 'ok',
      items: [item],
      places: [],
      has_more: false,
      reason_code: null,
    }
  }

  function drivingAnswer(c: MockConversation, run: MockRun, origin: Location, ref: string) {
    const lookup: LookupResult = {
      outcome: 'ok',
      items: [
        {
          topic: 'driving',
          place_ref: ref,
          status: 'ok',
          data: {
            origin_label: origin.label,
            route: info({ duration_seconds: 1500, distance_meters: 9100 }),
          },
          sources: [],
          reason_code: null,
          retryable: false,
        },
      ],
      places: [],
      has_more: false,
      reason_code: null,
    }
    return {
      ...base(c, run),
      kind: 'answer' as const,
      status: 'succeeded' as const,
      answer: `${origin.label}에서 출발하는 이동시간이에요.`,
      lookup,
    }
  }

  type Outcome = [ChatResponse, string[], Omit<QuestionDef, 'source_run_id'>?]

  function respond(c: MockConversation, run: MockRun): Outcome {
    const input = run.request.input
    if (run.decision) {
      const decision = run.decision
      if (decision.kind === 'purpose') return [recommend(c, run, '', decision.purpose), []]
      return [drivingAnswer(c, run, decision.location, decision.target_ref ?? ''), []]
    }
    if (input.type === 'retry') {
      const source = runs.get(input.source_run_id)?.view.response
      if (source?.continuation) {
        const ref = source.continuation.lookup?.items[0]?.place_ref ?? ''
        return [
          {
            ...base(c, run),
            kind: 'answer',
            status: 'succeeded',
            answer: '주차 정보를 다시 조회했어요.',
            lookup: parkingLookup(ref, false),
          },
          [],
        ]
      }
      return [
        {
          ...base(c, run),
          kind: 'unchanged',
          status: 'succeeded',
          answer: '다시 시도했지만 바뀐 내용이 없어요.',
        },
        [],
      ]
    }
    if (input.type !== 'message') throw new Error('unreachable')
    const text = input.text
    const ref = run.request.viewed_context?.place_ref
    if (/예약|빈자리|수용/.test(text))
      return [
        {
          ...base(c, run),
          kind: 'unsupported',
          status: 'succeeded',
          answer: '예약이나 빈자리는 확인할 수 없어요.',
          error: {
            code: 'UNSUPPORTED',
            safe_message: '예약이나 빈자리는 확인할 수 없어요.',
            retryable: false,
          },
        },
        [],
      ]
    if (text.includes('오류'))
      return [
        {
          ...base(c, run),
          kind: 'failure',
          status: 'failed',
          answer: '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
          error: {
            code: 'INTERPRETATION_FAILED',
            safe_message: '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
            retryable: true,
          },
        },
        ['interpretation'],
      ]
    if (ref && text.includes('주차'))
      return [
        {
          ...base(c, run),
          kind: 'answer',
          status: 'succeeded',
          answer: '등록된 주차장 목록을 확인했어요.',
          lookup: parkingLookup(ref, false),
        },
        [],
      ]
    if (ref && text.includes('왜')) {
      const lookup: LookupResult = {
        outcome: 'ok',
        items: [
          {
            topic: 'recommendation_reason',
            place_ref: ref,
            status: 'ok',
            data: {
              reason: {
                text: '목적에 맞고 주변 등록 주차장이 있는 곳이라 골랐어요.',
                source: 'ai',
                evidence: [],
              },
              recommended_at: iso(now() - 60000),
            },
            sources: [],
            reason_code: null,
            retryable: false,
          },
        ],
        places: [],
        has_more: false,
        reason_code: null,
      }
      return [
        {
          ...base(c, run),
          kind: 'answer',
          status: 'succeeded',
          answer: '추천 당시 기록된 이유예요.',
          lookup,
        },
        [],
      ]
    }
    if (text.includes('비교')) {
      const [a, b] = (c.references ?? []).slice(-3)
      if (!a || !b)
        return [
          {
            ...base(c, run),
            kind: 'clarification',
            status: 'waiting_input',
            answer: '비교할 장소를 먼저 골라 주세요.',
            clarification: {
              kind: 'needs_input',
              question: '비교할 장소를 먼저 골라 주세요.',
              required_field: 'target',
            },
          },
          [],
        ]
      const lookup: LookupResult = {
        outcome: 'partial',
        items: [
          {
            topic: 'driving',
            place_ref: a.ref_id,
            status: 'ok',
            data: {
              origin_label: '서울역',
              route: info({ duration_seconds: 1500, distance_meters: 9100 }),
            },
            sources: [],
            reason_code: null,
            retryable: false,
          },
          {
            topic: 'driving',
            place_ref: b.ref_id,
            status: 'unavailable',
            data: null,
            sources: [],
            reason_code: 'DATA_UNAVAILABLE',
            retryable: false,
          },
        ],
        places: [],
        has_more: false,
        reason_code: null,
      }
      return [
        {
          ...base(c, run),
          kind: 'answer',
          status: 'partial',
          answer: '한 곳의 경로 자료가 없어 비교할 수 없어요.',
          lookup,
          comparison: {
            metric: 'duration_seconds',
            unit: 'seconds',
            origin_label: '서울역',
            outcome: 'incomplete',
            values: { [a.ref_id]: 1500, [b.ref_id]: null },
            best_refs: [],
            reason_code: 'DATA_UNAVAILABLE',
          },
        },
        [],
      ]
    }
    // P4-era record: a question without the structured question/actions (shown as text only).
    if (text.includes('옛 질문')) {
      const options: OriginOption[] = [{ option_id: uuid(), position: 1, location: STATION }]
      return [
        {
          ...base(c, run),
          kind: 'clarification',
          status: 'waiting_input',
          answer: '어디에서 출발하나요?',
          clarification: {
            kind: 'needs_input',
            question: '어디에서 출발하나요?',
            required_field: 'lookup_origin',
          },
          origin_options: options,
        },
        [],
      ]
    }
    if (text.includes('얼마나') && !c.conditions.origin) {
      const target = ref ?? c.references?.at(-1)?.ref_id ?? null
      return [
        {
          ...base(c, run),
          kind: 'clarification',
          status: 'waiting_input',
          answer: '어디에서 출발하나요?',
          clarification: {
            kind: 'needs_input',
            question: '어디에서 출발하나요?',
            required_field: 'lookup_origin',
          },
        },
        [],
        {
          clarification_id: uuid(),
          prompt: '어디에서 출발하나요?',
          required_field: 'lookup_origin',
          scope: 'lookup',
          expected_answer_type: 'choice',
          choices: [STATION, TERMINAL].map((location, i) => ({
            key: `origin-${i + 1}`,
            label: location.label,
            description: location.address,
            target_ref: target,
            decision: { kind: 'origin', location, target_ref: target },
          })),
        },
      ]
    }
    if (/검색|찾아줘/.test(text)) {
      const collection = uuid()
      const t = now()
      const places: PlaceReference[] = SPOTS.강남.map(([name, lat, lng], i) => ({
        ref_id: `collection:${collection}:${i + 1}`,
        collection_id: collection,
        result_id: null,
        position: i + 1,
        place: found(name, lat, lng, t),
      }))
      c.references = [...(c.references ?? []), ...places].slice(-30)
      return [
        {
          ...base(c, run),
          kind: 'answer',
          status: 'succeeded',
          answer: '검색 결과 3곳이에요.',
          lookup: { outcome: 'ok', items: [], places, has_more: true, reason_code: null },
        },
        [],
      ]
    }
    if (/추천|카페|셋|명/.test(text)) {
      const response = recommend(c, run, text)
      return [response, response.continuation?.status === 'failed' ? ['lookup'] : []]
    }
    return [
      {
        ...base(c, run),
        kind: 'clarification',
        status: 'waiting_input',
        answer: '무엇을 하고 싶으세요?',
        clarification: {
          kind: 'needs_input',
          question: '무엇을 하고 싶으세요?',
          required_field: 'purposes',
        },
      },
      [],
      {
        clarification_id: uuid(),
        prompt: '무엇을 하고 싶으세요?',
        required_field: 'purposes',
        scope: 'persistent',
        expected_answer_type: 'choice',
        choices: (Object.keys(PURPOSE_LABELS) as Purpose[]).map((purpose) => ({
          key: purpose,
          label: PURPOSE_LABELS[purpose],
          description: null,
          target_ref: null,
          decision: { kind: 'purpose', purpose },
        })),
      },
    ]
  }

  function advance(c: MockConversation, run: MockRun) {
    if (run.view.status === 'finished') return
    if (run.view.cancel_requested_at) {
      finish(c, run, {
        ...base(c, run),
        kind: 'failure',
        status: 'cancelled',
        answer: '요청을 중단했어요. 변경은 반영하지 않았어요.',
        error: {
          code: 'CANCELLED',
          safe_message: '요청을 중단했어요. 변경은 반영하지 않았어요.',
          retryable: false,
        },
      })
      return
    }
    const next = run.stages.shift()
    if (next) {
      run.view.status = 'running'
      run.view.stage = next
      event(run, 'stage_started', { stage: next })
      return
    }
    const [response, retry, question] = respond(c, run)
    finish(c, run, response, retry, question)
  }

  function admit(c: MockConversation, body: RunRequest, decision: Decision | null, text: string) {
    const runId = uuid()
    c.sequence += 1
    const first = decision ? 'applying_action' : 'interpreting'
    const run: MockRun = {
      view: {
        identity: {
          conversation_id: c.conversation_id,
          trip_id: c.trip_id,
          run_id: runId,
          request_id: body.request_id,
        },
        state_version: c.state_version,
        status: 'running',
        response: null,
        stage: first,
        event_seq: 0,
        cancel_requested_at: null,
        retryable_tasks: [],
      },
      stages: Array.from(
        { length: Math.max(0, steps - 1) },
        (_, i) => ['searching', 'recommending', 'saving'][Math.min(i, 2)],
      ),
      events: [],
      request: structuredClone(body),
      sequence: c.sequence,
      created_at: iso(now()),
      message: {
        message_id: uuid(),
        input_type: body.input.type,
        text,
        source_run_id: body.input.type === 'retry' ? body.input.source_run_id : null,
      },
      assistant_message_id: uuid(),
      decision,
    }
    event(run, 'run_accepted', {})
    event(run, 'stage_started', { stage: first })
    runs.set(runId, run)
    byRequest.set(body.request_id, runId)
    c.active_run_id = runId
    return run
  }

  return {
    conversations,
    runs,
    actions,
    dropNext(count = 1) {
      drop = count
    },
    async createSession() {
      const id = uuid()
      const token = uuid().replaceAll('-', '')
      const expires = now() + 24 * 3600 * 1000
      sessions.set(id, { token, expires })
      return { session_id: id, session_token: `${id}.${token}`, expires_at: iso(expires) }
    },
    async createConversation(token) {
      const session = auth(token)
      const id = uuid()
      const conversation: MockConversation = {
        session,
        conversation_id: id,
        trip_id: uuid(),
        condition_version: 0,
        state_version: 0,
        conditions: emptyConditions(),
        pending_question: null,
        active_run_id: null,
        expires_at: iso(sessions.get(session)!.expires),
        search_area: null,
        references: [],
        pending_read: null,
        pending: [],
        sequence: 0,
      }
      conversations.set(id, conversation)
      return snapshotOf(conversation, true)
    },
    async getConversation(token, id) {
      return snapshotOf(owned(token, id), true)
    },
    async getMessages(token, id, { limit = 20, cursor = null } = {}) {
      const c = owned(token, id)
      const all = [...runs.values()]
        .filter((r) => r.view.identity.conversation_id === id)
        .sort((a, b) => a.sequence - b.sequence)
      const position = cursor ? decodeCursor(cursor) : { snapshot: c.sequence, before: Infinity }
      // Requests after the first page's snapshot never slip into older pages.
      const eligible = all.filter(
        (r) => r.sequence <= position.snapshot && r.sequence < position.before,
      )
      const page = eligible.slice(-limit)
      const items: HistoryTurn[] = page.map((r) => ({
        sequence: r.sequence,
        created_at: r.created_at,
        user_message: structuredClone(r.message),
        assistant_message_id: r.assistant_message_id,
        run: viewOf(c, r),
      }))
      return {
        conversation_id: id,
        state_version: c.state_version,
        snapshot_sequence: position.snapshot,
        items,
        next_cursor:
          eligible.length > page.length ? encodeCursor(position.snapshot, page[0].sequence) : null,
        active_run_id: c.active_run_id,
      }
    },
    async submitRun(token, id, body) {
      const c = owned(token, id)
      const prior = byRequest.get(body.request_id)
      if (prior) {
        const run = runs.get(prior)!
        if (
          JSON.stringify(run.request) !== JSON.stringify(body) &&
          run.request.request_id === body.request_id
        )
          throw new ChatError('conflict', 409, 'REQUEST_ID_CONFLICT')
        return { run: viewOf(c, run), status_url: `/runs/${prior}` }
      }
      let text: string
      if (body.input.type === 'action') {
        if (body.viewed_context) throw new ChatError('invalid', 422, 'VALIDATION')
        const action = actions.get(body.input.action_id)
        if (!action || action.conversation_id !== id)
          throw new ChatError('not_found', 404, 'NOT_FOUND')
        if (action.consumed_by) {
          // A used choice returns the ORIGINAL run, whatever request ID was sent now.
          byRequest.set(body.request_id, action.consumed_by)
          return {
            run: viewOf(c, runs.get(action.consumed_by)!),
            status_url: `/runs/${action.consumed_by}`,
          }
        }
        if (c.active_run_id) throw new ChatError('run_active', 409, 'RUN_ACTIVE')
        if (action.expires <= now()) throw new ChatError('action_expired', 410, 'ACTION_EXPIRED')
        if (
          action.condition_version !== c.condition_version ||
          action.state_version !== c.state_version ||
          body.expected_condition_version !== action.condition_version ||
          body.expected_state_version !== action.state_version ||
          !c.pending.includes(action.clarification_id)
        )
          throw new ChatError('action_stale', 409, 'ACTION_STALE')
        const def = questions.get(action.clarification_id)!
        const choice = def.choices.find((ch) => ch.key === action.key)!
        resolve(c, action.clarification_id)
        const run = admit(c, body, choice.decision, choice.label)
        action.consumed_by = run.view.identity.run_id
        return finishSubmit(run)
      }
      if (c.active_run_id) throw new ChatError('run_active', 409, 'RUN_ACTIVE')
      if (body.input.type === 'message') {
        if (!body.input.text.trim()) throw new ChatError('invalid', 422, 'VALIDATION')
        const reply = body.input.reply_to_clarification_id
        if (reply && !c.pending.includes(reply))
          throw new ChatError('conflict', 409, 'VERSION_CONFLICT')
        if (reply) resolve(c, reply)
        text = body.input.text
      } else text = '실패 작업 재시도'
      return finishSubmit(admit(c, body, null, text))

      function finishSubmit(run: MockRun) {
        if (drop > 0) {
          drop -= 1
          throw new ChatError('uncertain', 0, null)
        }
        return {
          run: viewOf(c, run),
          status_url: `/api/v2/chat/runs/${run.view.identity.run_id}`,
        }
      }
    },
    async getRun(token, runId, afterSeq) {
      const run = runs.get(runId)
      if (!run) throw new ChatError('not_found', 404, 'NOT_FOUND')
      const c = owned(token, run.view.identity.conversation_id)
      advance(c, run)
      return {
        run: viewOf(c, run),
        events: structuredClone(run.events.filter((e) => e.event_seq > afterSeq)),
      }
    },
    async cancelRun(token, runId) {
      const run = runs.get(runId)
      if (!run) throw new ChatError('not_found', 404, 'NOT_FOUND')
      const c = owned(token, run.view.identity.conversation_id)
      if (run.view.status !== 'finished' && !run.view.cancel_requested_at) {
        run.view.cancel_requested_at = iso(now())
        event(run, 'cancellation_requested', {})
      }
      return viewOf(c, run)
    },
    async deleteConversation(token, id) {
      const c = owned(token, id)
      c.deleted = true
    },
  }
}
