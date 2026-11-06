import { SEOUL_BOUNDARY } from '../data/seoulBoundary'
import { useSyncExternalStore } from 'react'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const LEVELS = ['여유', '보통', '약간 붐빔', '붐빔'] as const
export type Level = (typeof LEVELS)[number] | '정보 없음'
export const LEVEL_COLORS: Record<Level, string> = {
  여유: '#5b9bd5',
  보통: '#e3c13f',
  '약간 붐빔': '#e58b44',
  붐빔: '#d4506a',
  '정보 없음': '#98a2b3',
}
export type LivePlace = {
  code: string
  name: string
  category: string
  lat: number
  lng: number
  level: Level
  /** Provider flagged this observation as stale or substituted. */
  stale: boolean
  populationMin: number | null
  populationMax: number | null
  sourceTime: string | null
  /** Outer ring as [lat, lng]. */
  ring: [number, number][]
}
export type LiveState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  places: LivePlace[]
  /** Seoul administrative boundaries as rings of [lat, lng] (used to grey out everything else). */
  boundary: [number, number][][] | null
  selected: string | null
}

let state: LiveState = {
  status: 'idle',
  error: null,
  places: [],
  boundary: SEOUL_BOUNDARY,
  selected: null,
}
const listeners = new Set<() => void>()
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const getLiveState = () => state
export const subscribeLive = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const useLive = () => useSyncExternalStore(subscribeLive, getLiveState, getLiveState)
export const selectLivePlace = (code: string | null) => set({ selected: code })

const num = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && value !== '' && value !== null ? n : null
}
const swap = (ring: number[][]): [number, number][] => ring.map(([lng, lat]) => [lat, lng])

type Feature = {
  geometry: { type: string; coordinates: number[][][] | number[][][][] }
  properties: Record<string, string>
}
export function parsePlaces(data: { features?: Feature[] }): LivePlace[] {
  const places: LivePlace[] = []
  for (const feature of data.features || []) {
    const { geometry, properties: p } = feature
    const outer = (
      geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][])[0]?.[0]
        : (geometry.coordinates as number[][][])[0]
    ) as number[][] | undefined
    if (!outer?.length || !p.area_code) continue
    const ring = swap(outer)
    const lats = ring.map((r) => r[0])
    const lngs = ring.map((r) => r[1])
    const stale = p.status !== 'recent' || p.replacement === 'Y'
    const level = (LEVELS as readonly string[]).includes(p.congestion)
      ? (p.congestion as Level)
      : '정보 없음'
    places.push({
      code: p.area_code,
      name: p.name,
      category: p.category,
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      level: stale ? '정보 없음' : level,
      stale,
      populationMin: stale ? null : num(p.population_min),
      populationMax: stale ? null : num(p.population_max),
      sourceTime: p.source_time || null,
      ring,
    })
  }
  return places
}
export function parseBoundary(data: { features?: Feature[] }): [number, number][][] {
  const rings: [number, number][][] = []
  for (const feature of data.features || []) {
    const { geometry } = feature
    const polygons =
      geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][])
        : [geometry.coordinates as number[][][]]
    for (const polygon of polygons) if (polygon[0]?.length) rings.push(swap(polygon[0]))
  }
  return rings
}

async function getJson(path: string, signal?: AbortSignal) {
  const response = await fetch(`${BASE}${path}`, { signal })
  if (!response.ok) throw new Error('서울 도시데이터를 불러오지 못했어요.')
  return response.json()
}
let boundaryRequested = false
let timer: ReturnType<typeof setInterval> | undefined
let users = 0
async function refresh() {
  try {
    const data = await getJson('/map/population/geometry')
    set({ places: parsePlaces(data), status: 'ready', error: null })
  } catch (error) {
    set({
      status: state.places.length ? 'ready' : 'error',
      error: (error as Error).message,
    })
  }
}
async function loadBoundary() {
  if (boundaryRequested) return
  boundaryRequested = true
  try {
    const boundary = parseBoundary(await getJson('/map/areas'))
    set({ boundary: boundary.length ? boundary : SEOUL_BOUNDARY })
  } catch {
    boundaryRequested = false
  }
}
/** Starts polling while at least one component uses the live data. */
export function startLive() {
  users += 1
  if (users === 1) {
    if (state.status !== 'ready') set({ status: 'loading' })
    void refresh()
    void loadBoundary()
    timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 60000)
  }
  return () => {
    users -= 1
    if (users === 0) clearInterval(timer)
  }
}
export const retryLive = () => {
  set({ status: 'loading' })
  void refresh()
  void loadBoundary()
}

