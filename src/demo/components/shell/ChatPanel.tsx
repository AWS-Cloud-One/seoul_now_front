import { useEffect, useId, useRef, useState } from 'react'
import { conditionText, dateLabel, placeById } from '../../domain.js'
import { useDemo } from '../../useDemo'
import Icon from '../Icon'
import { useLayout } from './layout'
import { SelectionSummary } from './MapOverlays'
import { ErrorState, PanelHeader } from './ui'
import { focusMap } from './useRoute'
import type { Route } from './useRoute'

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
    retryChat,
    retrySearch,
    updateChatDraft,
    selectPlace,
    openDetail,
  } = useDemo()
  const { wide } = useLayout()
  const [text, setText] = useState(active.workspaceView?.chatDraft || '')
  const [samplesOpen, setSamplesOpen] = useState(false)
  const samplesId = useId()
  const samplesToggle = useRef<HTMLButtonElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const selected = placeById(active.selected)
  const conditions = result?.conditions || active.conditions
  const samples = result
    ? [
        selected ? `${selected.name}은 왜 추천했어?` : '여긴 왜 추천했어?',
        '더 조용한 곳 있어?',
        '주차 편한 곳으로 바꿔줘',
        '식사로 바꾸고 40분까지',
      ]
    : ['서울역에서 카페', '강남역에서 전시']

  // New messages stack at the bottom, but never yank the view while the user reads older ones.
  useEffect(() => {
    const element = log.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [active.chat.length, ui.busy])

  const send = (value: string) => {
    if (!value.trim() || ui.busy) return
    if (!active.onboardingComplete) {
      void submitChat(value)
      return
    }
    pinned.current = true
    void submitChat(value)
    setText('')
    updateChatDraft('')
  }
  const showPlace = (name?: string) => {
    const entry = result?.entries.find((e) => placeById(e.id)?.name === name)
    const place = placeById(entry?.id)
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
                : '출발지와 방문 목적을 먼저 정해 주세요.'}
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
                출발지와 방문 목적을 먼저 정해 주세요.
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
              <button type="button" className="sn-link" onClick={() => showPlace(message.place)}>
                {message.place} 지도에서 보기
              </button>
            )}
            <time dateTime={message.time}>{dateLabel(message.time)}</time>
          </div>
        ))}
        {ui.busy && (
          <div className="sn-bubble is-pending">{ui.progress?.detail || '답을 찾는 중이에요…'}</div>
        )}
      </div>
      <footer className="sn-chat-foot">
        {ui.chatFailure?.tripId === active.trip && (
          <ErrorState title="답변을 받지 못했어요" onRetry={() => void retryChat()}>
            연결이 끊겼거나 응답 시간이 초과됐어요. 다시 시도하면 같은 메시지를 보내요.
          </ErrorState>
        )}
        {ui.notice && (
          <ErrorState title="추천 요청을 완료하지 못했어요" onRetry={() => void retrySearch()}>
            {ui.notice.text}
          </ErrorState>
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
                send(sample)
                setSamplesOpen(false)
                if (window.matchMedia('(max-width: 900px)').matches)
                  samplesToggle.current?.focus({ preventScroll: true })
              }}
              disabled={ui.busy}
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
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              updateChatDraft(event.target.value)
            }}
            aria-label="AI에게 보낼 메시지"
            placeholder="예: 더 조용한 곳으로 바꿔줘"
          />
          <button type="submit" aria-label="보내기" disabled={ui.busy || !text.trim()}>
            <Icon name="send" />
          </button>
        </form>
      </footer>
    </>
  )
}
