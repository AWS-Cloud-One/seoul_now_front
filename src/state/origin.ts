// The departure point shared by every tab except 저장 (map home, AI 추천, 길찾기, parking).
// Default: the current location when it is in Seoul. Outside Seoul, location denied or
// unavailable: ask the user to choose a departure (a detected 인천·경기 location can still be
// used with one click, since recommendations accept those origins).
import { useSyncExternalStore } from 'react'
import { apiClient } from '../api/client'
import type { Location } from '../api/contracts'

export type OriginState = {
  location: Location | null
  /** 'current' = from the device location, 'search' = picked by the user. */
  source: 'current' | 'search' | null
  status: 'idle' | 'locating' | 'ready' | 'needs-input'
  /** Why the user must choose a departure (shown above the search). */
  message: string | null
  /** Supported but non-Seoul current location the user may still accept. */
  detected: Location | null
  /** The departure picker (map top-right) is open. */
  open: boolean
}
const STORAGE_KEY = 'sn-origin-v1'

function restore(): OriginState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (
      saved?.location &&
      typeof saved.location.label === 'string' &&
      Number.isFinite(saved.location.coordinates?.latitude) &&
      Number.isFinite(saved.location.coordinates?.longitude)
    )
      return {
        location: saved.location,
        source: saved.source === 'current' ? 'current' : 'search',
        status: 'ready',
        message: null,
        detected: null,
        open: false,
      }
  } catch {
    /* Storage is optional; locate again. */
  }
  return {
    location: null,
    source: null,
    status: 'idle',
    message: null,
    detected: null,
    open: false,
  }
}

let state = restore()
const listeners = new Set<() => void>()
function set(next: OriginState) {
  state = next
  try {
    if (next.location)
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ location: next.location, source: next.source }),
      )
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* Keep the in-memory value. */
  }
  listeners.forEach((listener) => listener())
}
export const getOrigin = () => state
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const useOrigin = () => useSyncExternalStore(subscribe, getOrigin, getOrigin)

export function setOrigin(location: Location, source: 'current' | 'search' = 'search') {
  set({ location, source, status: 'ready', message: null, detected: null, open: false })
}
/** Open or close the departure picker on the map. */
export function openOriginPicker(open = true) {
  if (state.open !== open) set({ ...state, open })
}
export const toggleOriginPicker = () => openOriginPicker(!state.open)

const needsInput = (message: string, detected: Location | null = null): OriginState => ({
  location: state.location,
  source: state.source,
  status: 'needs-input',
  message,
  detected,
  open: state.open,
})

let attempt = 0
/** Resolve the device location; use it automatically only inside Seoul. */
export function locateOrigin() {
  const id = ++attempt
  if (!navigator.geolocation) {
    set(needsInput('이 브라우저는 위치 기능을 지원하지 않아요. 출발지를 입력해 주세요.'))
    return
  }
  set({ ...state, status: 'locating', message: null, detected: null })
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        const response = await apiClient.request<{ location: Location }>('/locations/resolve', {
          query: { latitude: coords.latitude, longitude: coords.longitude },
        })
        if (id !== attempt) return
        const location = response.ok ? response.envelope.data?.location : undefined
        if (!location) throw new Error(response.envelope.error?.message)
        if (location.region === 'seoul') setOrigin(location, 'current')
        else
          set(
            needsInput(
              location.supported
                ? `현재 위치(${location.address || location.label})는 서울이 아니에요. 어디서 출발하는지 알려 주세요.`
                : '현재 위치가 서울이 아니에요. 어디서 출발하는지 알려 주세요.',
              location.supported ? location : null,
            ),
          )
      } catch (error) {
        if (id !== attempt) return
        set(
          needsInput(
            `${error instanceof Error && error.message ? error.message : '현재 위치를 확인하지 못했어요.'} 출발지를 입력해 주세요.`,
          ),
        )
      }
    },
    (error) => {
      if (id !== attempt) return
      set(
        needsInput(
          error.code === 1
            ? '위치 권한이 없어요. 어디서 출발하는지 입력해 주세요.'
            : '현재 위치를 확인하지 못했어요. 출발지를 입력해 주세요.',
        ),
      )
    },
    { timeout: 10000, maximumAge: 60000 },
  )
}
/** Locate once per session, unless a departure is already stored. */
export function startOrigin() {
  if (state.status === 'idle') locateOrigin()
}
/** Tests: forget the shared departure. */
export function resetOrigin() {
  attempt++
  set({ location: null, source: null, status: 'idle', message: null, detected: null, open: false })
}
