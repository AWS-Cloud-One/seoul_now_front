import { useEffect, useState } from 'react'
import type { MapQuery } from '../../api/queries'
import { fetchRoadTraffic, type MapRoadSegment } from './store'
export function useRoadTraffic(query: MapQuery, enabled: boolean) {
  const key = JSON.stringify(query)
  const [state, setState] = useState<{ roads: MapRoadSegment[]; error: string | null }>({
    roads: [],
    error: null,
  })
  useEffect(() => {
    if (!enabled) return
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const roads = await fetchRoadTraffic(request.signal, JSON.parse(key))
        if (!request.signal.aborted) setState({ roads, error: null })
      } catch (error) {
        if (!request.signal.aborted)
          setState((old) => ({
            roads: old.roads.map((r) => ({ ...r, speed: null, travelSeconds: null })),
            error: error instanceof Error ? error.message : '도로 관측을 조회하지 못했어요.',
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
  }, [key, enabled])
  return state
}
