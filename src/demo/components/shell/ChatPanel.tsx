import { useEffect, useRef, useState } from 'react'
import { conditionText, dateLabel, placeById } from '../../domain.js'
import { useDemo } from '../../useDemo'
import Icon from '../Icon'
import { useLayout } from './layout'
import { SelectionSummary } from './MapOverlays'
import { PanelHeader } from './ui'
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

export default function ChatPanel({ go }: { go: (route: Route) => void }) {
  const { active, result, ui, submitChat, updateChatDraft, selectPlace, openDetail } = useDemo()
  const { wide } = useLayout()
  const [text, setText] = useState(active.workspaceView?.chatDraft || '')
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const selected = placeById(active.selected)
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
        subtitle={
          <span className="sn-summary">
            {active.onboardingComplete
              ? `${conditionText(result?.conditions || active.conditions)}${selected ? ` · 선택: ${selected.name}` : ''}`
              : '출발지와 방문 목적을 먼저 정해 주세요.'}
          </span>
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
        <div className="sn-ai-samples">
          {samples.map((sample) => (
            <button type="button" key={sample} onClick={() => send(sample)} disabled={ui.busy}>
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
