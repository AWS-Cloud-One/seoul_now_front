import { isChatError, newRequestId, type ChatClient, type ChatErrorKind } from '../api/client'
import type {
  ActionView,
  ConversationSnapshot,
  ExecutionView,
  HistoryTurn,
  PlaceReference,
  QuestionView,
  RetryTask,
  RunEvent,
  RunRequest,
  ViewedContext,
} from '../api/types'
import { retryLabel } from '../model/labels'
import { emptyStored, type ChatStorage, type StoredChat } from './storage'

/**
 * Turn lifecycle as the user sees it:
 * sending → (accepted) tracking → finished, or
 * sending → unconfirmed (no response; resend the same request ID/body to confirm), or
 * sending → rejected (the server refused; nothing was stored, the text goes back to the draft).
 */
export type TurnPhase = 'sending' | 'unconfirmed' | 'rejected' | 'tracking' | 'finished'
export type Problem = { kind: ChatErrorKind | 'poll' | 'cancel'; message: string }

export type Turn = {
  /** The request ID (server history uses the same value), or `external:<run>` until known. */
  key: string
  source: 'local' | 'history' | 'external'
  input: 'message' | 'retry' | 'action'
  text: string | null
  /** What the request pointed at (a card, a question, a retried task), shown under the text. */
  label: string | null
  body: RunRequest | null
  phase: TurnPhase
  run: ExecutionView | null
  events: RunEvent[]
  lastSeq: number
  problem: Problem | null
  cancelling: boolean
  /** Server message ID/sequence/time, when the turn came from the messages API. */
  messageId: string | null
  createdAt: string | null
}

export type BootState = 'loading' | 'ready' | 'expired' | 'unauthorized' | 'error'

export type HistoryState = {
  /** Server cursor for the page before the oldest loaded one; sent back untouched. */
  cursor: string | null
  loading: boolean
  failed: boolean
}

export type ChatState = {
  boot: BootState
  snapshot: ConversationSnapshot | null
  turns: Turn[]
  notice: string | null
  /** Every place reference seen in this tab, so older cards keep their names and targets. */
  refs: Record<string, PlaceReference>
  history: HistoryState
  /** A run to bring into view (e.g. the result of an already-used choice). */
  focusRunId: string | null
  busyAction: 'new' | 'delete' | null
  composer: Composer
}

/** The draft survives tab switches and running requests; only an accepted send clears it. */
export type Composer = {
  text: string
  target: SendOptions['target']
  /** An explicit reply; when null the open question is attached unless the user dismissed it. */
  reply: SendOptions['replyTo']
  dismissedQuestion: string | null
}
const emptyComposer = (): Composer => ({
  text: '',
  target: null,
  reply: null,
  dismissedQuestion: null,
})
const emptyHistory = (): HistoryState => ({ cursor: null, loading: false, failed: false })

export type SendOptions = {
  replyTo?: { clarificationId: string; question: string } | null
  target?: { context: ViewedContext; label: string } | null
}
export type SendOutcome = 'accepted' | 'unconfirmed' | 'rejected' | 'blocked'

const REJECT_MESSAGES: Partial<Record<ChatErrorKind, string>> = {
  run_active: '이미 처리 중인 요청이 있어 보내지 않았어요. 진행 중인 요청을 먼저 확인할게요.',
  conflict: '대화 상태가 바뀌어 보내지 않았어요. 최신 상태를 확인한 뒤 다시 보내 주세요.',
  rate_limited: '요청이 많아 보내지 않았어요. 잠시 뒤 다시 보내 주세요.',
  invalid: '보낼 수 없는 입력이에요. 공백이 아닌 2,000자 이내로 입력해 주세요.',
  not_found: '이 대화나 선택한 대상에 접근할 수 없어 보내지 않았어요.',
  expired: '대화가 만료되어 보내지 않았어요.',
  unauthorized: '세션을 확인할 수 없어 보내지 않았어요.',
}
/** A refused choice is not a message: the turn is dropped and the question is re-read. */
const ACTION_NOTICES: Partial<Record<ChatErrorKind, string>> = {
  action_expired: '선택지 유효 시간이 지나 새 선택지를 불러왔어요. 다시 골라 주세요.',
  action_stale: '대화 상태가 바뀌어 그 선택지는 쓸 수 없어요. 최신 질문을 확인해 주세요.',
  run_active:
    '다른 요청을 처리하는 중이라 선택을 보내지 않았어요. 진행 중인 요청을 먼저 확인할게요.',
}
const UNCONFIRMED =
  '전송 결과를 확인하지 못했어요. 같은 요청으로 저장 여부를 다시 확인할 수 있어요.'
