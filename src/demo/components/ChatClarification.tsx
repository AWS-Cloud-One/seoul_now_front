import { originChoices } from '../chatContext'
import { useSecondsRemaining } from '../useSecondsRemaining'
import { useDemo } from '../useDemo'
import type { OriginAction } from '../../api/contracts'

const fields: Record<string, string> = {
  origin: '출발지',
  purposes: '방문 목적',
  headcount: '정확한 인원',
  max_travel_seconds: '이동시간',
  group_type: '함께 가는 사람',
  age_groups: '연령대',
  target: '질문할 장소',
  intent: '원하는 작업',
}
export default function ChatClarification() {
  const { active, ui, submitChat, restartExpiredOrigin, askSelectedPlace } = useDemo()
  const clarification = active.api?.clarification
  const context = clarification?.origin_context
  const remaining = useSecondsRemaining(context ? Date.parse(context.expires_at) : 0)
  const retryWait = useSecondsRemaining(ui.apiFailure?.retryAt)
  if (!clarification) return null
  const invalid = !!context && (remaining <= 0 || !!active.api?.clarificationInvalid)
  const blocked = ui.busy || !!ui.apiFailure?.canResend || retryWait > 0
  const choices = originChoices(clarification)
  const preferred = choices.find(
    (choice) => choice.value.candidate_id === context?.preferred_candidate_id,
  )
  const choose = (message: string, action: OriginAction) =>
    void submitChat(message, { originAction: action })
  const focus = () => document.getElementById('chat-input')?.focus()
  const latestQuestion = [...active.chat].reverse().find((message) => message.role === 'user')?.text
  return (
    <section className="sn-section" aria-label={context ? '출발지 확인' : '추가 질문'}>
      <h3>
        {context?.mode === 'confirmed'
          ? '추가 조건을 알려주세요'
          : context
            ? '출발지를 확인해 주세요'
            : '추가로 알려주세요'}
      </h3>
      <p>{clarification.question}</p>
      {context?.search_limited && (
        <p className="sn-note">
          일부 검색 결과에서 후보를 찾았어요. 원하는 장소가 없으면 지역이나 주소를 더 알려주세요.
        </p>
      )}
      {invalid ? (
        <>
          <p role="status">
            {active.api?.clarificationInvalid ||
              '출발지 확인 시간이 지났어요. 기존 조건과 추천 결과는 유지돼요.'}
          </p>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              restartExpiredOrigin()
              focus()
            }}
          >
            출발지 다시 검색
          </button>
        </>
      ) : context ? (
        <>
          {context.mode === 'confirm' && preferred && (
            <div className="stack">
              <strong>{preferred.value.location.label}</strong>
              <span>{preferred.value.location.address}</span>
              <button
                type="button"
                disabled={blocked}
                onClick={() =>
                  choose(`${preferred.value.location.label}에서 출발할게요`, {
                    action: 'select',
                    context_token: context.context_token,
                    candidate_id: preferred.value.candidate_id,
                  })
                }
              >
                여기서 출발
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() =>
                  choose('다른 출발지 후보를 보여줘', {
                    action: 'show_alternatives',
                    context_token: context.context_token,
                  })
                }
              >
                다른 후보 보기
              </button>
            </div>
          )}
          {context.mode === 'choose' && (
            <ol className="sn-dest-list" aria-label="출발지 후보">
              {choices.map((choice, index) => (
                <li key={choice.value.candidate_id}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      choose(`${index + 1}번 ${choice.value.location.label}에서 출발할게요`, {
                        action: 'select',
                        context_token: context.context_token,
                        candidate_id: choice.value.candidate_id,
                      })
                    }
                  >
                    <span className="sn-place-body">
                      <strong>
                        {index + 1}. {choice.value.location.label}
                      </strong>
                      <span className="sn-place-meta">{choice.value.location.address}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {context.mode === 'confirmed' && (
            <p className="sn-note">
              확인한 출발지: {clarification.pending_patch.origin?.label}. 나머지 조건을 확인한 뒤
              적용해요.
            </p>
          )}
          {context.mode === 'refine' && (
            <button type="button" disabled={blocked} onClick={focus}>
              출발지 입력하기
            </button>
          )}
          {(context.mode === 'confirm' || context.mode === 'choose') && (
            <button
              type="button"
              disabled={blocked}
              onClick={() =>
                choose('출발지를 다시 입력할게요', {
                  action: 'restart',
                  context_token: context.context_token,
                })
              }
            >
              다시 입력
            </button>
          )}
          <p className="sn-note">
            출발지 확인 유효시간 {Math.floor(remaining / 60)}분 {remaining % 60}초
          </p>
        </>
      ) : (
        <>
          {clarification.choices.length > 0 && (
            <div className="stack">
              {clarification.choices.map((choice, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={blocked}
                  onClick={() => void submitChat(choice.label)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
          {clarification.required_fields.includes('target') &&
            active.selected &&
            latestQuestion && (
              <button
                type="button"
                disabled={blocked}
                onClick={() => void askSelectedPlace(latestQuestion)}
              >
                선택한 장소로 다시 질문
              </button>
            )}
        </>
      )}
      {!!clarification.required_fields.length && (
        <p className="sn-note">
          확인할 내용:{' '}
          {clarification.required_fields.map((field) => fields[field] || field).join(' · ')}
        </p>
      )}
    </section>
  )
}
