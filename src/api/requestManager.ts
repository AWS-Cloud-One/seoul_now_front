export type RequestScope = { tripId: string; version: number; resultId: string | null }
export type PreparedRequest = {
  readonly requestId: string
  readonly path: string
  readonly body: string
  readonly scope: Readonly<RequestScope>
}
export type RequestAttempt = PreparedRequest & {
  readonly signal: AbortSignal
  readonly sequence: number
}
const sameScope = (a: RequestScope, b: RequestScope) =>
  a.tripId === b.tripId && a.version === b.version && a.resultId === b.resultId

/** One state-changing request at a time; no automatic retries of POSTs. */
export class RequestManager {
  private sequence = 0
  private controller: AbortController | null = null
  private current: RequestAttempt | null = null
  private resend: PreparedRequest | null = null
  private blockedUntil = 0

  get busy() {
    return this.current !== null
  }
  get canResend() {
    return this.resend !== null && !this.busy
  }
  get retryAfterSeconds() {
    return Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000))
  }

  start(scope: RequestScope, path: string, body: Record<string, unknown>): RequestAttempt | null {
    if (this.busy || this.retryAfterSeconds > 0) return null
    const requestId = crypto.randomUUID()
    return this.attempt(
      Object.freeze({
        requestId,
        path,
        scope: Object.freeze({ ...scope }),
        body: JSON.stringify({ ...body, request_id: requestId }),
      }),
    )
  }
  retry(scope: RequestScope): RequestAttempt | null {
    if (
      this.busy ||
      this.retryAfterSeconds > 0 ||
      !this.resend ||
      !sameScope(scope, this.resend.scope)
    )
      return null
    return this.attempt(this.resend)
  }
  private attempt(prepared: PreparedRequest) {
    this.controller = new AbortController()
    this.resend = null
    this.current = Object.freeze({
      ...prepared,
      signal: this.controller.signal,
      sequence: ++this.sequence,
    })
    return this.current
  }
  isCurrent(attempt: RequestAttempt, scope: RequestScope) {
    return this.current === attempt && !attempt.signal.aborted && sameScope(attempt.scope, scope)
  }
  finish(
    attempt: RequestAttempt,
    outcome: 'received' | 'unknown',
    retryAfterSeconds: number | null = null,
  ) {
    if (this.current !== attempt) return
    if (retryAfterSeconds !== null) this.blockedUntil = Date.now() + retryAfterSeconds * 1000
    this.resend =
      outcome === 'unknown'
        ? {
            path: attempt.path,
            requestId: attempt.requestId,
            body: attempt.body,
            scope: attempt.scope,
          }
        : null
    this.current = null
    this.controller = null
  }
  cancel() {
    this.controller?.abort()
    this.current = null
    this.controller = null
    this.resend = null
  }
}