const PAGE_SIZE = 20

export type ControllerOptions = {
  client: ChatClient
  storage: ChatStorage
  now?: () => number
  isVisible?: () => boolean
  intervals?: { visible: number; hidden: number; max: number; first: number }
}

const sameTurn = (key: string) => (turn: Turn) => turn.key === key

export class ChatController {
  private state: ChatState = {
    boot: 'loading',
    snapshot: null,
    turns: [],
    notice: null,
    refs: {},
    history: emptyHistory(),
    focusRunId: null,
    busyAction: null,
    composer: emptyComposer(),
  }
  private booted = false
  private listeners = new Set<() => void>()
  private token: string | null = null
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inflight = new Set<string>()
  private failures = new Map<string, number>()
  private generation = 0
  private disposed = false
  private readonly client: ChatClient
  private readonly storage: ChatStorage
  private readonly now: () => number
  private readonly isVisible: () => boolean
  private readonly intervals: { visible: number; hidden: number; max: number; first: number }

  constructor(options: ControllerOptions) {
    this.client = options.client
    this.storage = options.storage
    this.now = options.now ?? Date.now
    this.isVisible =
      options.isVisible ?? (() => typeof document === 'undefined' || !document.hidden)
    this.intervals = options.intervals ?? { visible: 2000, hidden: 5000, max: 15000, first: 600 }
  }

