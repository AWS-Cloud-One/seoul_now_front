import type { ApiEnvelope, ApiError } from './contracts'

export type ApiResponse<T> = {
  status: number
  ok: boolean
  envelope: ApiEnvelope<T>
  retryAfterSeconds: number | null
}
export class ApiTransportError extends Error {
  constructor(
    readonly kind: 'network' | 'timeout' | 'protocol',
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'ApiTransportError'
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isError(value: unknown): value is ApiError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean' &&
    (value.retry_after_seconds == null ||
      (Number.isInteger(value.retry_after_seconds) && Number(value.retry_after_seconds) >= 0)) &&
    Array.isArray(value.details) &&
    value.details.every(
      (detail) =>
        isRecord(detail) &&
        ['field', 'code', 'message'].every((key) => typeof detail[key] === 'string'),
    )
  )
}
function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    isRecord(value) &&
    typeof value.request_id === 'string' &&
    typeof value.server_time === 'string' &&
    Number.isFinite(Date.parse(value.server_time)) &&
    Object.hasOwn(value, 'data') &&
    (value.error === null || isError(value.error))
  )
}
function retryAfter(response: Response, envelope: ApiEnvelope<unknown>): number | null {
  const header = response.headers.get('Retry-After')
  let seconds: number | null = null
  if (header && /^\d+$/.test(header.trim())) seconds = Number(header)
  else if (header && Number.isFinite(Date.parse(header))) {
    const serverTime = response.headers.get('Date') || envelope.server_time
    seconds = Math.max(0, Math.ceil((Date.parse(header) - Date.parse(serverTime)) / 1000))
  }
  const body = envelope.error?.retry_after_seconds
  const values = [seconds, body].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  )
  return values.length ? Math.max(...values) : null
}
export type ApiRequestOptions = {
  method?: 'GET' | 'POST'
  /** Serialized once when preparing a command, reused verbatim for an ambiguous-outcome resend. */
  body?: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: HeadersInit
  signal?: AbortSignal
  timeoutMs?: number
}
export function createApiClient(baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1') {
  return {
    async request<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
      if (!path.startsWith('/') || path.startsWith('//'))
        throw new Error('API 경로를 확인해 주세요.')
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(options.query || {}))
        if (value !== undefined) query.set(key, String(value))
      const url = baseUrl.replace(/\/$/, '') + path + (query.size ? '?' + query : '')
      const headers = new Headers(options.headers)
      headers.set('Accept', 'application/json')
      if (options.body !== undefined) headers.set('Content-Type', 'application/json')
      const controller = new AbortController()
      const abort = () => controller.abort(options.signal?.reason)
      options.signal?.throwIfAborted()
      options.signal?.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, options.timeoutMs ?? 30000)
      try {
        const response = await fetch(url, {
          method: options.method || 'GET',
          headers,
          body: options.body,
          signal: controller.signal,
          cache: 'no-store',
        })
        let body: unknown
        try {
          body = await response.json()
        } catch (error) {
          if (controller.signal.aborted) throw error
          throw new ApiTransportError('protocol', '서버 응답을 해석하지 못했어요.', response.status)
        }
        if (!isEnvelope(body) || (!response.ok && body.error === null)) {
          throw new ApiTransportError(
            'protocol',
            'API 응답 형식이 올바르지 않아요.',
            response.status,
          )
        }
        controller.signal.throwIfAborted()
        // HTTP failures can contain an applied condition update. The caller must inspect data.
        return {
          status: response.status,
          ok: response.ok && body.error === null,
          envelope: body as ApiEnvelope<T>,
          retryAfterSeconds: retryAfter(response, body),
        }
      } catch (error) {
        if (options.signal?.aborted)
          throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
        if (timedOut)
          throw new ApiTransportError('timeout', '서버 응답을 기다리는 시간이 초과됐어요.')
        if (error instanceof ApiTransportError) throw error
        throw new ApiTransportError('network', '서버에 연결하지 못했어요.')
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
      }
    },
  }
}
export const apiClient = createApiClient()
