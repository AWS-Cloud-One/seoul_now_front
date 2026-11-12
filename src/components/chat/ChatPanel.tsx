import { useEffect, useId, useRef, useState } from 'react'
import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { useAppState } from '../../state/useAppState'
import Icon from '../common/Icon'
import { useLayout } from '../../hooks/layout'
import { SelectionSummary } from '../map/MapOverlays'
import { PanelHeader } from '../common/ui'
import ChatClarification from './ChatClarification'
import RecommendationFeedback from '../recommendation/RecommendationFeedback'
import { displayConditions, resultContextStatus } from '../../state/apiState'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'
import { focusMap } from '../../hooks/useRoute'
import type { Route } from '../../hooks/useRoute'
import { recommendationQuestion } from '../../lib/recommendationQuestion'
import ResponsePending from '../common/ResponsePending'

/** Switch between the recommendation list and the AI conversation without leaving the panel. */
export function PanelTabs({
  route,
  go,
}: {
  route: 'recommend' | 'chat'
  go: (route: Route) => void
}) {
  return (
    <div className="sn-tabs" role="tablist" aria-label="추천 패널 보기">
      {(
        [
          ['recommend', '추천 목록'],
          ['chat', 'AI 대화'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={route === key}
          className={route === key ? 'is-on' : ''}
          onClick={() => go(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function ChatPanel({
  go,
  onShowMap,
}: {
  go: (route: Route) => void
  onShowMap?: () => void
}) {
  const {
    active,
    result,
    ui,
    submitChat,
    askSelectedPlace,
    activateResult,
    updateChatDraft,
    selectPlace,
    openDetail,
  } = useAppState()
  const { wide } = useLayout()
  const text = active.workspaceView?.chatDraft || ''
  const retryWait = useSecondsRemaining(ui.apiFailure?.retryAt)
  const blocked = ui.busy || !!ui.apiFailure?.canResend || retryWait > 0
  const [samplesOpen, setSamplesOpen] = useState(false)
  const samplesId = useId()
  const samplesToggle = useRef<HTMLButtonElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const selected = placeById(active.selected, result)
  const conditions = active.api ? displayConditions(active.api.conditions) : active.conditions
  const pending = active.api?.clarification
  useSecondsRemaining(Date.parse(result?.api?.result.context_expires_at || ''))
  const targetAvailable = !!result?.api && resultContextStatus(result) === 'available'
  const samples = pending?.required_fields.includes('headcount')
    ? ['2명', '4명', '6명']
    : pending?.required_fields.includes('purposes')
      ? ['카페', '식사', '산책']
      : result
        ? [
            selected ? recommendationQuestion(selected.name) : '여긴 왜 추천했어?',
            '더 조용한 곳 있어?',
            '주차 편한 곳으로 바꿔줘',
            '식사로 바꾸고 40분까지',
          ]
        : ['서울역에서 카페', '강남역에서 전시']

  // New messages stack at the bottom, but never yank the view while the user reads older ones.
  useEffect(() => {
    const element = log.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [active.chat.length, ui.busy, pending])

  const send = (value: string) => {
    if (!value.trim() || blocked) return
    pinned.current = true
    void submitChat(value)
  }
  const showPlace = (name?: string) => {
    const entry = result?.entries.find((e) => placeById(e.id, result)?.name === name)
    const place = placeById(entry?.id, result)
    if (!entry || !place) return
    selectPlace(entry.id)
    focusMap(place.lat, place.lon, 16)
  }
  return (
    <>
      <PanelTabs route="chat" go={go} />
      <PanelHeader
        title="AI 대화"
        actions={
          onShowMap && (
            <button type="button" className="sn-chat-map-button" onClick={onShowMap}>
              <Icon name="map" /> 지도 보기
            </button>
          )
        }
        subtitle={
          <>
            <span className="sn-summary sn-chat-conditions-desktop">
              {active.onboardingComplete
                ? `${conditionText(conditions)}${selected ? ` · 선택: ${selected.name}` : ''}`
                : '출발지와 하고 싶은 일을 편하게 말해 주세요.'}
            </span>
            {active.onboardingComplete ? (
              <details className="sn-chat-conditions-mobile" key={active.trip}>
                <summary aria-label={`${conditions.departure} · 입력 조건 보기`}>
                  <Icon name="pin" />
                  <span>{conditions.departure}</span>
                  <Icon name="chevronDown" />
                </summary>
                <div className="sn-chat-conditions-body">
                  <p>{conditionText(conditions)}</p>
                  {selected && <p>선택한 장소 · {selected.name}</p>}
                </div>
              </details>
            ) : (
              <span className="sn-chat-conditions-mobile">
                출발지와 하고 싶은 일을 편하게 말해 주세요.
              </span>
            )}
          </>
        }
      />
      {wide && selected && (
        <details className="sn-selected-fold">
          <summary>선택 장소 · {selected.name}</summary>
          <SelectionSummary
            variant="panel"
            onDetail={() => {
              go('recommend')
              openDetail(selected.id)
            }}
            onParking={() => go('parking')}
          />
        </details>
      )}
      <div
        className="sn-chat-scroll"
        ref={log}
        role="log"
        tabIndex={0}
        aria-live="polite"
        aria-label="AI 대화 기록"
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {active.chat.length === 0 && (
          <p className="sn-chat-empty">
            조건을 바꾸거나 “여긴 왜 추천했어?”, “더 조용한 곳 있어?”처럼 물어보세요. 현재
            출발지·조건·선택한 장소를 기억해서 답해요.
          </p>
        )}
        {active.chat.map((message, index) => (
          <div key={index} className={`sn-bubble ${message.role === 'user' ? 'is-user' : ''}`}>
            <p>{message.text}</p>
            {message.role !== 'user' && message.place && (
              <button
                type="button"
                className="sn-chat-action"
                onClick={() => showPlace(message.place)}
              >
                <Icon name="map" />
                <span>{message.place} 지도에서 보기</span>
              </button>
            )}
            {(message.taskResults?.length
              ? message.taskResults.flatMap((task) => (task.answer ? [task.answer] : []))
              : message.answer
                ? [message.answer]
                : []
            ).map((answer, answerIndex) => (
              <span key={answerIndex}>
                {answer.original_recommended_at && (
                  <p className="sn-note">추천 당시: {dateLabel(answer.original_recommended_at)}</p>
                )}
                {answer.checked_at && (
                  <p className="sn-note">현재 정보 조회: {dateLabel(answer.checked_at)}</p>
                )}
              </span>
            ))}
            {message.resultId &&
              [...active.groups, ...(active.general ? [active.general] : [])].some(
                (group) => group.id === message.resultId,
              ) && (
                <button
                  type="button"
                  className="sn-chat-action"
                  onClick={() => {
                    activateResult(message.resultId!)
                    go('recommend')
                  }}
                >
                  <span>이 추천 보기</span>
                  <Icon name="chevronRight" />
                </button>
              )}
            <time dateTime={message.time}>{dateLabel(message.time)}</time>
          </div>
        ))}
        <ChatClarification />
        {ui.busy && (
          <div className="sn-bubble is-pending" role="status">
            <ResponsePending>{ui.progress?.detail || '답을 찾는 중이에요…'}</ResponsePending>
          </div>
        )}
      </div>
      <footer className="sn-chat-foot">
        <RecommendationFeedback />
        {ui.notice && !ui.apiFailure && (
          <p className="sn-note" role="status">
            {ui.notice.text}
          </p>
        )}
        {selected && targetAvailable && (
          <button
            type="button"
            className="sn-chat-action is-suggestion"
            disabled={blocked}
            onClick={() => void askSelectedPlace(recommendationQuestion(selected.name))}
          >
            <Icon name="edit" />
            <span>{selected.name} 추천 이유 묻기</span>
          </button>
        )}
        <button
          type="button"
          className="sn-samples-toggle"
          ref={samplesToggle}
          aria-expanded={samplesOpen}
          aria-controls={samplesId}
          onClick={() => setSamplesOpen(!samplesOpen)}
        >
          <Icon name="edit" />
          조건·질문 예시
          <Icon name={samplesOpen ? 'chevronDown' : 'chevronUp'} />
        </button>
        <div className="sn-ai-samples" id={samplesId} data-expanded={samplesOpen}>
          {samples.map((sample) => (
            <button
              type="button"
              key={sample}
              onClick={() => {
                if (selected && sample === recommendationQuestion(selected.name) && targetAvailable)
                  void askSelectedPlace(sample)
                else send(sample)
                setSamplesOpen(false)
                if (window.matchMedia('(max-width: 900px)').matches)
                  samplesToggle.current?.focus({ preventScroll: true })
              }}
              disabled={blocked}
            >
              {sample}
            </button>
          ))}
        </div>
        <form
          className="sn-ai-form"
          onSubmit={(event) => {
            event.preventDefault()
            send(text)
          }}
        >
          <input
            id="chat-input"
            maxLength={500}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
            }}
            value={text}
            onChange={(event) => {
              updateChatDraft(event.target.value)
            }}
            aria-label="AI에게 보낼 메시지"
            placeholder="예: 더 조용한 곳으로 바꿔줘"
          />
          <button type="submit" aria-label="보내기" disabled={blocked || !text.trim()}>
            <Icon name="send" />
          </button>
        </form>
      </footer>
    </>
  )
}
