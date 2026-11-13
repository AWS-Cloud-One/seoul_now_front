import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRoadTraffic } from './useRoadTraffic'
import { SEOUL_QUERY } from '../api/queries'
import { fetchRoadTraffic } from '../state/live/store'

vi.mock('../state/live/store', () => ({ fetchRoadTraffic: vi.fn() }))
afterEach(() => vi.clearAllMocks())

it('관측이 없는 정상 응답은 로딩이나 실패로 남지 않는다', async () => {
  vi.mocked(fetchRoadTraffic).mockResolvedValue([])
  const { result } = renderHook(() => useRoadTraffic(SEOUL_QUERY, true))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.roads).toEqual([])
  expect(result.current.error).toBeNull()
})

it('조회 실패를 표시한 후 사용자의 재시도로 복구한다', async () => {
  vi.mocked(fetchRoadTraffic).mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValue([])
  const { result } = renderHook(() => useRoadTraffic(SEOUL_QUERY, true))
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).toBe('연결 실패')
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.error).toBeNull()
})
