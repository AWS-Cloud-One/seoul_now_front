import type { Information } from '../../api/contracts'
import { dateLabel } from '../../lib/domain.js'
import { sourceName } from '../../lib/sourceNames'

// One short source line under a value. Availability and freshness stay visible (users must be
// able to tell missing, failed and old values apart); internal reason codes are only translated
// when they add something the status does not already say.
const statuses: Record<Information<unknown>['status'], string | null> = {
  available: null,
  unavailable: '미확인',
  unsupported: '제공하지 않음',
  error: '조회 오류',
}
const freshness: Record<Information<unknown>['freshness'], string | null> = {
  fresh: null,
  stale: '오래된 정보',
  unknown: '최신성 미확인',
  not_applicable: null,
}
const reasons: Record<string, string> = {
  NOT_OBSERVED: '관측값 없음',
  NOT_SUPPORTED: '이 지역은 제공하지 않음',
  STALE: '갱신 지연',
}
export default function InformationMeta({ information }: { information: Information<unknown> }) {
  const parts = [
    statuses[information.status],
    sourceName(information.source),
    information.observed_at && `관측 ${dateLabel(information.observed_at)}`,
    information.collected_at && `수집 ${dateLabel(information.collected_at)}`,
    freshness[information.freshness],
    information.reason_code && reasons[information.reason_code],
  ].filter(Boolean)
  return (
    <p
      className="sn-meta"
      title={information.reason_code ? `사유 코드: ${information.reason_code}` : undefined}
    >
      {parts.join(' · ')}
    </p>
  )
}
