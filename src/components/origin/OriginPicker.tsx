import { useEffect, useRef, useState } from 'react'
import { apiClient } from '../../api/client'
import type { Location } from '../../api/contracts'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'
import Icon from '../common/Icon'

type SearchPage = { items: Location[]; next_cursor: string | null }
export default function OriginPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Location | null
  onChange: (value: Location | null, source?: 'current' | 'search') => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<SearchPage>({ items: [], next_cursor: null })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(false)
  const [until, setUntil] = useState(0)
  const remaining = useSecondsRemaining(until)
  const request = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  })
  const cache = useRef(new Map<string, SearchPage>())
  const debounce = useRef<number | undefined>(undefined)
  const cancel = () => {
    window.clearTimeout(debounce.current)
    request.current.controller?.abort()
    request.current = { id: request.current.id + 1, controller: null }
  }
  async function search(text: string, cursor?: string) {
    if (Date.now() < until) {
      setFailure(true)
      setStatus('검색 요청 제한이 풀리면 다시 시도해 주세요.')
      return
    }
    cancel()
    const id = request.current.id
    const controller = new AbortController()
    request.current.controller = controller
    setBusy(true)
    setFailure(false)
    setStatus('출발지를 찾는 중이에요…')
    try {
      const key = JSON.stringify([text, cursor])
      let data = cache.current.get(key)
      if (!data) {
        const response = await apiClient.request<SearchPage>('/locations/search', {
          query: { query: text, limit: 5, cursor },
          signal: controller.signal,
        })
        if (id !== request.current.id) return
        if (!response.ok || !response.envelope.data) {
          if (response.retryAfterSeconds) setUntil(Date.now() + response.retryAfterSeconds * 1000)
          if (response.status === 410) {
            cache.current.clear()
            setPage({ items: [], next_cursor: null })
          }
          throw new Error(response.envelope.error?.message || '출발지 검색에 실패했어요.')
        }
        data = response.envelope.data
        cache.current.set(key, data)
        if (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value!)
      }
      if (id !== request.current.id) return
      setPage((previous) => ({
        ...data,
        items: cursor ? [...previous.items, ...data.items] : data.items,
      }))
      setStatus(data.items.length ? '' : '검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요.')
    } catch (error) {
      if (id !== request.current.id) return
      setFailure(true)
      setStatus(error instanceof Error ? error.message : '출발지 검색에 실패했어요.')
    } finally {
      if (id === request.current.id) setBusy(false)
    }
  }
  useEffect(() => {
    if (value || !query.trim() || disabled) return
    debounce.current = window.setTimeout(() => void search(query.trim()), 400)
    return () => cancel()
    // Search is driven only by text/selection changes, never by results or retry countdowns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, value, disabled])
  useEffect(() => () => cancel(), [])
  function choose(location: Location, source: 'current' | 'search' = 'search') {
    cancel()
    setBusy(false)
    setStatus('')
    setFailure(false)
    setPage({ items: [], next_cursor: null })
    onChange(location, source)
  }
  function locate() {
    if (Date.now() < until) return
    cancel()
    setPage({ items: [], next_cursor: null })
    setFailure(false)
    if (!navigator.geolocation) {
      setStatus('이 브라우저는 위치 기능을 지원하지 않아요. 장소 이름으로 검색해 주세요.')
      return
    }
    {
      const id = request.current.id
      const controller = new AbortController()
      request.current.controller = controller
      setBusy(true)
      setStatus('현재 위치의 주소와 지원 지역을 확인하고 있어요…')
      navigator.geolocation.getCurrentPosition(
        async ({ coords }) => {
          if (id !== request.current.id) return
          try {
            const response = await apiClient.request<{ location: Location }>('/locations/resolve', {
              query: { latitude: coords.latitude, longitude: coords.longitude },
              signal: controller.signal,
            })
            if (id !== request.current.id) return
            if (!response.ok || !response.envelope.data) {
              if (response.retryAfterSeconds)
                setUntil(Date.now() + response.retryAfterSeconds * 1000)
              throw new Error(response.envelope.error?.message || '현재 위치를 확인하지 못했어요.')
            }
            const location = response.envelope.data.location
            if (!location.supported) {
              setStatus('현재 위치는 지원 지역 밖이에요. 서울·인천·경기의 출발지를 검색해 주세요.')
              return
            }
            choose(location, 'current')
          } catch (error) {
            if (id === request.current.id)
              setStatus(error instanceof Error ? error.message : '현재 위치를 확인하지 못했어요.')
          } finally {
            if (id === request.current.id) setBusy(false)
          }
        },
        (error) => {
          if (id !== request.current.id) return
          setBusy(false)
          setStatus(
            error.code === 1
              ? '위치 권한이 거부됐어요. 장소 이름이나 주소로 검색해 주세요.'
              : '현재 위치를 확인하지 못했어요. 다시 시도하거나 검색해 주세요.',
          )
        },
        { timeout: 10000, maximumAge: 60000 },
      )
    }
  }
  return (
    <div className="field">
      <label htmlFor="recommendation-origin">
        어디에서 출발하세요? <small className="form-label-note">서울·인천·경기</small>
      </label>
      {value ? (
        <div className="sn-dest-chosen">
          <Icon name="pin" />
          <span className="sn-place-body">
            <strong>{value.label}</strong>
            <span className="sn-place-meta">{value.address}</span>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              cancel()
              setQuery('')
              setStatus('')
              onChange(null)
            }}
          >
            출발지 바꾸기
          </button>
        </div>
      ) : (
        <>
          <input
            id="recommendation-origin"
            type="search"
            maxLength={100}
            value={query}
            disabled={disabled}
            autoComplete="off"
            placeholder="장소명 또는 주소 검색"
            onChange={(e) => {
              cancel()
              setQuery(e.target.value)
              setPage({ items: [], next_cursor: null })
              setStatus('')
              setBusy(false)
              setFailure(false)
            }}
          />
          <button type="button" disabled={disabled || busy || remaining > 0} onClick={locate}>
            <Icon name="locate" />
            현재 위치
          </button>
          {!!page.items.length && (
            <ul className="sn-dest-list" aria-label="출발지 검색 결과">
              {page.items.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <button
                    type="button"
                    disabled={disabled || !item.supported}
                    onClick={() => choose(item)}
                  >
                    <Icon name="pin" />
                    <span className="sn-place-body">
                      <strong>{item.label}</strong>
                      <span className="sn-place-meta">
                        {item.address}
                        {!item.supported && ' · 지원 지역 밖'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {page.next_cursor && (
            <button
              type="button"
              disabled={disabled || busy || remaining > 0}
              onClick={() => void search(query.trim(), page.next_cursor!)}
            >
              검색 결과 더 보기
            </button>
          )}
          {failure && (
            <button
              type="button"
              disabled={disabled || busy || remaining > 0}
              onClick={() => void search(query.trim(), page.next_cursor || undefined)}
            >
              출발지 검색 다시 시도
            </button>
          )}
        </>
      )}
      {status && (
        <p className="micro" role="status">
          {status}
        </p>
      )}
      {remaining > 0 && (
        <p className="micro" role="status">
          {remaining}초 후 다시 시도해 주세요.
        </p>
      )}
    </div>
  )
}
