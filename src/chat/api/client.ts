import { validRegionPayload } from './regions'
import type {
  ConversationSnapshot,
  ExecutionView,
  HistoryPage,
  RunPoll,
  RunRequest,
  SessionCreated,
  SubmitResult,
} from './types'

/**
 * How the screen should react, independent of the two error body shapes the V2 app returns:
 * storage rejections `{error:{code}}` and FastAPI validation/auth `{detail: ...}`.
 */
export type ChatErrorKind =
  | 'unauthorized' // 401
  | 'not_found' // 404
  | 'expired' // 410 conversation/session
  | 'action_expired' // 410 ACTION_EXPIRED: only the button expired
  | 'action_stale' // 409 ACTION_STALE: question/conditions moved on
  | 'run_active' // 409 RUN_ACTIVE
  | 'conflict' // other 409
  | 'rate_limited' // 429: rejected before admission
  | 'invalid' // 422
  | 'uncertain' // 503 / timeout / network: the request may or may not have been stored
  | 'unknown'

export class ChatError extends Error {
  readonly kind: ChatErrorKind
  readonly status: number
  readonly code: string | null
  constructor(kind: ChatErrorKind, status: number, code: string | null) {
    super(`chat v2 ${kind}${code ? ` (${code})` : ''}`)
    this.name = 'ChatError'
    this.kind = kind
    this.status = status
    this.code = code
  }
}

export const isChatError = (error: unknown): error is ChatError => error instanceof ChatError

/** One interface for the real and mock adapters, so the screen never knows which it talks to. */
export interface ChatClient {
  createSession(): Promise<SessionCreated>
  createConversation(token: string): Promise<ConversationSnapshot>
  getConversation(token: string, conversationId: string): Promise<ConversationSnapshot>
  /** Latest `limit` requests first; pass the server's `next_cursor` untouched for older pages. */
  getMessages(
    token: string,
    conversationId: string,
    page?: { limit?: number; cursor?: string | null },
  ): Promise<HistoryPage>
  submitRun(token: string, conversationId: string, body: RunRequest): Promise<SubmitResult>
  getRun(token: string, runId: string, afterSeq: number): Promise<RunPoll>
  cancelRun(token: string, runId: string, requestId: string): Promise<ExecutionView>
  deleteConversation(token: string, conversationId: string): Promise<void>
}

/** The server accepts after_seq 0..200; later events are de-duplicated locally by event_seq. */
export const MAX_AFTER_SEQ = 200

function errorFor(status: number, body: unknown): ChatError {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const nested = record.error as Record<string, unknown> | undefined
  const code =
    typeof nested?.code === 'string'
      ? nested.code
      : typeof record.detail === 'string'
        ? record.detail
        : null
  const kind: ChatErrorKind =
    status === 401
      ? 'unauthorized'
      : status === 404
        ? 'not_found'
        : status === 410
          ? code === 'ACTION_EXPIRED'
            ? 'action_expired'
            : 'expired'
          : status === 409
            ? code === 'RUN_ACTIVE'
              ? 'run_active'
              : code === 'ACTION_STALE'
                ? 'action_stale'
                : 'conflict'
            : status === 429
              ? 'rate_limited'
              : status === 422
                ? 'invalid'
                : status === 503 || status === 502 || status === 504
                  ? 'uncertain'
                  : 'unknown'
  return new ChatError(kind, status, code)
}

export function createChatClient({
  baseUrl = '/api/v2/chat',
  timeoutMs = 15000,
  fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
}: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): ChatClient {
  async function call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    { token, body }: { token?: string; body?: unknown } = {},
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          // The token never goes into the URL or logs; only this header carries it.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      // No response: the server may still have stored the request.
      throw new ChatError('uncertain', 0, null)
    } finally {
      clearTimeout(timer)
    }
    if (response.status === 204) return undefined as T
    const parsed: unknown = await response.json().catch(() => null)
    if (!response.ok) throw errorFor(response.status, parsed)
    if (parsed === null) throw new ChatError('unknown', response.status, 'EMPTY_BODY')
    if (!validRegionPayload(parsed))
      throw new ChatError('unknown', response.status, 'INVALID_REGION')
    return parsed as T
  }
  return {
    createSession: () => call('POST', '/sessions'),
    createConversation: (token) => call('POST', '/conversations', { token }),
    getConversation: (token, id) =>
      call('GET', `/conversations/${encodeURIComponent(id)}`, { token }),
    getMessages: (token, id, { limit = 20, cursor = null } = {}) => {
      const query = new URLSearchParams({ limit: String(limit) })
      if (cursor) query.set('cursor', cursor)
      return call('GET', `/conversations/${encodeURIComponent(id)}/messages?${query}`, { token })
    },
    submitRun: (token, id, body) =>
      call('POST', `/conversations/${encodeURIComponent(id)}/runs`, { token, body }),
    getRun: (token, runId, afterSeq) =>
      call(
        'GET',
        `/runs/${encodeURIComponent(runId)}?after_seq=${Math.max(0, Math.min(MAX_AFTER_SEQ, afterSeq))}`,
        { token },
      ),
    cancelRun: (token, runId, requestId) =>
      call('POST', `/runs/${encodeURIComponent(runId)}/cancel`, {
        token,
        body: { request_id: requestId },
      }),
    deleteConversation: (token, id) =>
      call('DELETE', `/conversations/${encodeURIComponent(id)}`, { token }),
  }
}

export const newRequestId = () => crypto.randomUUID()
