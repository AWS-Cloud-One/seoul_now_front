import SupplementalLayers from './SupplementalLayers'
import { useEffect, useRef, useState } from 'react'

let sdkPromise: Promise<void> | undefined
function loadMapSdk(key: string) {
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`
    const timeout = window.setTimeout(
      () =>
        reject(
          new Error('지도 응답이 없습니다. 카카오맵 사용 설정과 등록 도메인을 확인해 주세요.'),
        ),
      15000,
    )
    script.onload = () => {
      if (!window.kakao?.maps) {
        window.clearTimeout(timeout)
        reject(
          new Error(
            '카카오 지도 SDK를 사용할 수 없습니다. 키와 카카오맵 사용 설정을 확인해 주세요.',
          ),
        )
        return
      }
      window.kakao.maps.load(() => {
        window.clearTimeout(timeout)
        resolve()
      })
    }
    script.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('지도를 불러오지 못했습니다. JavaScript 키와 등록 도메인을 확인해 주세요.'))
    }
    document.head.appendChild(script)
  })
  return sdkPromise
}

type Place = { id: string; place_name: string; x: string; y: string; address_name: string }
type Parking = {
  id: string
  name: string
  lat: number
  lon: number
  real_time_available: boolean
  available_spaces: number | null
  collected_at: string
  registered_details?: Record<string, unknown>
  operating_details?: Record<string, unknown>
}
type Area = {
  area_code: string
  area_name: string
  population: Record<string, string>
  source_time: string | null
  collected_at: string
  registered_details?: Record<string, unknown>
  operating_details?: Record<string, unknown>
}
type Road = {
  geometry: { coordinates: number[][] }
  properties: {
    traffic_status: string
    speed_kmh: string | null
    observation_status?: string
    traffic_collected_at?: string
    geometry_source?: string
  }
}
const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`)
  const data = await response.json()
  if (!response.ok)
    throw new Error(typeof data.detail === 'string' ? data.detail : '요청에 실패했습니다.')
  return data as T
}
export default function App() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<kakao.maps.Map | null>(null)
  const layers = useRef<{
    parking: kakao.maps.Marker[]
    places: kakao.maps.Marker[]
    roads: kakao.maps.Polyline[]
    route: kakao.maps.Polyline[]
  }>({ parking: [], places: [], roads: [], route: [] })
  const [status, setStatus] = useState('지도를 불러오는 중입니다.')
  const [ready, setReady] = useState(false)
  const [mapInstance, setMapInstance] = useState<kakao.maps.Map | null>(null)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [parking, setParking] = useState<Parking[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [areaCode, setAreaCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [source, setSource] = useState('seoul_getparkinfo')
  const [roadSource, setRoadSource] = useState('topis')
  const selectedArea = areas.find((area) => area.area_code === areaCode)

  function clear(kind: keyof typeof layers.current) {
    layers.current[kind].forEach((item) => item.setMap(null))
    layers.current[kind] = []
  }
  async function action(task: () => Promise<void>) {
    setBusy(true)
    setNotice('')
    try {
      await task()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    const key = import.meta.env.VITE_KAKAO_MAP_APP_KEY?.trim()
    if (!key) return
    loadMapSdk(key)
      .then(() => {
        if (!active || !container.current) return
        map.current = new kakao.maps.Map(container.current, {
          center: new kakao.maps.LatLng(37.5665, 126.978),
          level: 5,
        })
        setMapInstance(map.current)
        setReady(true)
        setStatus('지도의 중심을 출발지로 사용합니다. 지도를 움직여 위치를 선택하세요.')
      })
      .catch((error) => {
        if (active) setStatus(error instanceof Error ? error.message : '지도 연결 실패')
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const refreshPopulation = () => fetch(`${base}/map/population`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('혼잡도 데이터를 불러오지 못했습니다.')
        return r.json()
      })
      .then((data: { items: Area[] }) => setAreas(data.items))
      .catch((error) => {
        if (!controller.signal.aborted) setNotice(error.message)
      })
    void refreshPopulation()
    const refreshTimer = window.setInterval(() => void refreshPopulation(), 60000)
    return () => {
      window.clearInterval(refreshTimer)
      controller.abort()
    }
  }, [])
  async function search() {
    await action(async () => {
      const center = map.current!.getCenter()
      const data = await api<{ documents: Place[] }>(
        `/kakao/places?${new URLSearchParams({ query: query.trim(), lat: String(center.getLat()), lon: String(center.getLng()) })}`,
      )
      clear('places')
      clear('route')
      setPlaces(data.documents)
      const bounds = new kakao.maps.LatLngBounds()
      data.documents.forEach((place) => {
        const position = new kakao.maps.LatLng(Number(place.y), Number(place.x))
        const marker = new kakao.maps.Marker({
          map: map.current!,
          position,
          title: place.place_name,
        })
        layers.current.places.push(marker)
        bounds.extend(position)
      })
      if (data.documents.length) map.current!.setBounds(bounds)
      setNotice(
        `검색 결과 ${data.documents.length}곳. 길찾기는 버튼을 누를 때 지도 중심에서 출발합니다.`,
      )
    })
  }
  async function nearby() {
    await action(async () => {
      const center = map.current!.getCenter()
      const data = await api<{ items: Parking[]; notice?: string }>(
        `/parkings/${source === 'national' ? 'national/' : ''}nearby?lat=${center.getLat()}&lng=${center.getLng()}&limit=30&source=${source}`,
      )
      clear('parking')
      setParking(data.items)
      data.items.forEach((item) => {
        layers.current.parking.push(
          new kakao.maps.Marker({
            map: map.current!,
            position: new kakao.maps.LatLng(item.lat, item.lon),
            title: item.name,
          }),
        )
      })
      setNotice(
        `주변 주차장 ${data.items.length}곳. ${data.notice || '수집된 자료가 없으면 결과가 비어 있을 수 있습니다.'}`,
      )
    })
  }
  async function roads() {
    await action(async () => {
      const data = await api<{ features: Road[] }>(
        `/${roadSource === 'topis' ? 'traffic/network' : 'map/traffic'}?limit=10000${areaCode ? `&area_code=${encodeURIComponent(areaCode)}` : ''}`,
      )
      clear('roads')
      const bounds = new kakao.maps.LatLngBounds()
      data.features.forEach((feature) => {
        const path = feature.geometry.coordinates.map(
          ([lon, lat]) => new kakao.maps.LatLng(lat, lon),
        )
        const state = feature.properties.traffic_status || ''
        const color =
          roadSource === 'topis'
            ? feature.properties.observation_status === 'recently_collected'
              ? '#2463a6'
              : '#7b8794'
            : state.includes('정체')
              ? '#d33d45'
              : state.includes('서행')
                ? '#e49a24'
                : state.includes('원활')
                  ? '#16865b'
                  : '#7b8794'
        layers.current.roads.push(
          new kakao.maps.Polyline({
            map: map.current!,
            path,
            strokeWeight: 4,
            strokeStyle:
              feature.properties.observation_status &&
              feature.properties.observation_status !== 'recently_collected'
                ? 'shortdash'
                : 'solid',
            strokeColor: color,
            strokeOpacity: 0.75,
          }),
        )
        path.forEach((point) => bounds.extend(point))
      })
      if (data.features.length) map.current!.setBounds(bounds)
      setNotice(
        `${data.features.length}개 도로 · ${roadSource === 'topis' ? '파랑: 최근 소통 관측 있음 / 회색 점선: 관측 미확인·지연. 색은 혼잡 등급이 아닙니다.' : '초록: 원활 / 주황: 서행 / 빨강: 정체 / 회색: 미확인. 주요 장소 주변 도로입니다.'}`,
      )
    })
  }
  async function route(place: Place) {
    await action(async () => {
      const origin = map.current!.getCenter()
      const data = await api<{
        summary: { distance: number; duration: number }
        coordinates: number[][]
      }>(
        `/kakao/directions?${new URLSearchParams({ origin_lat: String(origin.getLat()), origin_lon: String(origin.getLng()), destination_lat: place.y, destination_lon: place.x })}`,
      )
      clear('route')
      const path = data.coordinates.map(([lon, lat]) => new kakao.maps.LatLng(lat, lon))
      if (!path.length) throw new Error('표시할 경로 좌표가 없습니다.')
      layers.current.route.push(
        new kakao.maps.Polyline({
          map: map.current!,
          path,
          strokeColor: '#225be7',
          strokeWeight: 7,
          strokeOpacity: 0.9,
        }),
      )
      const bounds = new kakao.maps.LatLngBounds()
      path.forEach((point) => bounds.extend(point))
      map.current!.setBounds(bounds)
      setNotice(
        `${place.place_name}까지 자동차 ${(data.summary.distance / 1000).toFixed(1)}km · 약 ${Math.ceil(data.summary.duration / 60)}분. 현재 지도 중심에서 출발한 예상 경로입니다.`,
      )
    })
  }
  return (
    <main className="page">
      <header>
        <div>
          <p className="eyebrow">SEOUL NOW</p>
          <h1>서울, 지금 어디?</h1>
        </div>
        <span className="badge">수집된 서울 데이터 + 카카오 지도</span>
      </header>
      <form
        className="controls"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && query.trim()) void search()
        }}
      >
        <input
          aria-label="장소 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="성수 카페, 서울시청…"
          maxLength={100}
        />
        <button disabled={!ready || busy || !query.trim()}>장소 검색</button>
      </form>
      <div className="controls">
        <select
          aria-label="주차장 자료"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="seoul_getparkinfo">공영주차장 기본정보</option>
          <option value="seoul_citydata_prk">도시데이터 주차장</option>
          <option value="seoul_municipal_parking">시영주차장</option>
          <option value="national">교통안전공단 주차장 (부분 수집)</option>
        </select>
        <button disabled={!ready || busy} onClick={() => void nearby()}>
          지도 중심 주변 주차장
        </button>
        <select
          aria-label="혼잡도 장소"
          value={areaCode}
          onChange={(event) => setAreaCode(event.target.value)}
        >
          <option value="">서울 주요 장소 선택</option>
          {areas.map((area) => (
            <option key={area.area_code} value={area.area_code}>
              {area.area_name} · {area.population.AREA_CONGEST_LVL || '혼잡도 미확인'}
            </option>
          ))}
        </select>
        <select
          aria-label="도로 자료"
          value={roadSource}
          onChange={(event) => setRoadSource(event.target.value)}
        >
          <option value="topis">TOPIS 도로망</option>
          <option value="citydata">도시데이터 주변 도로</option>
        </select>
        <button disabled={!ready || busy} onClick={() => void roads()}>
          도로 교통 표시
        </button>
        <button
          disabled={!ready || busy}
          onClick={() => {
            clear('parking')
            clear('places')
            clear('roads')
            clear('route')
            setParking([])
            setPlaces([])
            setNotice('지도 표시를 지웠습니다.')
          }}
        >
          표시 지우기
        </button>
      </div>
      {selectedArea && (
        <section className="card">
          <strong>
            {selectedArea.area_name} · {selectedArea.population.AREA_CONGEST_LVL || '혼잡도 미확인'}
          </strong>
          <p>{selectedArea.population.AREA_CONGEST_MSG}</p>
          <p>
            인구 {selectedArea.population.AREA_PPLTN_MIN || '?'}~
            {selectedArea.population.AREA_PPLTN_MAX || '?'}명 · 기준{' '}
            {selectedArea.source_time || '미제공'} · 수집{' '}
            {new Date(selectedArea.collected_at).toLocaleString('ko-KR')}
          </p>
          <p>도로 교통 표시를 누르면 이 장소 주변의 수집된 도로로 이동합니다.</p>
        </section>
      )}
      <div ref={container} className="map" aria-label="서울 카카오 지도" />
      <SupplementalLayers map={mapInstance} />
      <p role="status">
        {!import.meta.env.VITE_KAKAO_MAP_APP_KEY?.trim()
          ? '카카오 JavaScript 키를 설정해 주세요.'
          : busy
            ? '조회 중입니다…'
            : notice || status}
      </p>
      <div className="results">
        {places.map((place) => (
          <article className="card" key={place.id}>
            <strong>{place.place_name}</strong>
            <p>{place.address_name}</p>
            <button disabled={!ready || busy} onClick={() => void route(place)}>
              지도 중심에서 자동차 길찾기
            </button>
          </article>
        ))}
        {parking.map((item) => (
          <article className="card" key={item.id}>
            <strong>{item.name}</strong>
            <p>
              {item.real_time_available
                ? `확인된 빈자리 ${item.available_spaces}면`
                : '현재 빈자리 미확인'}
            </p>
            <details>
              <summary>총면수·요금·운영시간 원본 보기</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(item.operating_details || item.registered_details || {}, null, 2)}
              </pre>
              <p>
                자료에 없는 값은 미확인입니다. 원본 등록 정보로 현재 적용 여부는 다를 수 있습니다.
              </p>
            </details>
            <small>수집 {new Date(item.collected_at).toLocaleString('ko-KR')}</small>
            <button
              onClick={() => map.current?.setCenter(new kakao.maps.LatLng(item.lat, item.lon))}
            >
              위치 보기
            </button>
          </article>
        ))}
      </div>
    </main>
  )
}
