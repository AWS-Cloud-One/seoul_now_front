import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient, ApiTransportError } from '../api/client'
import type { ApiError, PlaceDetailData, ServerTrip, TravelTimeData } from '../api/contracts'
import { RequestManager } from '../api/requestManager'
import { resultContextStatus } from './apiState'
import { useSecondsRemaining } from './useSecondsRemaining'
import type { Result } from './types'

type Failure = { message: string; retryAt: number; canResend: boolean; retryable: boolean }
type Lookup<T> = { data: T | null; busy: boolean; failure: Failure | null }
const idle = <T>(): Lookup<T> => ({ data: null, busy: false, failure: null })
const unavailable =
  '조회 가능한 시간이 지났거나 결과 문맥을 확인할 수 없어요. 저장된 장소와 원래 조회 시각은 유지돼요. 새 추천을 받으면 다시 조회할 수 있어요.'

/** Mounted with a key containing trip, current version, result and place. No snapshot writes. */
export function usePlaceInspection(result: Result, server: ServerTrip, placeId: string) {
  const [context] = useState(() => ({
    result: structuredClone(result),
    placeId,
    scope: { tripId: server.tripId, version: server.version, resultId: result.id },
  }))
  const [detail, setDetail] = useState<Lookup<PlaceDetailData>>(idle)
  const [travel, setTravel] = useState<Lookup<TravelTimeData>>(idle)
  const [invalid, setInvalid] = useState<string | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  const detailRetryAt = useRef(0)
  const travelRequests = useRef(new RequestManager())
  const remaining = useSecondsRemaining(
    Date.parse(context.result.api!.result.context_expires_at || ''),
  )
  const expired = remaining <= 0 || resultContextStatus(context.result) !== 'available'
  const contextError = invalid || (expired ? unavailable : null)
  useEffect(() => {
    if (!expired) return
    detailRequest.current?.abort()
    detailRequest.current = null
    travelRequests.current.cancel()
  }, [expired])
  const invalidate = useCallback((error: ApiError | null) => {
    if (
      error &&
      ['CONTEXT_EXPIRED', 'INVALID_CONTEXT', 'CONTEXT_CONDITIONS_MISMATCH'].includes(error.code)
    ) {
      setInvalid(error.message + ' ' + unavailable)
      setDetail((old) => ({ ...old, busy: false }))
      setTravel((old) => ({ ...old, busy: false }))
    }
  }, [])
  const loadDetail = useCallback(async () => {
    if (
      detailRequest.current ||
      detailRetryAt.current > Date.now() ||
      invalid ||
      resultContextStatus(context.result) !== 'available'
    )
      return
    const request = new AbortController()
    detailRequest.current = request
    setDetail((old) => ({ ...old, busy: true, failure: null }))
    try {
      const response = await apiClient.request<PlaceDetailData>(
        `/places/${encodeURIComponent(context.placeId)}`,
        {
          headers: { 'Result-Context': context.result.api!.result.context_token! },
          signal: request.signal,
        },
      )
      if (request.signal.aborted) return
      if (resultContextStatus(context.result) !== 'available') {
        setInvalid(unavailable)
        return
      }
      const data = response.envelope.data
      if (!response.ok) {
        invalidate(response.envelope.error)
        detailRetryAt.current = Date.now() + (response.retryAfterSeconds || 0) * 1000
        setDetail((old) => ({
          ...old,
          busy: false,
          failure: {
            message: response.envelope.error!.message,
            retryAt: detailRetryAt.current,
            canResend: false,
            retryable: response.envelope.error!.retryable,
          },
        }))
        return
      }
      if (
        !data ||
        data.result_id !== context.result.id ||
        data.place.value?.place_id !== context.placeId ||
        !Number.isFinite(Date.parse(data.checked_at))
      )
        throw new ApiTransportError('protocol', '다른 장소 또는 잘못된 상세 응답을 받았어요.')
      setDetail({ data, busy: false, failure: null })
    } catch (error) {
      if (!request.signal.aborted)
        setDetail((old) => ({
          ...old,
          busy: false,
          failure: {
            message: error instanceof Error ? error.message : '상세 정보를 조회하지 못했어요.',
            retryAt: 0,
            canResend: false,
            retryable: true,
          },
        }))
    } finally {
      if (detailRequest.current === request) detailRequest.current = null
    }
  }, [context, invalid, invalidate])
  useEffect(() => {
    const manager = travelRequests.current
    void loadDetail()
    return () => {
      detailRequest.current?.abort()
      detailRequest.current = null
      manager.cancel()
    }
  }, [loadDetail])
  async function loadTravel() {
    const manager = travelRequests.current
    if (invalid || resultContextStatus(context.result) !== 'available') return
    const attempt = manager.canResend
      ? manager.retry(context.scope)
      : manager.start(context.scope, `/places/${encodeURIComponent(context.placeId)}/travel-time`, {
          trip_id: context.scope.tripId,
          condition_version: context.scope.version,
          result_id: context.result.id,
          context_token: context.result.api!.result.context_token,
        })
    if (!attempt) return
    setTravel((old) => ({ ...old, busy: true, failure: null }))
    try {
      const response = await apiClient.request<TravelTimeData>(attempt.path, {
        method: 'POST',
        body: attempt.body,
        signal: attempt.signal,
      })
      if (!manager.isCurrent(attempt, context.scope)) return
      if (resultContextStatus(context.result) !== 'available') {
        manager.cancel()
        setInvalid(unavailable)
        return
      }
      const data = response.envelope.data
      if (response.envelope.request_id !== attempt.requestId)
        throw new ApiTransportError('protocol', '요청과 응답의 식별자가 일치하지 않아요.')
      if (!response.ok) {
        invalidate(response.envelope.error)
        const unknown = response.envelope.error?.code === 'REQUEST_IN_PROGRESS'
        manager.finish(attempt, unknown ? 'unknown' : 'received', response.retryAfterSeconds)
        setTravel((old) => ({
          ...old,
          busy: false,
          failure: {
            message: response.envelope.error!.message,
            retryAt: Date.now() + (response.retryAfterSeconds || 0) * 1000,
            canResend: unknown,
            retryable: response.envelope.error!.retryable,
          },
        }))
        return
      }
      if (
        !data ||
        data.trip_id !== context.scope.tripId ||
        data.base_condition_version !== context.scope.version ||
        data.result_id !== context.result.id ||
        data.place_id !== context.placeId ||
        !Number.isFinite(Date.parse(data.checked_at)) ||
        (data.route.status === 'available' &&
          (!data.route.value ||
            !Number.isFinite(data.route.value.duration_seconds) ||
            data.route.value.duration_seconds < 0 ||
            !Number.isFinite(data.route.value.distance_meters) ||
            data.route.value.distance_meters < 0))
      )
        throw new ApiTransportError(
          'protocol',
          '이동시간 응답의 장소나 여행 조건을 확인할 수 없어요.',
        )
      manager.finish(attempt, 'received', response.retryAfterSeconds)
      setTravel({ data, busy: false, failure: null })
    } catch (error) {
      if (!manager.isCurrent(attempt, context.scope)) return
      manager.finish(attempt, 'unknown')
      setTravel((old) => ({
        ...old,
        busy: false,
        failure: {
          message: error instanceof Error ? error.message : '이동시간을 조회하지 못했어요.',
          retryAt: 0,
          canResend: true,
          retryable: true,
        },
      }))
    }
  }
  return {
    detail: expired ? { ...detail, busy: false } : detail,
    travel: expired ? { ...travel, busy: false } : travel,
    contextError,
    loadDetail,
    loadTravel,
  }
}
