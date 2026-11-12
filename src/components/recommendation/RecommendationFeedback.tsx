import { useAppState } from '../../state/useAppState'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'

export default function RecommendationFeedback() {
  const { ui, result, retryRecommendation } = useAppState()
  const failure = ui.apiFailure
  const remaining = useSecondsRemaining(failure?.retryAt)
  if (!failure) return null
  const chat = failure.kind === 'chat'
  const routes = failure.kind === 'retry-routes'
  return (
    <div className="sn-state is-error" role="alert">
      <strong>
        {chat
          ? '대화 요청을 완료하지 못했어요'
          : routes
            ? '같은 후보를 재확인하지 못했어요'
            : '추천 요청을 완료하지 못했어요'}
      </strong>
      <p>
        {failure.message}
        {result && ' 이전 추천 결과와 조회 시각을 유지하고 있어요.'}
      </p>
      {failure.canResend && <p>처리 결과를 확인하기 위해 같은 요청을 다시 전송할 수 있어요.</p>}
      {remaining > 0 && <p>{remaining}초 후 다시 시도할 수 있어요.</p>}
      {(failure.canResend || failure.retryable) && (
        <button
          type="button"
          disabled={ui.busy || remaining > 0}
          onClick={() => void retryRecommendation()}
        >
          {failure.canResend
            ? '같은 요청 다시 확인'
            : chat
              ? '메시지 다시 시도'
              : routes
                ? '같은 후보 다시 시도'
                : '추천 다시 시도'}
        </button>
      )}
    </div>
  )
}
