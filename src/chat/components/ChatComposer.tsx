import Icon from '../../components/common/Icon'
import { activeQuestions, defaultReply, isActive } from '../model/turns'
import { useChatController, useChatState } from '../state/useChat'
import { COMPOSER_ID } from './actions'

const MAX = 2000

/** Free text is always allowed; chips show what the message will point at, and can be removed. */
export function ChatComposer() {
  const controller = useChatController()
  const state = useChatState()
  const { text, target, reply, dismissedQuestion } = state.composer
  const open = defaultReply(state.turns, state.snapshot)
  const autoReply =
    open && open.turnKey !== dismissedQuestion
      ? { clarificationId: open.question.clarification_id, question: open.question.prompt }
      : null
  // An explicit reply ("이 질문에 답하기") is only valid while that question is still active.
  const explicit =
    reply &&
    activeQuestions(state.snapshot).some((q) => q.clarification_id === reply.clarificationId)
      ? reply
      : null
  const effectiveReply = explicit ?? autoReply
  const active = [...state.turns].reverse().find(isActive)
  const canStop = active?.phase === 'tracking' && active.run && !active.run.cancel_requested_at
  const stopping = active?.cancelling || !!active?.run?.cancel_requested_at
  const stopLabel = stopping
    ? '중지 요청 중'
    : active?.phase === 'sending'
      ? '요청 접수 중'
      : active?.phase === 'unconfirmed'
        ? '접수 여부 확인 필요'
        : '응답 중지'
  const canSend = controller.canSend && !!text.trim()
  return (
    <>
      {(target || effectiveReply) && (
        <div className="sn-chat-chips" aria-label="보낼 메시지의 대상">
          {effectiveReply && (
            <span className="sn-chat-chip">
              <span>답변 · {effectiveReply.question}</span>
              <button
                type="button"
                aria-label="질문에 대한 답변으로 보내지 않기"
                onClick={() =>
                  controller.setComposer({ reply: null, dismissedQuestion: open?.turnKey ?? null })
                }
              >
                <Icon name="close" />
              </button>
            </span>
          )}
          {target && (
            <span className="sn-chat-chip">
              <span>대상 · {target.label}</span>
              <button
                type="button"
                aria-label="대상 지정 해제"
                onClick={() => controller.setComposer({ target: null })}
              >
                <Icon name="close" />
              </button>
            </span>
          )}
        </div>
      )}
      {controller.busy && (
        <p className="sn-chat-sub" role="status">
          응답을 받은 뒤 다음 메시지를 보낼 수 있어요. 입력은 계속 작성할 수 있어요.
        </p>
      )}
      <form
        className="sn-ai-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) void controller.sendComposer(effectiveReply)
        }}
      >
        <input
          id={COMPOSER_ID}
          maxLength={MAX}
          value={text}
          disabled={state.boot !== 'ready'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          onChange={(event) => controller.setComposer({ text: event.target.value })}
          aria-label="AI에게 보낼 메시지"
          placeholder="예: 성수 카페 추천해줘"
        />
        {controller.busy ? (
          <button
            type="button"
            className="sn-chat-stop"
            aria-label={stopLabel}
            title={stopLabel}
            disabled={!canStop || stopping}
            onClick={() => active && void controller.cancel(active.key)}
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" aria-label="보내기" disabled={!canSend}>
            <Icon name="send" />
          </button>
        )}
      </form>
      {text.length > MAX - 200 && (
        <p className="sn-chat-sub" aria-live="polite">
          {text.length}/{MAX}자
        </p>
      )}
    </>
  )
}
