import { useEffect, useState } from 'react'
import { queryApi, QueryError, type ParkingDetail } from '../../api/queries'
import { useParkingData } from '../../hooks/useParkingData'
import { withParkingDetail } from '../../api/parking/parkingApi'
import type { ParkingLot } from '../../types/parking'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'
import { dateLabel } from '../../lib/domain.js'
import InformationMeta from '../common/InformationMeta'
import { FactRows, LoadingNote, SecondaryButton } from '../common/ui'
import { sourceName } from '../../lib/sourceNames'

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
  const won = (value: number | null | undefined, minutes?: number | null) =>
    value === null || value === undefined
      ? '미확인'
      : `${minutes ? `${minutes}분 ` : ''}${value.toLocaleString('ko-KR')}원`
  return (
    <section className="sn-parking-detail" aria-label="주차 등록 상세">
      <strong>{lot.name}</strong>
      <p className="sn-note">현재 빈자리와 외부 차량 이용 가능 여부는 미확인이에요.</p>
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <LoadingNote>등록 자료를 조회하고 있어요…</LoadingNote>}
      {detail && (
        <p className="sn-meta">
          상세 조회 {dateLabel(detail.checked_at)} ·{' '}
          {detail.identity_status === 'verified' ? '시설 식별 확인' : '시설 식별 미확인'}
        </p>
      )}
      {records.map((record, index) => {
        const value = record.registered.value,
          fees = value?.fees,
          hours = value?.operating_hours
        return (
          <details key={record.source_record_id} open={index === 0}>
            <summary>{sourceName(record.source)} 등록 정보</summary>
            <FactRows
              rows={[
                ['주소', value?.address || '미확인'],
                [
                  '등록면수',
                  value?.registered_capacity === null || value?.registered_capacity === undefined
                    ? '미확인'
                    : `${value.registered_capacity}면`,
                ],
                ['기본요금', won(fees?.base_fee_krw, fees?.base_minutes)],
                ['추가요금', won(fees?.additional_fee_krw, fees?.additional_minutes)],
                ['일 최대요금', won(fees?.daily_max_krw)],
                ['평일', hours?.weekdays || '미확인'],
                ['토요일', hours?.saturday || '미확인'],
                ['일·공휴일', hours?.sunday_holidays || '미확인'],
                ...(record.reference_date
                  ? [['등록 기준일', record.reference_date] as [string, string]]
                  : []),
              ]}
            />
            {fees?.notes && <p className="sn-note">{fees.notes}</p>}
            {hours?.notes && <p className="sn-note">{hours.notes}</p>}
            <InformationMeta information={record.registered} />
          </details>
        )
      })}
      {wait > 0 && <p className="sn-note">{wait}초 후 다시 조회할 수 있어요.</p>}
      {error && (
        <SecondaryButton disabled={wait > 0} onClick={() => setAttempt((v) => v + 1)}>
          주차 상세 다시 조회
        </SecondaryButton>
      )}
    </section>
  )
}
