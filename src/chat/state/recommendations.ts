import { useSyncExternalStore } from 'react'
import type { PublishedRecommendation } from '../api/types'
import type { Turn } from './controller'

export type SavedRecommendation = {
  recommendation: PublishedRecommendation
  ordinal: number
  savedAt: string
}
const KEY = 'sn-saved-recommendations-v2'
const listeners = new Set<() => void>()
// Only result data is stored here. Session tokens and executable action IDs never are.
function read(): SavedRecommendation[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(value)
      ? value.filter(
          (item) =>
            typeof item?.recommendation?.result_id === 'string' &&
            Array.isArray(item.recommendation.cards) &&
            item.recommendation.effective_conditions &&
            Number.isInteger(item.ordinal) &&
            typeof item.savedAt === 'string',
        )
      : []
  } catch {
    return []
  }
}
let saved = read()
let selectedId: string | null = null
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const useSavedRecommendations = () => useSyncExternalStore(subscribe, () => saved)
export const useSelectedRecommendation = () => useSyncExternalStore(subscribe, () => selectedId)
export function selectRecommendation(id: string | null) {
  selectedId = id
  emit()
}
export function saveRecommendation(recommendation: PublishedRecommendation, ordinal: number) {
  if (saved.some((item) => item.recommendation.result_id === recommendation.result_id)) return true
  const next = [{ recommendation, ordinal, savedAt: new Date().toISOString() }, ...saved]
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    return false
  }
  saved = next
  emit()
  return true
}
export function removeRecommendation(id: string) {
  const next = saved.filter((item) => item.recommendation.result_id !== id)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    return false
  }
  saved = next
  if (selectedId === id) selectedId = null
  emit()
  return true
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return
    saved = read()
    if (!saved.some((item) => item.recommendation.result_id === selectedId)) selectedId = null
    emit()
  })

export function latestRecommendation(turns: Turn[]) {
  return (
    [...turns].reverse().find((turn) => turn.run?.response?.recommendation)?.run?.response
      ?.recommendation ?? null
  )
}