  // ---- external store -------------------------------------------------------------------
  get storageKey() {
    return this.storage.key
  }
  getState = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private set(patch: Partial<ChatState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private patchTurn(key: string, patch: Partial<Turn> | ((turn: Turn) => Partial<Turn>)) {
    this.set({
      turns: this.state.turns.map((turn) =>
        turn.key === key
          ? { ...turn, ...(typeof patch === 'function' ? patch(turn) : patch) }
          : turn,
      ),
    })
  }
  private dropTurn(key: string) {
    this.set({ turns: this.state.turns.filter((turn) => turn.key !== key) })
  }
  private update(fn: (stored: StoredChat) => StoredChat) {
    // Reload first so a second tab's changes are merged instead of overwritten.
    this.storage.save(fn(this.storage.load()))
  }

  /** One request at a time per conversation; the draft stays editable meanwhile. */
  get busy() {
    return this.state.turns.some(
      (turn) =>
        turn.phase === 'sending' || turn.phase === 'unconfirmed' || turn.phase === 'tracking',
    )
  }
  get canSend() {
    return (
      this.state.boot === 'ready' && !!this.state.snapshot && !this.busy && !this.state.busyAction
    )
  }
  /** A choice is usable only while the server says so and before its own expiry. */
  actionUsable(action: ActionView) {
    return action.status === 'available' && !this.expired(action.expires_at)
  }

  // ---- boot / restore -------------------------------------------------------------------
  /** Boot once; later mounts (tab switches) only re-check the server state. */
  start = () => {
    this.disposed = false
    if (!this.booted) {
      this.booted = true
      void this.boot()
    } else this.onVisible()
  }

  /** Stop timers (tests/unmounted app). start() can resume afterwards. */
  dispose() {
    this.disposed = true
    this.booted = false
    this.stopAll()
  }

  setComposer = (patch: Partial<Composer>) =>
    this.set({ composer: { ...this.state.composer, ...patch } })

  /** Send the draft with its visible target/reply chips; a refused send restores the draft. */
  sendComposer = async (reply: SendOptions['replyTo']) => {
    const { text, target } = this.state.composer
    if (!text.trim() || !this.canSend) return 'blocked' as const
    this.setComposer({ text: '', target: null, reply: null })
    const outcome = await this.send(text, { target, replyTo: reply })
    if (outcome === 'rejected' || outcome === 'blocked') {
      const now = this.state.composer
      if (!now.text.trim()) this.setComposer({ text, target: now.target ?? target })
    }
    return outcome
  }

  private stopAll() {
    this.generation += 1
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    this.inflight.clear()
    this.failures.clear()
  }

  private expired(iso: string | null | undefined) {
    const at = Date.parse(iso || '')
    return !Number.isFinite(at) || at <= this.now()
  }

  async boot(notice: string | null = null) {
    this.stopAll()
    const generation = this.generation
    this.set({
      boot: 'loading',
      notice,
      turns: [],
      snapshot: null,
      refs: {},
      history: emptyHistory(),
      focusRunId: null,
      // Targets and replies belong to the previous conversation; the typed text is kept.
      composer: { ...emptyComposer(), text: this.state.composer.text },
    })
    const notes: string[] = notice ? [notice] : []
    try {
      let stored = this.storage.load()
      if (!stored.session || this.expired(stored.session.expires_at)) {
        if (stored.session) notes.push('이전 대화가 만료되어 새 대화를 시작했어요.')
        stored = { ...emptyStored(), session: await this.createSession() }
      }
      this.token = stored.session!.token
      let snapshot: ConversationSnapshot | null = null
      if (stored.conversation_id) {
        try {
          snapshot = await this.client.getConversation(this.token, stored.conversation_id)
        } catch (error) {
          const kind = isChatError(error) ? error.kind : null
          if (kind === 'unauthorized') {
            notes.push('세션을 확인할 수 없어 새로 시작했어요.')
            stored = { ...emptyStored(), session: await this.createSession() }
            this.token = stored.session!.token
          } else if (kind === 'not_found' || kind === 'expired') {
            notes.push(
              kind === 'expired'
                ? '이전 대화가 만료되어 새 대화를 시작했어요.'
                : '이전 대화를 찾을 수 없어 새 대화를 시작했어요.',
            )
          } else throw error
          stored = { ...stored, conversation_id: null, pending: null }
        }
      }
      const fresh = !snapshot
      if (!snapshot) {
        snapshot = await this.client.createConversation(this.token)
        stored = { ...stored, conversation_id: snapshot.conversation_id, pending: null }
      }
      if (generation !== this.generation) return
      this.storage.save(stored)
      this.set({
        boot: 'ready',
        snapshot,
        refs: indexRefs({}, snapshot.references),
        notice: notes.join(' ') || null,
      })
      if (!fresh) await this.restore(stored, generation)
    } catch {
      if (generation !== this.generation) return
      this.set({
        boot: 'error',
        notice: '대화를 시작하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',
      })
    }
  }

  private async createSession() {
    const created = await this.client.createSession()
    return { token: created.session_token, expires_at: created.expires_at }
  }

  /** Rebuild the timeline from the server's messages API (latest page), then confirm pending. */
  private async restore(stored: StoredChat, generation: number) {
    await this.loadHistory(generation)
    if (generation !== this.generation) return
    const pending = stored.pending
    if (pending && pending.conversation_id === stored.conversation_id) {
      if (this.state.turns.some(sameTurn(pending.body.request_id))) {
        // The server already has it: history shows the stored run, nothing to resend.
        this.update((s) => ({ ...s, pending: null }))
      } else {
        // Same request ID and body: the server returns the stored run instead of running twice.
        this.set({
          turns: [
            ...this.state.turns,
            blankTurn(pending.body.request_id, {
              source: 'local',
              input: pending.body.input.type,
              text: pending.text,
              label: pending.label ?? null,
              body: pending.body,
              phase: 'unconfirmed',
            }),
          ],
        })
        await this.transmit(pending.body.request_id)
      }
    }
    if (generation === this.generation && this.state.snapshot)
      this.adoptActiveRun(this.state.snapshot.active_run_id)
  }

  /** Latest page (no cursor). Also used as "다시 불러오기" after a failed restore. */
  loadHistory = async (generation = this.generation) => {
    const snapshot = this.state.snapshot
    if (!snapshot || !this.token) return
    this.set({ history: { ...this.state.history, loading: true, failed: false } })
    try {
      const page = await this.client.getMessages(this.token, snapshot.conversation_id, {
        limit: PAGE_SIZE,
      })
      if (generation !== this.generation) return
      const restored = page.items.map(historyTurn)
      const known = new Set(restored.map((turn) => turn.run?.identity.run_id))
      this.set({
        // Server items first (fixed order), then local turns the page does not include yet.
        turns: [
          ...restored,
          ...this.state.turns.filter((t) => !t.run || !known.has(t.run.identity.run_id)),
        ],
        history: { cursor: page.next_cursor, loading: false, failed: false },
      })
      this.indexRuns(restored)
      for (const turn of restored)
        if (turn.phase === 'tracking' && turn.run) this.schedule(turn.run.identity.run_id)
      this.adoptActiveRun(page.active_run_id)
    } catch (error) {
      if (generation !== this.generation || this.handleSessionError(error)) return
      this.set({ history: { ...this.state.history, loading: false, failed: true } })
    }
  }

  /** Older page: prepended, de-duplicated by the server's run/message IDs. */
  loadOlder = async () => {
    const { cursor, loading } = this.state.history
    const snapshot = this.state.snapshot
    if (!cursor || loading || !snapshot || !this.token) return
    const generation = this.generation
    this.set({ history: { ...this.state.history, loading: true, failed: false } })
    try {
      const page = await this.client.getMessages(this.token, snapshot.conversation_id, {
        limit: PAGE_SIZE,
        cursor,
      })
      if (generation !== this.generation) return
      const runs = new Set(this.state.turns.map((t) => t.run?.identity.run_id).filter(Boolean))
      const messages = new Set(this.state.turns.map((t) => t.messageId).filter(Boolean))
      const older = page.items
        .map(historyTurn)
        .filter((t) => !runs.has(t.run!.identity.run_id) && !messages.has(t.messageId))
      this.set({
        turns: [...older, ...this.state.turns],
        history: { cursor: page.next_cursor, loading: false, failed: false },
      })
      this.indexRuns(older)
    } catch (error) {
      if (generation !== this.generation || this.handleSessionError(error)) return
      this.set({ history: { ...this.state.history, loading: false, failed: true } })
    }
  }

  private indexRuns(turns: Turn[]) {
    const lists = turns.flatMap((t) => [
      t.run?.response?.lookup?.places,
      t.run?.response?.continuation?.lookup?.places,
    ])
    if (lists.some((list) => list?.length))
      this.set({ refs: lists.reduce((refs, list) => indexRefs(refs, list), this.state.refs) })
  }

  // ---- conversation snapshot --------------------------------------------------------------
  /** Re-read the conversation; this is also what re-issues expired/stale choices. */
  refreshConversation = async () => {
    const current = this.state.snapshot
    if (!current || !this.token || this.state.boot !== 'ready') return
    try {
      const next = await this.client.getConversation(this.token, current.conversation_id)
      this.acceptSnapshot(next)
    } catch (error) {
      this.handleSessionError(error)
    }
  }

  private acceptSnapshot(next: ConversationSnapshot) {
    const current = this.state.snapshot
    if (!current || next.conversation_id !== current.conversation_id) return
    // A late response must not roll the current conditions back to an older state.
    if (next.state_version < current.state_version) return
    this.set({ snapshot: next, refs: indexRefs(this.state.refs, next.references) })
    this.adoptActiveRun(next.active_run_id)
  }

  /** Attach a run started elsewhere (another tab, or before a reload) instead of sending again. */
  private adoptActiveRun(runId: string | null | undefined) {
    if (!runId) return
    this.showRun(runId, false)
  }

  /**
   * Bring a run into the timeline: focus it if it is already shown, otherwise attach and poll it
   * (e.g. the result of a choice that was already used).
   */
  showRun = (runId: string, focus = true) => {
    if (this.state.turns.some((turn) => turn.run?.identity.run_id === runId)) {
      if (focus) this.set({ focusRunId: runId })
      return
    }
    const key = `external:${runId}`
    if (!this.state.turns.some(sameTurn(key)))
      this.set({
        turns: [
          ...this.state.turns,
          blankTurn(key, { source: 'external', input: 'message', text: null, phase: 'tracking' }),
        ],
        ...(focus ? { focusRunId: runId } : {}),
      })
    this.pollSoon(runId, key)
  }
  clearFocus = () => this.set({ focusRunId: null })

  private handleSessionError(error: unknown) {
    if (!isChatError(error)) return false
    if (error.kind === 'expired') {
      this.stopAll()
      this.set({ boot: 'expired', notice: '대화가 만료됐어요. 새 대화를 시작해 주세요.' })
      return true
    }
    if (error.kind === 'unauthorized') {
      this.stopAll()
      this.set({
        boot: 'unauthorized',
        notice: '세션을 확인할 수 없어요. 새로 시작하면 새 익명 세션으로 대화해요.',
      })
      return true
    }
    return false
  }

  // ---- runs --------------------------------------------------------------------------------
  private applyRun(key: string, run: ExecutionView, events: RunEvent[], refresh = true) {
    this.patchTurn(key, (turn) => {
      const seen = new Set(turn.events.map((event) => event.event_seq))
      const merged = [...turn.events, ...events.filter((event) => !seen.has(event.event_seq))].sort(
        (a, b) => a.event_seq - b.event_seq,
      )
      return {
        run,
        events: merged,
        lastSeq: merged.length ? merged[merged.length - 1].event_seq : turn.lastSeq,
        phase: run.status === 'finished' ? 'finished' : 'tracking',
        problem: turn.problem?.kind === 'poll' ? null : turn.problem,
      }
    })
    const turn = this.state.turns.find(sameTurn(key))
    if (turn) this.indexRuns([turn])
    if (refresh && run.status === 'finished') void this.refreshConversation()
  }

  private keyForRun(runId: string) {
    return this.state.turns.find((turn) => turn.run?.identity.run_id === runId)?.key
  }

  private pollSoon(runId: string, key?: string) {
    const existing = this.timers.get(runId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      runId,
      setTimeout(() => void this.poll(runId, key), this.intervals.first),
    )
  }

  private schedule(runId: string) {
    if (this.disposed || this.timers.has(runId)) return
    const failures = this.failures.get(runId) ?? 0
    const base = this.isVisible() ? this.intervals.visible : this.intervals.hidden
    const delay = failures ? Math.min(this.intervals.max, base * 2 ** failures) : base
    this.timers.set(
      runId,
      setTimeout(() => void this.poll(runId), delay),
    )
  }

  private async poll(runId: string, keyHint?: string) {
    this.timers.delete(runId)
    if (this.disposed || this.inflight.has(runId) || !this.token) return
    const generation = this.generation
    const key = this.keyForRun(runId) ?? keyHint
    if (!key) return
    const turn = this.state.turns.find(sameTurn(key))
    if (!turn) return
    this.inflight.add(runId)
    try {
      const polled = await this.client.getRun(this.token, runId, turn.lastSeq)
      if (generation !== this.generation) return
      this.failures.delete(runId)
      this.applyRun(key, polled.run, polled.events)
      if (polled.run.status !== 'finished') this.schedule(runId)
    } catch (error) {
      if (generation !== this.generation) return
      if (this.handleSessionError(error)) return
      if (isChatError(error) && error.kind === 'not_found') {
        this.patchTurn(key, {
          phase: 'finished',
          problem: { kind: 'not_found', message: '이 요청을 현재 세션에서 확인할 수 없어요.' },
        })
        return
      }
      this.failures.set(runId, (this.failures.get(runId) ?? 0) + 1)
      this.patchTurn(key, {
        problem: { kind: 'poll', message: '진행 상황을 확인하지 못했어요. 잠시 뒤 다시 확인해요.' },
      })
      this.schedule(runId)
    } finally {
      this.inflight.delete(runId)
    }
  }

  /** Re-read one run now (e.g. "반영 여부 다시 확인"); never re-executes it. */
  recheck = (key: string) => {
    const runId = this.state.turns.find(sameTurn(key))?.run?.identity.run_id
    if (runId) {
      const timer = this.timers.get(runId)
      if (timer) clearTimeout(timer)
      this.timers.delete(runId)
      void this.poll(runId)
    }
  }

  onVisible = () => {
    if (this.state.boot !== 'ready') return
    void this.refreshConversation()
    this.state.turns.forEach((turn) => {
      const runId = turn.run?.identity.run_id
      if (runId && turn.phase === 'tracking') {
        const timer = this.timers.get(runId)
        if (timer) clearTimeout(timer)
        this.timers.delete(runId)
        void this.poll(runId)
      }
    })
  }

  // ---- sending -----------------------------------------------------------------------------
  private guardExpiry() {
    if (this.expired(this.state.snapshot?.expires_at)) {
      this.set({ boot: 'expired', notice: '대화가 만료됐어요. 새 대화를 시작해 주세요.' })
      return true
    }
    return false
  }

  send = async (text: string, options: SendOptions = {}): Promise<SendOutcome> => {
    const snapshot = this.state.snapshot
    const value = text.trim()
    if (!value || !snapshot || !this.canSend || this.guardExpiry()) return 'blocked'
    const body: RunRequest = {
      schema_version: 2,
      request_id: newRequestId(),
      // The versions the user saw; a conflict is reported, never "fixed" by bumping them.
      expected_condition_version: snapshot.condition_version,
      expected_state_version: snapshot.state_version,
      input: {
        type: 'message',
        text: value,
        ...(options.replyTo ? { reply_to_clarification_id: options.replyTo.clarificationId } : {}),
      },
      viewed_context: options.target?.context ?? null,
    }
    const label = options.target
      ? options.target.label
      : options.replyTo
        ? `답변 · ${options.replyTo.question}`
        : null
    return this.submit(body, value, label)
  }

  /**
   * Run a server-issued choice: only its ID, with the versions stored on the choice.
   * No label, arguments or viewed_context are sent; the server owns the meaning.
   */
  choose = async (action: ActionView, question: QuestionView): Promise<SendOutcome> => {
    if (action.status === 'consumed' && action.consumed_by_run_id) {
      this.showRun(action.consumed_by_run_id)
      return 'blocked'
    }
    if (!this.state.snapshot || !this.canSend || this.guardExpiry()) return 'blocked'
    if (!this.actionUsable(action)) {
      // Expired/stale/busy: re-read the conversation to get the current choices. Never auto-click.
      await this.refreshConversation()
      return 'blocked'
    }
    const body: RunRequest = {
      schema_version: 2,
      request_id: newRequestId(),
      expected_condition_version: action.expected_condition_version,
      expected_state_version: action.expected_state_version,
      input: { type: 'action', action_id: action.action_id },
    }
    return this.submit(body, action.label, `선택 · ${question.prompt}`)
  }

  retry = async (key: string, task: RetryTask): Promise<SendOutcome> => {
    const snapshot = this.state.snapshot
    const source = this.state.turns.find(sameTurn(key))?.run
    if (!snapshot || !source || !this.canSend || this.guardExpiry()) return 'blocked'
    if (source.status !== 'finished' || !source.retryable_tasks.includes(task)) return 'blocked'
    const body: RunRequest = {
      schema_version: 2,
      request_id: newRequestId(),
      expected_condition_version: snapshot.condition_version,
      expected_state_version: snapshot.state_version,
      input: { type: 'retry', source_run_id: source.identity.run_id, task_ids: [task] },
    }
    return this.submit(body, null, retryLabel(task))
  }

  private async submit(body: RunRequest, text: string | null, label: string | null) {
    const conversationId = this.state.snapshot!.conversation_id
    this.set({
      turns: [
        ...this.state.turns,
        blankTurn(body.request_id, {
          source: 'local',
          input: body.input.type,
          text,
          label,
          body,
          phase: 'sending',
        }),
      ],
    })
    this.update((s) => ({ ...s, pending: { conversation_id: conversationId, body, text, label } }))
    return this.transmit(body.request_id)
  }

  /** Send (or resend unchanged) a turn's stored body. */
  private async transmit(key: string): Promise<SendOutcome> {
    const turn = this.state.turns.find(sameTurn(key))
    const snapshot = this.state.snapshot
    if (!turn?.body || !snapshot || !this.token) return 'blocked'
    const generation = this.generation
    const isAction = turn.body.input.type === 'action'
    this.patchTurn(key, { phase: 'sending', problem: null })
    try {
      const { run } = await this.client.submitRun(this.token, snapshot.conversation_id, turn.body)
      if (generation !== this.generation) return 'blocked'
      this.update((s) => ({ ...s, pending: null }))
      // An already-used choice returns the ORIGINAL run (its own request ID): show that one.
      const original = this.state.turns.find(
        (t) => t.key !== key && t.run?.identity.run_id === run.identity.run_id,
      )
      if (original) {
        this.dropTurn(key)
        this.set({
          focusRunId: run.identity.run_id,
          notice: '이미 선택한 항목이라 그때 결과를 보여드려요.',
        })
        this.applyRun(original.key, run, [])
        if (run.status !== 'finished') this.pollSoon(run.identity.run_id, original.key)
        return 'accepted'
      }
      this.applyRun(key, run, [])
      if (run.status !== 'finished') this.pollSoon(run.identity.run_id, key)
      return 'accepted'
    } catch (error) {
      if (generation !== this.generation) return 'blocked'
      const kind: ChatErrorKind = isChatError(error) ? error.kind : 'unknown'
      if (kind === 'uncertain' || kind === 'unknown') {
        this.patchTurn(key, { phase: 'unconfirmed', problem: { kind, message: UNCONFIRMED } })
        return 'unconfirmed'
      }
      this.update((s) => ({ ...s, pending: null }))
      if (isAction && ACTION_NOTICES[kind]) {
        this.dropTurn(key)
        this.set({ notice: ACTION_NOTICES[kind]! })
        await this.refreshConversation()
        return 'rejected'
      }
      this.patchTurn(key, {
        phase: 'rejected',
        problem: { kind, message: REJECT_MESSAGES[kind] ?? '보내지 못했어요.' },
      })
      if (!this.handleSessionError(error) && (kind === 'run_active' || kind === 'conflict'))
        await this.refreshConversation()
      return 'rejected'
    }
  }

  confirm = (key: string) => {
    const turn = this.state.turns.find(sameTurn(key))
    if (turn?.phase === 'unconfirmed') void this.transmit(key)
  }

  /** Ask the server to stop; AbortController would only stop this tab from listening. */
  cancel = async (key: string) => {
    const turn = this.state.turns.find(sameTurn(key))
    const run = turn?.run
    if (!turn || !run || !this.token) return
    if (turn.cancelling || run.cancel_requested_at || run.status === 'finished') return
    this.patchTurn(key, { cancelling: true, problem: null })
    try {
      const view = await this.client.cancelRun(this.token, run.identity.run_id, newRequestId())
      this.applyRun(key, view, [])
      if (view.status !== 'finished') this.pollSoon(view.identity.run_id, key)
    } catch (error) {
      if (!this.handleSessionError(error))
        this.patchTurn(key, {
          problem: { kind: 'cancel', message: '중단 요청을 보내지 못했어요. 다시 눌러 주세요.' },
        })
    } finally {
      this.patchTurn(key, { cancelling: false })
    }
  }

  // ---- conversation lifecycle -----------------------------------------------------------
  /** Start another conversation in the same anonymous session; the old one is kept as is. */
  newConversation = async () => {
    if (this.busy || this.state.busyAction) return
    this.set({ busyAction: 'new' })
    try {
      await this.replaceConversation(null)
    } finally {
      this.set({ busyAction: null })
    }
  }

  /** Delete the current conversation on the server, then open a fresh one. */
  deleteConversation = async () => {
    const snapshot = this.state.snapshot
    if (!snapshot || !this.token || this.busy || this.state.busyAction) return
    this.set({ busyAction: 'delete' })
    try {
      try {
        await this.client.deleteConversation(this.token, snapshot.conversation_id)
      } catch (error) {
        // Already gone or expired is the outcome the user asked for.
        if (!isChatError(error) || !['not_found', 'expired'].includes(error.kind)) {
          if (!this.handleSessionError(error))
            this.set({ notice: '대화를 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
          return
        }
      }
      await this.replaceConversation('대화를 삭제하고 새 대화를 시작했어요.')
    } finally {
      this.set({ busyAction: null })
    }
  }

  /** Recover from an expired/unauthorized/failed boot with a new session if needed. */
  restart = () => {
    if (this.state.boot === 'unauthorized')
      this.update((s) => ({ ...s, session: null, conversation_id: null, pending: null }))
    else this.update((s) => ({ ...s, conversation_id: null, pending: null }))
    void this.boot()
  }

  private async replaceConversation(notice: string | null) {
    this.stopAll()
    let stored = this.storage.load()
    try {
      if (!stored.session || this.expired(stored.session.expires_at))
        stored = { ...emptyStored(), session: await this.createSession() }
      this.token = stored.session!.token
      let snapshot: ConversationSnapshot
      try {
        snapshot = await this.client.createConversation(this.token)
      } catch (error) {
        if (!isChatError(error) || !['unauthorized', 'expired'].includes(error.kind)) throw error
        stored = { ...emptyStored(), session: await this.createSession() }
        this.token = stored.session!.token
        snapshot = await this.client.createConversation(this.token)
      }
      this.storage.save({ ...stored, conversation_id: snapshot.conversation_id, pending: null })
      this.set({
        boot: 'ready',
        snapshot,
        turns: [],
        refs: indexRefs({}, snapshot.references),
        history: emptyHistory(),
        focusRunId: null,
        notice,
        composer: emptyComposer(),
      })
    } catch {
      this.set({ notice: '새 대화를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
    }
  }

  /** Another tab switched this browser to a different conversation: follow it. */
  onStorageChange = () => {
    const stored = this.storage.load()
    const current = this.state.snapshot?.conversation_id
    if (stored.conversation_id && current && stored.conversation_id !== current)
      void this.boot('다른 화면에서 대화가 바뀌어 최신 대화를 불러왔어요.')
  }

  dismissNotice = () => this.set({ notice: null })
}

function blankTurn(
  key: string,
  fields: Pick<Turn, 'source' | 'input' | 'text' | 'phase'> & Partial<Turn>,
): Turn {
  return {
    key,
    label: null,
    body: null,
    run: null,
    events: [],
    lastSeq: 0,
    problem: null,
    cancelling: false,
    messageId: null,
    createdAt: null,
    ...fields,
  }
}

/** One server history item → one turn; IDs come from the server, never assembled here. */
function historyTurn(item: HistoryTurn): Turn {
  const input = item.user_message.input_type
  return blankTurn(item.run.identity.request_id, {
    source: 'history',
    input,
    text: input === 'retry' ? null : item.user_message.text,
    label: input === 'retry' ? item.user_message.text : null,
    phase: item.run.status === 'finished' ? 'finished' : 'tracking',
    run: item.run,
    lastSeq: 0,
    messageId: item.user_message.message_id,
    createdAt: item.created_at,
  })
}

function indexRefs(
  refs: Record<string, PlaceReference>,
  list: PlaceReference[] | null | undefined,
): Record<string, PlaceReference> {
  if (!list?.length) return refs
  const next = { ...refs }
  for (const ref of list) next[ref.ref_id] = ref
  return next
}
