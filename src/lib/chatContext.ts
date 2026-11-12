import type { Clarification, OriginChoiceValue } from '../api/contracts'
import type { Trip } from '../types/trip'

export function originChoices(clarification: Clarification) {
  return clarification.choices
    .flatMap((choice) => {
      const value = choice.value as Partial<OriginChoiceValue> | null
      return value && typeof value.candidate_id === 'string' && value.location?.label
        ? [{ label: choice.label, value: value as OriginChoiceValue }]
        : []
    })
    .slice(0, 5)
}
export function originContextUnavailable(trip: Trip, now = Date.now()) {
  const context = trip.api?.clarification?.origin_context
  if (!context) return null
  if (trip.api?.clarificationInvalid) return trip.api.clarificationInvalid
  const expires = Date.parse(context.expires_at)
  return !Number.isFinite(expires) || expires <= now
    ? '출발지 확인 시간이 지났어요. 출발지와 원하는 조건을 다시 입력해 주세요.'
    : null
}
export function recentChatMessages(trip: Trip) {
  return trip.chat
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-10)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: [...message.text].slice(0, 500).join(''),
    }))
}
