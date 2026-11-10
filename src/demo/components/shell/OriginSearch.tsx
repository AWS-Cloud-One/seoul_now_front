import { useEffect, useRef, useState } from 'react'
import { foundPlace } from '../../routing/api'
import { usePages } from '../../../api/usePages'
import type { FoundPlaceData } from '../../../api/queries'
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
  const search = usePages<FoundPlaceData>(
    '/locations/places/search',
    { query: query.trim(), limit: 10 },
    !value && query.trim().length >= 2,
  )
  const results = search.items.map(foundPlace)
  const [status, setStatus] = useState('')
  const locationRequest = useRef(0)
  useEffect(
    () => () => {
      locationRequest.current++
    },
    [],
  )
  const choose = (place: Target) => {
    locationRequest.current++
    setStatus('')
    onChange(place)
  }
  const locate = () => {
    const request = ++locationRequest.current
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
          {search.busy && query.trim().length >= 2 && <p role="status">출발지를 찾고 있어요…</p>}
          {search.page && !search.busy && !search.error && results.length === 0 && (
            <p>검색 결과가 없어요. 다른 이름으로 찾아보세요.</p>
          )}
          {search.error && <p role="alert">{search.error}</p>}
          {search.wait > 0 && <p>{search.wait}초 후 다시 조회할 수 있어요.</p>}
          {search.error && (
            <SecondaryButton disabled={search.wait > 0} onClick={search.refresh}>
              출발지 검색 다시 시도
            </SecondaryButton>
          )}
          {search.page?.next_cursor && (
            <SecondaryButton
              disabled={search.busy || search.wait > 0 || search.expired}
              onClick={search.more}
            >
              출발지 더 보기
            </SecondaryButton>
          )}
        </>
      )}
    </section>
  )
}
