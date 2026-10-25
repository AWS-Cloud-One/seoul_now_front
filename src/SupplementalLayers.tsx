import { lazy, Suspense } from 'react'
const CctvPlayer = lazy(() => import('./CctvPlayer'))
import { useEffect, useRef, useState } from 'react'

type Item = {
  id: string
  name?: string
  address?: string
  lat: number
  lng: number
  count_10min?: number | null
  observed_at?: string
  observation_status?: string
  url?: string | null
  url_status?: string
  playback_status?: string
}
type Feature = {
  geometry: { type: string; coordinates: number[][][] | number[][][][] }
  properties: {
    name: string
    district: string
    congestion?: string | null
    status?: string
    source_time?: string
    population_min?: string
    population_max?: string
  }
}
type LayerData = { items?: Item[]; features?: Feature[]; notice?: string; collected_at: string }
const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export default function SupplementalLayers({ map }: { map: kakao.maps.Map | null }) {
  const markers = useRef<kakao.maps.Marker[]>([])
  const polygons = useRef<kakao.maps.Polygon[]>([])
  const [data, setData] = useState<LayerData | null>(null)
  const [kind, setKind] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState<Item | null>(null)
  function clear() {
    markers.current.forEach((marker) => marker.setMap(null))
    polygons.current.forEach((polygon) => polygon.setMap(null))
    setPlaying(null)
    markers.current = []
    polygons.current = []
  }
  useEffect(
    () => () => {
      markers.current.forEach((marker) => marker.setMap(null))
      polygons.current.forEach((polygon) => polygon.setMap(null))
    },
    [],
  )
  async function load(layer: string) {
    if (!map) return
    setBusy(true)
    setMessage('조회 중…')
    try {
      const response = await fetch(`${base}/map/${layer}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || '자료를 불러오지 못했습니다.')
      clear()
      setData(result)
      setKind(layer)
      const bounds = new kakao.maps.LatLngBounds()
      for (const item of (result.items || []) as Item[]) {
        const position = new kakao.maps.LatLng(item.lat, item.lng)
        const marker = new kakao.maps.Marker({
          map,
          position,
          title: item.name || item.address || item.id,
        })
        kakao.maps.event.addListener(marker, 'click', () => {
          document
            .getElementById(`supplemental-${item.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
        markers.current.push(marker)
        bounds.extend(position)
      }
      for (const feature of (result.features || []) as Feature[]) {
        const groups =
          feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates as number[][][]]
            : (feature.geometry.coordinates as number[][][][])
        for (const rings of groups) {
          const path = rings.map((ring) =>
            ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)),
          )
          polygons.current.push(
            new kakao.maps.Polygon({
              map,
              path,
              strokeWeight: 1,
              strokeColor: layer === 'population/geometry' ? '#5c6866' : '#5547b0',
              strokeOpacity: 0.7,
              fillColor:
                layer === 'population/geometry'
                  ? { 여유: '#16865b', 보통: '#e6bf36', '약간 붐빔': '#e58a2c', 붐빔: '#d33d45' }[
                      feature.properties.congestion || ''
                    ] || '#89928f'
                  : '#9084d4',
              fillOpacity: layer === 'population/geometry' ? 0.4 : 0.04,
            }),
          )
        }
      }
      if (result.items?.length) map.setBounds(bounds)
      setMessage(
        `${result.features ? `영역 ${result.features.length}개` : `${result.items.length}지점`} · 수집 ${new Date(result.collected_at).toLocaleString('ko-KR')} · ${result.notice || ''}`,
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '조회 실패')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="supplemental">
      <h2>추가 서울 데이터</h2>
      <div className="controls">
        <button disabled={!map || busy} onClick={() => void load('areas')}>
          행정동 경계
        </button>
        <button disabled={!map || busy} onClick={() => void load('pedestrians')}>
          S-DoT 통행량
        </button>
        <button disabled={!map || busy} onClick={() => void load('cctv')}>
          도로 CCTV
        </button>
        <button
          disabled={busy}
          onClick={() => {
            clear()
            setData(null)
            setMessage('추가 레이어를 지웠습니다.')
          }}
        >
          추가 레이어 지우기
        </button>
      </div>
      <p role="status">{message}</p>
      <button disabled={!map || busy} onClick={() => void load('population/geometry')}>
        장소별 혼잡도 영역
      </button>
      <p>혼잡도: 초록 여유 · 노랑 보통 · 주황 약간 붐빔 · 빨강 붐빔 · 회색 미확인</p>
      {playing?.url && (
        <Suspense fallback={<p>플레이어 준비 중…</p>}>
          <CctvPlayer
            key={playing.url}
            url={playing.url}
            name={playing.name || '도로 CCTV'}
            onClose={() => setPlaying(null)}
          />
        </Suspense>
      )}
      <div className="results supplemental-results">
        {data?.items?.map((item) => (
          <article id={`supplemental-${item.id}`} className="card" key={item.id}>
            <strong>{item.name || `방문자 센서 ${item.id}`}</strong>
            <p>{item.address}</p>
            {kind === 'pedestrians' && (
              <>
                <p>
                  {item.count_10min == null
                    ? '최근 통행량 미확인'
                    : `10분 통행량 ${item.count_10min}회`}
                </p>
                <small>
                  측정{' '}
                  {item.observed_at ? new Date(item.observed_at).toLocaleString('ko-KR') : '미확인'}{' '}
                  · 주변 인구수와 다름
                </small>
              </>
            )}
            {kind === 'cctv' && (
              <>
                <p>영상 재생·갱신 미검증 · 촬영 방향 미확인</p>
                {item.url ? (
                  <>
                    <button onClick={() => setPlaying(item)}>영상 재생</button>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      제공된 영상 주소 열기
                    </a>
                  </>
                ) : (
                  <p>영상 주소 만료 또는 미제공</p>
                )}
                <p>재생 버튼을 누른 카메라만 영상에 연결됩니다.</p>
              </>
            )}
            <button onClick={() => map?.setCenter(new kakao.maps.LatLng(item.lat, item.lng))}>
              위치 보기
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