export type RoadSegment = {
  name: string
  speed: number | null
  level: string
  path: [number, number][]
}
export type LiveDetail = {
  name: string
  road: {
    level: string | null
    speed: number | null
    message: string | null
    time: string | null
    segments: RoadSegment[]
  }
  commerce: {
    level: string | null
    time: string | null
    payments: number | null
    categories: {
      name: string
      group: string
      stores: number | null
      level: string | null
    }[]
  }
  parking: {
    total: number
    lots: { name: string; capacity: number | null; available: number | null; fee: string | null }[]
  }
  weather: { temp: string | null; air: string | null; rain: string | null } | null
}
type Raw = Record<string, unknown>
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : [])
const txt = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))

export function parseDetail(payload: { data?: Raw; area_name?: string }): LiveDetail {
  const d = (payload.data || {}) as Raw
  const avg = ((d.ROAD_TRAFFIC_STTS as Raw | undefined)?.AVG_ROAD_DATA || {}) as Raw
  const roadList = arr((d.ROAD_TRAFFIC_STTS as Raw | undefined)?.ROAD_TRAFFIC_STTS)
  const segments = roadList
    .map((road) => ({
      name: String(road.ROAD_NM || '이름 없는 도로'),
      speed: num(road.SPD),
      level: String(road.IDX || '정보 없음'),
      path: String(road.XYLIST || '')
        .split('|')
        .map((pair) => pair.split('_').map(Number))
        .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
        .map(([lng, lat]) => [lat, lng] as [number, number]),
    }))
    .filter((segment) => segment.path.length > 1)
  const commerceRoot = arr(d.LIVE_CMRCL_STTS)[0] || (d.LIVE_CMRCL_STTS as Raw | undefined) || {}
  const parkingList = arr(d.PRK_STTS)
  const weather = arr(d.WEATHER_STTS)[0]
  return {
    name: payload.area_name || '',
    road: {
      level: txt(avg.ROAD_TRAFFIC_IDX),
      speed: num(avg.ROAD_TRAFFIC_SPD),
      message: txt(avg.ROAD_MSG),
      time: txt(avg.ROAD_TRAFFIC_TIME),
      segments,
    },
    commerce: {
      level: txt((commerceRoot as Raw).AREA_CMRCL_LVL),
      time: txt((commerceRoot as Raw).CMRCL_TIME),
      payments: num((commerceRoot as Raw).AREA_SH_PAYMENT_CNT),
      categories: arr((commerceRoot as Raw).CMRCL_RSB).map((c) => ({
        name: String(c.RSB_MID_CTGR || ''),
        group: String(c.RSB_LRG_CTGR || ''),
        stores: num(c.RSB_MCT_CNT),
        level: txt(c.RSB_PAYMENT_LVL),
      })),
    },
    parking: {
      total: parkingList.length,
      lots: parkingList.map((lot) => ({
        name: String(lot.PRK_NM || ''),
        capacity: num(lot.CPCTY),
        // The provider only reports vacancies when CUR_PRK_YN is "Y".
        available: lot.CUR_PRK_YN === 'Y' ? num(lot.CUR_PRK_CNT) : null,
        fee: lot.PAY_YN === 'N' ? '무료' : lot.RATES ? `${lot.TIME_RATES}분 ${lot.RATES}원` : null,
      })),
    },
    weather: weather
      ? { temp: txt(weather.TEMP), air: txt(weather.AIR_IDX), rain: txt(weather.PCP_MSG) }
      : null,
  }
}
export async function fetchLiveDetail(code: string, signal: AbortSignal): Promise<LiveDetail> {
  return parseDetail(await getJson(`/citydata/areas/${encodeURIComponent(code)}`, signal))
}
