import Icon from '../../components/common/Icon'
import { SecondaryButton, StatusBadge } from '../../components/common/ui'
import type { ActionView, ChatResponse, QuestionView } from '../api/types'
import { placeName } from '../model/turns'
import type { ChatController } from '../state/controller'
import { useChatController, useChatState } from '../state/useChat'
import { COMPOSER_ID } from './actions'

function Option({
  action,
  question,
  controller,
  blocked,
}: {
  action: ActionView
  question: QuestionView
  controller: ChatController
  blocked: boolean
}) {
  const { refs } = useChatState()
  const detail =
    action.description ?? (action.target_ref ? placeName(refs, action.target_ref) : null)
  if (action.status === 'consumed')
    return (
      <button
        type="button"
        className="is-consumed"
        disabled={!action.consumed_by_run_id}
        onClick={() => action.consumed_by_run_id && controller.showRun(action.consumed_by_run_id)}
      >
        <strong>{action.label}</strong>
        <span>선택한 항목 · 결과 보기</span>
      </button>
    )
  const usable = controller.actionUsable(action)
  return (
    <button
      type="button"
      disabled={!usable || blocked}
      onClick={() => void controller.choose(action, question)}
    >
      <strong>{action.label}</strong>
      {detail && <span>{detail}</span>}
      {action.status === 'busy' && <span>다른 요청을 처리하는 중이에요</span>}
    </button>
  )
}

/**
 * Structured question (P5): server choices run deterministically as actions; free text is
 * always allowed. Older P4 records without a question are shown as text only.
 */
export function QuestionPanel({
  question,
  response,
  isDefaultReply,
}: {
  question: QuestionView | null
  response: ChatResponse
  isDefaultReply: boolean
}) {
  const controller = useChatController()
  const state = useChatState()
  if (!question) {
    const asked = response.clarification
    if (!asked) return null
    const legacy = response.origin_options ?? []
    return (
      <div className="sn-chat-question">
        {asked.question !== response.answer && <p className="sn-chat-ask">{asked.question}</p>}
        {legacy.length > 0 && (
          <ul className="sn-chat-legacy" aria-label="당시 출발지 후보">
            {legacy.map((option) => (
              <li key={option.option_id}>
                {option.position}. {option.location.label}
                {option.location.address && ` · ${option.location.address}`}
              </li>
            ))}
          </ul>
        )}
        <p className="sn-chat-sub">이전 형식의 질문이에요. 답하려면 입력창에 직접 적어 주세요.</p>
      </div>
    )
  }
  const active = question.status === 'active'
  const options = active ? question.options : []
  const blocked = !controller.canSend
  const anyRefresh = options.some((o) => o.status !== 'consumed' && !controller.actionUsable(o))
  return (
    <div className="sn-chat-question">
      {question.prompt !== response.answer && <p className="sn-chat-ask">{question.prompt}</p>}
      {!active ? (
        <p className="sn-chat-sub">
          <StatusBadge tone="neutral">답변 완료</StatusBadge> 지난 질문이에요.
        </p>
      ) : (
        <>
          {options.length > 0 && (
            <ul className="sn-chat-options" aria-label={`${question.prompt} 선택지`}>
              {options.map((action) => (
                <li key={action.action_id}>
                  <Option
                    action={action}
                    question={question}
                    controller={controller}
                    blocked={blocked}
                  />
                </li>
              ))}
            </ul>
          )}
          {anyRefresh && (
            <SecondaryButton
              className="is-compact"
              disabled={state.boot !== 'ready'}
              onClick={() => void controller.refreshConversation()}
            >
              <Icon name="refresh" />
              선택지 새로 받기
            </SecondaryButton>
          )}
          <p className="sn-chat-sub">
            {options.length ? '고르거나 ' : ''}입력창에 직접 답해도 돼요.
            {!isDefaultReply && ' 입력으로 이 질문에 답하려면 먼저 아래 버튼을 눌러 주세요.'}
          </p>
          {!isDefaultReply && (
            <button
              type="button"
              className="sn-link"
              disabled={state.boot !== 'ready'}
              onClick={() => {
                controller.setComposer({
                  reply: { clarificationId: question.clarification_id, question: question.prompt },
                })
                requestAnimationFrame(() => document.getElementById(COMPOSER_ID)?.focus())
              }}
            >
              이 질문에 답하기
            </button>
          )}
        </>
      )}
    </div>
  )
}
