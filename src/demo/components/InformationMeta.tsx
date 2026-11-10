import type { Information } from '../../api/contracts'
import { dateLabel } from '../domain.js'

const statuses = {
  available: '확인됨',
  unavailable: '미확인',
  unsupported: '제공하지 않음',
  error: '조회 오류',
}
const freshness = {
  fresh: '최신',
  stale: '오래된 정보',
  unknown: '최신성 미확인',
  not_applicable: '최신성 비교 대상 아님',
}
const sources: Record<string, string> = {
  kakao: '카카오',
  kakao_local: '카카오 장소',
  kakao_mobility: '카카오모빌리티',
}
export default function InformationMeta({ information }: { information: Information<unknown> }) {
  return (
    <p className="sn-note">
      {statuses[information.status]} · {freshness[information.freshness]} · 출처:{' '}
      {information.source ? sources[information.source] || information.source : '미확인'}
      {information.observed_at && (
        <>
          <br />
          원천 시각: {dateLabel(information.observed_at)}
        </>
      )}
      {information.collected_at && (
        <>
          <br />
          수집 시각: {dateLabel(information.collected_at)}
        </>
      )}
      {information.reason_code && (
        <>
          <br />
          미확인 사유: {information.reason_code}
        </>
      )}
    </p>
  )
}
