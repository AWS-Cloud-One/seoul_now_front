import { useEffect, useState } from 'react'
import { queryApi, QueryError, type ParkingDetail } from '../../api/queries'
import { useParkingData } from '../parking/useParkingData'
import { withParkingDetail } from '../parking/api'
import type { ParkingLot } from '../parking/types'
import { useSecondsRemaining } from '../useSecondsRemaining'
import { dateLabel } from '../domain.js'
import InformationMeta from './InformationMeta'

export default function ParkingRegistration({ lot }: { lot: ParkingLot }) {
  const [detail, setDetail] = useState<ParkingDetail | null>(lot.api?.detail || null)
  const [error, setError] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const { remember } = useParkingData('map')
  const wait = useSecondsRemaining(retryAt)
  useEffect(() => {
    const controller = new AbortController()
    queryApi<ParkingDetail>(`/parking/${encodeURIComponent(lot.id)}`, {}, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return
        if (data.parking_id !== lot.id) {
          setError('다른 시설의 상세 응답을 받았어요.')
          return
        }
        setDetail(data)
        setError('')
        remember([withParkingDetail(lot, data)])
      },
      (error) => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : '등록 정보를 조회하지 못했어요.')
          setRetryAt(error instanceof QueryError ? error.retryAt : 0)
        }
      },
    )
    return () => controller.abort()
    // A facility ID fixes the query; map pin enrichment must not start another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot.id, attempt, remember])
  const records = detail?.records || lot.api?.facility.records || []
  return (
    <section className="sn-section" aria-label="주차 등록 상세">
      <strong>{lot.name}</strong>
      <p>현재 빈자리와 외부 차량 이용 가능 여부는 미확인이에요.</p>
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <p role="status">등록 자료를 조회하고 있어요…</p>}
      {detail && (
        <p className="sn-note">
          상세 조회: {dateLabel(detail.checked_at)} ·{' '}
          {detail.identity_status === 'verified' ? '시설 식별 확인' : '시설 식별 미확인'}
        </p>
      )}
      {records.map((record) => {
        const value = record.registered.value,
          fees = value?.fees
        return (
          <details key={record.source_record_id}>
            <summary>{record.source} 등록 자료</summary>
            <p>
              {value?.address || '주소 미확인'} · 등록면수 {value?.registered_capacity ?? '미확인'}
            </p>
            <p>
              기본요금:{' '}
              {fees?.base_fee_krw !== null &&
              fees?.base_fee_krw !== undefined &&
              fees.base_minutes !== null
                ? `${fees.base_minutes}분 ${fees.base_fee_krw.toLocaleString('ko-KR')}원`
                : '미확인'}
            </p>
            <p>
              추가요금:{' '}
              {fees?.additional_fee_krw !== null &&
              fees?.additional_fee_krw !== undefined &&
              fees.additional_minutes !== null
                ? `${fees.additional_minutes}분 ${fees.additional_fee_krw.toLocaleString('ko-KR')}원`
                : '미확인'}
            </p>
            <p>
              일 최대요금:{' '}
              {fees?.daily_max_krw === null || fees?.daily_max_krw === undefined
                ? '미확인'
                : `${fees.daily_max_krw.toLocaleString('ko-KR')}원`}
            </p>
            {fees?.notes && <p>{fees.notes}</p>}
            <p>
              평일: {value?.operating_hours?.weekdays || '미확인'}
              <br />
              토요일: {value?.operating_hours?.saturday || '미확인'}
              <br />
              일·공휴일: {value?.operating_hours?.sunday_holidays || '미확인'}
            </p>
            {value?.operating_hours?.notes && <p>{value.operating_hours.notes}</p>}
            {record.reference_date && <p>등록 기준일: {record.reference_date}</p>}
            <InformationMeta information={record.registered} />
          </details>
        )
      })}
      {wait > 0 && <p>{wait}초 후 다시 조회할 수 있어요.</p>}
      {error && (
        <button type="button" disabled={wait > 0} onClick={() => setAttempt((v) => v + 1)}>
          주차 상세 다시 조회
        </button>
      )}
    </section>
  )
}
