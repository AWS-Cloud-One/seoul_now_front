import { expect, it, vi } from 'vitest'
import { RequestManager } from './requestManager'
const scope = { tripId: 'trip', version: 2, resultId: 'result' }
it('중복 클릭을 막고 전송 당시 본문을 고정하며 응답 유실 때 동일 요청을 재전송한다', () => {
  const manager = new RequestManager()
  const body = { conditions_patch: { headcount: 4, max_travel_seconds: null } }
  const first = manager.start(scope, '/recommendations', body)!
  body.conditions_patch.headcount = 9
  expect(manager.start(scope, '/recommendations', body)).toBeNull()
  manager.finish(first, 'unknown')
  const retry = manager.retry(scope)!
  expect(retry.requestId).toBe(first.requestId)
  expect(retry.body).toBe(first.body)
  expect(JSON.parse(retry.body).conditions_patch).toEqual({
    headcount: 4,
    max_travel_seconds: null,
  })
  expect(retry.signal).not.toBe(first.signal)
  expect(manager.isCurrent(first, scope)).toBe(false)
})
it('명시적 실패 응답 이후 새 동작은 새 요청 ID를 사용한다', () => {
  const manager = new RequestManager()
  const first = manager.start(scope, '/recommendations', {})!
  manager.finish(first, 'received')
  expect(manager.retry(scope)).toBeNull()
  expect(manager.start(scope, '/recommendations', {})!.requestId).not.toBe(first.requestId)
})
it('여행·버전·표시 결과가 달라지면 응답 적용과 재전송을 막는다', () => {
  for (const changed of [
    { ...scope, tripId: 'other' },
    { ...scope, version: 3 },
    { ...scope, resultId: null },
  ]) {
    const manager = new RequestManager()
    const attempt = manager.start(scope, '/recommendations', {})!
    expect(manager.isCurrent(attempt, changed)).toBe(false)
    manager.finish(attempt, 'unknown')
    expect(manager.retry(changed)).toBeNull()
  }
})
it('취소된 요청의 늦은 완료가 새 요청을 끝내지 않는다', () => {
  const manager = new RequestManager()
  const first = manager.start(scope, '/recommendations', {})!
  manager.cancel()
  expect(first.signal.aborted).toBe(true)
  const next = manager.start(scope, '/recommendations', {})!
  manager.finish(first, 'unknown')
  expect(manager.isCurrent(next, scope)).toBe(true)
  expect(manager.canResend).toBe(false)
})
it('Retry-After가 지나기 전에는 새 실행과 재전송을 모두 막는다', () => {
  vi.useFakeTimers()
  try {
    const manager = new RequestManager()
    const first = manager.start(scope, '/recommendations', {})!
    manager.finish(first, 'unknown', 5)
    expect(manager.retry(scope)).toBeNull()
    expect(manager.start(scope, '/recommendations', {})).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(manager.retry(scope)?.requestId).toBe(first.requestId)
  } finally {
    vi.useRealTimers()
  }
})
