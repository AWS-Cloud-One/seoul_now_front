import { resultContextStatus } from '../../state/apiState'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'
import type { Result } from '../../types/trip'

export default function ResultContextNotice({ result }: { result: Result }) {
  useSecondsRemaining(Date.parse(result.api?.result.context_expires_at || ''))
  if (!result.api || resultContextStatus(result) === 'available') return null
  return (
    <p className="sn-banner" role="status">
      현재 정보를 조회할 수 있는 시간이 지났어요. 장소와 원래 조회 시각은 유지하며, 새 추천을 받으면
      다시 조회할 수 있어요.
    </p>
  )
}
