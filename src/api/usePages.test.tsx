import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { clearPageCache, usePages } from './usePages'
import { queryApi, QueryError } from './queries'
vi.mock('./queries', async (original) => ({
  ...(await original<typeof import('./queries')>()),
  queryApi: vi.fn(),
}))
afterEach(() => {
  cleanup()
  clearPageCache()
  vi.resetAllMocks()
  vi.useRealTimers()
})
it('검색 조건 변경 시 이전 커서를 버리고 늦은 응답을 차단하며 결과를 재사용한다', async () => {
  let old!: (data: unknown) => void
  vi.mocked(queryApi)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve
        }),
    )
    .mockResolvedValueOnce({ items: ['new'], next_cursor: 'next' })
    .mockResolvedValueOnce({ items: ['second'], next_cursor: null })
  const { result, rerender } = renderHook(
    ({ q }) => usePages<string>('/search', { query: q, limit: 10 }, true, 0),
    { initialProps: { q: 'old' } },
  )
  await waitFor(() => expect(queryApi).toHaveBeenCalledTimes(1))
  rerender({ q: 'new' })
  await waitFor(() => expect(result.current.items).toEqual(['new']))
  await act(async () => old({ items: ['obsolete'], next_cursor: 'old-cursor' }))
  expect(result.current.items).toEqual(['new'])
  act(() => {
    result.current.more()
    result.current.more()
  })
  await waitFor(() => expect(result.current.items).toEqual(['new', 'second']))
  expect(queryApi).toHaveBeenCalledTimes(3)
  expect(queryApi).toHaveBeenLastCalledWith(
    '/search',
    { query: 'new', limit: 10, cursor: 'next' },
    expect.any(AbortSignal),
  )
  rerender({ q: 'old' })
  rerender({ q: 'new' })
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(queryApi).toHaveBeenCalledTimes(3)
})
it('커서 만료 시 기존 목록을 유지하고 첫 페이지 재조회만 허용한다', async () => {
  vi.mocked(queryApi)
    .mockResolvedValueOnce({ items: ['first'], next_cursor: 'expired' })
    .mockRejectedValueOnce(new QueryError('커서가 만료됐어요.', 410, 'CURSOR_EXPIRED'))
    .mockResolvedValueOnce({ items: ['updated'], next_cursor: null })
  const { result } = renderHook(() => usePages<string>('/search', {}, true, 0))
  await waitFor(() => expect(result.current.items).toEqual(['first']))
  act(() => result.current.more())
  await waitFor(() => expect(result.current.expired).toBe(true))
  act(() => result.current.more())
  expect(queryApi).toHaveBeenCalledTimes(2)
  expect(result.current.items).toEqual(['first'])
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.items).toEqual(['updated']))
  expect(queryApi).toHaveBeenLastCalledWith(
    '/search',
    { cursor: undefined },
    expect.any(AbortSignal),
  )
})
it('429 대기 중 검색어를 바꿔도 새 요청을 보내거나 무한 로딩하지 않는다', async () => {
  vi.useFakeTimers()
  vi.mocked(queryApi)
    .mockRejectedValueOnce(
      new QueryError('잠시 기다려 주세요.', 429, 'RATE_LIMITED', Date.now() + 30_000),
    )
    .mockResolvedValueOnce({ items: ['done'], next_cursor: null })
  const { result, rerender } = renderHook(
    ({ q }) => usePages<string>('/search', { query: q }, true, 0),
    { initialProps: { q: 'one' } },
  )
  await act(() => vi.advanceTimersByTimeAsync(1))
  rerender({ q: 'two' })
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(result.current.busy).toBe(false)
  act(() => result.current.refresh())
  expect(queryApi).toHaveBeenCalledTimes(1)
  await act(() => vi.advanceTimersByTimeAsync(30_000))
  act(() => result.current.refresh())
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(result.current.items).toEqual(['done'])
})
