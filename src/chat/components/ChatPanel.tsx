import { useEffect, useEffectEvent, useRef } from 'react'
import Icon from '../../components/common/Icon'
import {
  LoadingNote,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
} from '../../components/common/ui'
import { PanelTabs } from '../../components/common/PanelTabs'
import { setMapOverlay, type Route } from '../../hooks/useRoute'
import { selectRecommendation } from '../state/recommendations'
import type { ChatController } from '../state/controller'
import {
  ChatContext,
  sharedController,
  useChatController,
  useChatLifecycle,
  useChatState,
} from '../state/useChat'
import { prefill } from './actions'
import { ChatComposer } from './ChatComposer'
import { ConditionsSummary } from './ConditionsSummary'
import { TurnView } from './TurnView'
import {
  RecommendationPanel,
  SavedRecommendations,
  type RecommendationNotice,
} from './RecommendationPanel'
import '../chat.css'

const EXAMPLES = [
  '성수 카페 추천해줘',
  '셋이서 강남 전시 보고 싶어',
  '서울역 근처 식사할 곳 찾아줘',
]

function Timeline({ onShowMap }: { onShowMap?: () => void }) {
  const controller = useChatController()
  const state = useChatState()
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const lastTop = useRef(0)
  const last = state.turns[state.turns.length - 1]
  const lastKey = useRef<string | null>(null)
  const lastTurnKey = last?.key ?? null
  // Follow new output, but never yank the view while the user reads older messages.
  // Sending a new message (e.g. from an older card) always jumps back to the latest turn.
  useEffect(() => {
    const element = log.current
    // A new turn at the END (not older pages prepended at the top) re-pins to the bottom.
    if (lastTurnKey && lastTurnKey !== lastKey.current) pinned.current = true
    lastKey.current = lastTurnKey
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [lastTurnKey, last?.phase, last?.run?.stage])
  // "결과 보기" for an already-used choice: scroll that run into view once.
  useEffect(() => {
    const runId = state.focusRunId
    if (!runId) return
    const element = log.current?.querySelector<HTMLElement>(`[data-run="${CSS.escape(runId)}"]`)
    if (element) {
      pinned.current = false
      element.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      controller.clearFocus()
    }
  }, [state.focusRunId, state.turns, controller])
  // The footer grows when a reply/target chip appears, which shrinks the log: stay at the end.
  useEffect(() => {
    const element = log.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (pinned.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      className="sn-chat-scroll sn-chat-log"
      ref={log}
      role="log"
      tabIndex={0}
      aria-live="polite"
      aria-label="AI 대화 기록"
      onScroll={(event) => {
        // Only the user scrolling up un-pins; a shrinking log (footer chips) must not.
        const el = event.currentTarget
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) pinned.current = true
        else if (el.scrollTop < lastTop.current - 2) pinned.current = false
        lastTop.current = el.scrollTop
      }}
    >
      {state.history.cursor && (
        <button
          type="button"
          className="sn-more-button"
          disabled={state.history.loading}
          onClick={() => {
            // Keep the reader in place while older messages are prepended.
            pinned.current = false
            void controller.loadOlder()
          }}
        >
          {state.history.loading ? '이전 대화를 불러오는 중…' : '이전 대화 더 보기'}
        </button>
      )}
      {state.history.loading && !state.turns.length && (
        <LoadingNote>대화 기록을 불러오고 있어요…</LoadingNote>
      )}
      {state.history.failed && (
        <div className="sn-chat-problem" role="alert">
          <p>대화 기록을 불러오지 못했어요.</p>
          <SecondaryButton
            className="is-compact"
            onClick={() =>
              void (state.history.cursor ? controller.loadOlder() : controller.loadHistory())
            }
          >
            <Icon name="refresh" />
            다시 불러오기
          </SecondaryButton>
        </div>
      )}
      {state.turns.length === 0 &&
        state.boot === 'ready' &&
        !state.history.loading &&
        !state.history.failed && (
          <div className="sn-chat-empty">
            <p className="sn-chat-empty">
              어디서 무엇을 하고 싶은지 편하게 말해 주세요. 출발지나 인원은 필요할 때만 물어볼게요.
            </p>
            <div className="sn-chat-follow" role="group" aria-label="예시 문장">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => prefill(controller, example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      {state.turns.map((turn) => (
        <TurnView key={turn.key} turn={turn} onShowMap={onShowMap} />
      ))}
    </div>
  )
}

function BootState() {
  const controller = useChatController()
  const state = useChatState()
  if (state.boot === 'loading') return <LoadingNote>대화를 준비하고 있어요…</LoadingNote>
  if (state.boot === 'error')
    return (
      <div className="sn-state is-error" role="alert">
        <strong>대화를 시작하지 못했어요</strong>
        <p>연결을 확인한 뒤 다시 시도해 주세요.</p>
        <SecondaryButton onClick={() => void controller.boot()}>다시 시도</SecondaryButton>
      </div>
    )
  if (state.boot === 'expired' || state.boot === 'unauthorized')
    return (
      <div className="sn-state" role="alert">
        <strong>
          {state.boot === 'expired' ? '대화가 만료됐어요' : '세션을 확인할 수 없어요'}
        </strong>
        <p>지난 질문과 버튼은 더 이상 실행할 수 없어요. 새 대화를 시작해 주세요.</p>
        <PrimaryButton onClick={controller.restart}>새 대화 시작</PrimaryButton>
      </div>
    )
  return null
}

function Notice() {
  const controller = useChatController()
  const { notice, boot } = useChatState()
  if (!notice || boot !== 'ready') return null
  return (
    <div className="sn-banner sn-chat-notice" role="status">
      <p>{notice}</p>
      <button type="button" className="sn-link" onClick={controller.dismissNotice}>
        닫기
      </button>
    </div>
  )
}

function RegionNotice({ onNotify }: { onNotify?: RecommendationNotice }) {
  const state = useChatState()
  const previous = useRef<{ conversation: string; label: string | null } | null>(null)
  const notify = useEffectEvent((text: string) => onNotify?.(text))
  const snapshot = state.snapshot
  const conversation = snapshot?.conversation_id
  const label = snapshot?.search_area?.label ?? null
  useEffect(() => {
    if (!conversation || state.boot !== 'ready') return
    const old = previous.current
    previous.current = { conversation, label }
    if (old && old.conversation !== conversation) {
      selectRecommendation(null)
      setMapOverlay({ recommendation: null, lookup: null })
      notify('새 대화를 시작했어요. 이전 대화의 조건은 이어받지 않아요.')
      return
    }
    if (old?.conversation === conversation && old.label !== label && label) {
      notify(`검색 범위: ${label}`)
    }
  }, [conversation, label, state.boot])
  return null
}

export function ChatBody({
  go,
  onShowMap,
}: {
  go: (route: Route) => void
  onShowMap?: () => void
}) {
  const controller = useChatController()
  const state = useChatState()
  const locked = controller.busy || !!state.busyAction || state.boot === 'loading'
  return (
    <>
      <PanelTabs route="chat" go={go} />
      <PanelHeader
        title="AI 대화"
        actions={
          <div className="sn-chat-header-actions">
            <SecondaryButton
              className="is-compact"
              disabled={locked}
              title={
                controller.busy
                  ? '응답을 중지하거나 완료한 뒤 새 대화를 시작할 수 있어요'
                  : '이전 조건 없이 새로 시작'
              }
              onClick={() => void controller.newConversation()}
            >
              <Icon name="plus" />
              {state.busyAction === 'new' ? '시작하는 중…' : '새 대화'}
            </SecondaryButton>
            {onShowMap && (
              <button type="button" className="sn-chat-map-button" onClick={onShowMap}>
                <Icon name="map" /> 지도 보기
              </button>
            )}
          </div>
        }
        subtitle={<ConditionsSummary key={state.snapshot?.conversation_id} />}
      />
      <Notice />
      <BootState />
      <Timeline onShowMap={onShowMap} />
      <footer className="sn-chat-foot">
        <ChatComposer />
      </footer>
    </>
  )
}

export default function ChatPanel({
  go,
  onShowMap,
  onNotify,
  view = 'chat',
  controller = sharedController(),
}: {
  go: (route: Route) => void
  onShowMap?: () => void
  onNotify?: RecommendationNotice
  view?: 'chat' | 'recommend' | 'saved'
  controller?: ChatController
}) {
  useChatLifecycle(controller)
  return (
    <ChatContext.Provider value={controller}>
      <RegionNotice onNotify={onNotify} />
      {view === 'chat' ? (
        <ChatBody go={go} onShowMap={onShowMap} />
      ) : view === 'recommend' ? (
        <>
          <RecommendationPanel go={go} onShowMap={onShowMap} onNotify={onNotify} />
          <BootState />
        </>
      ) : (
        <SavedRecommendations go={go} />
      )}
    </ChatContext.Provider>
  )
}
