import { useCallback, useEffect, useState } from 'react'
import type { MapQuery } from '../api/queries'
import { fetchRoadTraffic, type MapRoadSegment } from '../state/live/store'
export function useRoadTraffic(query: MapQuery, enabled: boolean) {
  const key = JSON.stringify(query)
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt((value) => value + 1), [])
  const [state, setState] = useState<{
    roads: MapRoadSegment[]
    error: string | null
    status: 'loading' | 'ready' | 'error'
  }>({
    roads: [],
    error: null,
    status: 'loading',
  })
  useEffect(() => {
    if (!enabled) return
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      setState((old) => ({ ...old, error: null, status: 'loading' }))
      try {
        const roads = await fetchRoadTraffic(request.signal, JSON.parse(key))
        if (!request.signal.aborted) setState({ roads, error: null, status: 'ready' })
      } catch (error) {
        if (!request.signal.aborted)
          setState((old) => ({
            roads: old.roads.map((r) => ({ ...r, speed: null, travelSeconds: null })),
            error: error instanceof Error ? error.message : '도로 관측을 조회하지 못했어요.',
            status: 'error',
          }))
      }
    }
    const debounce = setTimeout(() => void refresh(), 250)
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 60000)
    return () => {
      clearTimeout(debounce)
      clearInterval(timer)
      controller?.abort()
    }
  }, [key, enabled, attempt])
  return { ...state, refresh }
}
