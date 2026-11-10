import { vi } from 'vitest'
import type { ApiConditions, RecommendationRequest } from './contracts'
import { apiConditions, contextResult, conversation, FIXTURE_TIME } from './testFixtures'

export const screenOrigin = { ...apiConditions.origin!, label: '서울역' }
export function screenRecommendation(request: RecommendationRequest, sequence = 1) {
  const conditions = { ...request.current_conditions, ...request.conditions_patch } as ApiConditions
  const result = contextResult()
  result.conditions = conditions
  result.cards = [1, 2, 3].map((index) => {
    const card = contextResult(crypto.randomUUID(), `real-${sequence}-${index}`).cards[0]
    card.rank = index
    card.place.value!.name = `추천 장소 ${sequence}-${index}`
    card.place.value!.coordinates = { latitude: 37.5505, longitude: 126.98 }
    return card
  })
  return conversation(request, {
    result,
    condition_update: {
      applied: true,
      version: request.condition_version + 1,
      conditions,
      changes: [],
    },
  })
}
export function mockScreenApi() {
  let sequence = 0
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/locations/search'))
      return Response.json({
        request_id: crypto.randomUUID(),
        server_time: FIXTURE_TIME,
        error: null,
        data: { items: [screenOrigin], next_cursor: null },
      })
    if (url.endsWith('/recommendations'))
      return Response.json(screenRecommendation(JSON.parse(options!.body as string), ++sequence))
    throw new Error('Unmocked request')
  })
  vi.stubGlobal('fetch', request)
  return request
}
