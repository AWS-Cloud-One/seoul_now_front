import { useEffect, useRef, useState } from 'react'
import { searchPlaces, type FoundPlace } from '../../routing/api'
import Icon from '../Icon'
import { SearchField, SecondaryButton } from './ui'
import type { Target } from './RouteSections'

export default function OriginSearch({
  value,
  onChange,
}: {
  value: Target | null
  onChange: (place: Target | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoundPlace[]>([])
  const [status, setStatus] = useState('')
  const [retry, setRetry] = useState(0)
  const locationRequest = useRef(0)
  useEffect(
    () => () => {
      locationRequest.current++
    },
    [],
  )
  useEffect(() => {
    if (value || query.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setStatus('출발지를 찾는 중이에요…')
      searchPlaces(query.trim(), controller.signal).then(
        (places) => {
          if (controller.signal.aborted) return
          setResults(places)
          setStatus(places.length ? '' : '검색 결과가 없어요. 다른 이름으로 찾아보세요.')
        },
        () => {
          if (!controller.signal.aborted) setStatus('출발지 검색에 실패했어요. 다시 시도해 주세요.')
        },
      )
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, value, retry])
  const choose = (place: Target) => {
    locationRequest.current++
    setStatus('')
    setResults([])
    onChange(place)
  }
  const locate = () => {
    const request = ++locationRequest.current
    setResults([])
    setQuery('')
    if (!navigator.geolocation) {
      setStatus('이 브라우저는 위치 기능을 지원하지 않아요. 장소 이름으로 검색해 주세요.')
      return
    }
    setStatus('내 위치를 확인하는 중이에요…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request === locationRequest.current)
          choose({
            id: 'current-location',
            name: '내 위치',
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          })
      },
      () => {
        if (request === locationRequest.current)
          setStatus('현재 위치를 확인하지 못했어요. 장소 이름으로 검색해 주세요.')
      },
      { timeout: 10000 },
    )
  }
  return (
    <section className="sn-section" aria-labelledby="sn-dir-origin">
      <h3 id="sn-dir-origin">출발지</h3>
      {value ? (
        <div className="sn-dest-chosen">
          <Icon name="pin" />
          <strong className="sn-place-body">{value.name}</strong>
          <SecondaryButton
            className="is-compact"
            onClick={() => {
              onChange(null)
              setQuery('')
              setStatus('')
            }}
          >
            출발지 바꾸기
          </SecondaryButton>
        </div>
      ) : (
        <>
          <SearchField
            label="출발지 검색"
            placeholder="출발할 곳 (예: 서울역, 집 근처 카페)"
            value={query}
            onChange={(text) => {
              locationRequest.current++
              setQuery(text)
              setResults([])
              setStatus('')
            }}
          />
          <SecondaryButton className="is-compact" onClick={locate}>
            <Icon name="locate" />내 위치에서 출발
          </SecondaryButton>
          {results.length > 0 && (
            <ul className="sn-dest-list" aria-label="출발지 검색 결과">
              {results.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() =>
                      choose({ id: place.id, name: place.name, lat: place.lat, lon: place.lng })
                    }
                  >
                    <Icon name="pin" />
                    <span className="sn-place-body">
                      <strong>{place.name}</strong>
                      <span className="sn-place-meta">{place.address || place.category}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status && (
            <p className="sn-note" role="status">
              {status}
            </p>
          )}
          {status.includes('검색에 실패') && (
            <SecondaryButton onClick={() => setRetry((value) => value + 1)}>
              출발지 검색 다시 시도
            </SecondaryButton>
          )}
        </>
      )}
    </section>
  )
}
