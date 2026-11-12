import { useCallback, useEffect, useRef, useState } from 'react'
import { queryApi, QueryError, type Page } from './queries'
import { useSecondsRemaining } from '../hooks/useSecondsRemaining'

const EMPTY: never[] = []
const cache = new Map<string, { expires: number; page: unknown }>()
export const clearPageCache = () => cache.clear()
export function usePages<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  enabled = true,
  delay = 350,
  selectPage?: (data: unknown) => Page<T>,
) {
  const key = JSON.stringify([path, params])
  const current = useRef<AbortController | null>(null)
  const gate = useRef(0)
  const [state, setState] = useState<{
    key: string
    items: T[]
    page: Page<T> | null
    busy: boolean
    error: string | null
    retryAt: number
    expired: boolean
  }>({ key: '', items: [], page: null, busy: false, error: null, retryAt: 0, expired: false })
  const run = useCallback(
    async (cursor?: string, append = false, fresh = false) => {
      if (!enabled) return
      if (gate.current > Date.now()) {
        setState((old) => ({
          ...old,
          key,
          items: old.key === key ? old.items : [],
          page: old.key === key ? old.page : null,
          busy: false,
          expired: false,
          error: old.error || '요청 제한이 끝난 뒤 다시 조회해 주세요.',
        }))
        return
      }
      if (append && current.current && !current.current.signal.aborted) return
      current.current?.abort()
      const controller = new AbortController()
      current.current = controller
      setState((old) => ({
        ...old,
        key,
        items: old.key === key ? old.items : [],
        page: old.key === key ? old.page : null,
        busy: true,
        error: null,
        expired: false,
      }))
      const [url, query] = JSON.parse(key)
      const cacheKey = JSON.stringify([key, cursor])
      try {
        const saved = cache.get(cacheKey)
        const data =
          !fresh && saved && saved.expires > Date.now()
            ? saved.page
            : await queryApi<unknown>(url, { ...query, cursor }, controller.signal)
        if (controller.signal.aborted) return
        const page = selectPage ? selectPage(data) : (data as Page<T>)
        if (!Array.isArray(page.items)) throw new Error('검색 응답을 확인할 수 없어요.')
        if (!saved || fresh || saved.expires <= Date.now()) {
          cache.set(cacheKey, { page: data, expires: Date.now() + 60_000 })
          if (cache.size > 40) cache.delete(cache.keys().next().value!)
        }
        setState((old) => ({
          key,
          items: append && old.key === key ? [...old.items, ...page.items] : page.items,
          page,
          busy: false,
          error: null,
          retryAt: 0,
          expired: false,
        }))
      } catch (error) {
        if (controller.signal.aborted) return
        gate.current = error instanceof QueryError ? error.retryAt : 0
        setState((old) => ({
          ...old,
          busy: false,
          error: error instanceof Error ? error.message : '조회하지 못했어요.',
          retryAt: gate.current,
          expired: error instanceof QueryError && error.status === 410,
        }))
      } finally {
        if (current.current === controller) current.current = null
      }
    },
    [key, enabled, selectPage],
  )
  useEffect(() => {
    const timer = setTimeout(() => void run(), delay)
    return () => {
      clearTimeout(timer)
      current.current?.abort()
    }
  }, [run, delay])
  const wait = useSecondsRemaining(state.retryAt)
  const same = enabled && state.key === key
  return {
    items: same ? state.items : EMPTY,
    page: same ? state.page : null,
    busy: enabled && (!same || state.busy),
    error: same ? state.error : null,
    wait: enabled ? wait : 0,
    expired: same && state.expired,
    refresh: () => void run(undefined, false, true),
    more: () => {
      if (same && !state.busy && !state.expired && state.page?.next_cursor)
        void run(state.page.next_cursor, true)
    },
  }
}
