import { useState } from 'react'
import Icon from '../../components/common/Icon'
import { FactRows, SecondaryButton } from '../../components/common/ui'
import { clock, conditionRows } from '../model/labels'
import { useChatController, useChatState } from '../state/useChat'

/**
 * The conversation's current trip conditions (ConversationSnapshot is the source of truth).
 * Search area and driving origin are separate values; a card's own conditions live on the card.
 */
export function ConditionsSummary() {
  const controller = useChatController()
  const state = useChatState()
  const [confirming, setConfirming] = useState(false)
  const snapshot = state.snapshot
  const rows: [string, string][] = [
    ...(snapshot?.search_area
      ? ([['찾을 지역', snapshot.search_area.label]] as [string, string][])
      : []),
    ...conditionRows(snapshot?.conditions),
  ]
  const locked = controller.busy || !!state.busyAction || state.boot === 'loading'
  const until = clock(snapshot?.expires_at)
  return (
    <div className="sn-chat-summary">
      <details>
        <summary>
          <Icon name="pin" />
          <span>
            {rows.length
              ? rows.map(([, value]) => value).join(' · ')
              : '아직 정한 조건이 없어요. 하고 싶은 일을 편하게 말해 주세요.'}
          </span>
          {rows.length > 0 && <Icon name="chevronDown" />}
        </summary>
        {rows.length > 0 && <FactRows rows={rows} label="현재 대화 조건" />}
      </details>
      <details className="sn-chat-management">
        <summary>대화 관리</summary>
        <div className="sn-chat-toolbar">
          {until && <span className="sn-chat-sub">이 대화는 {until}까지 유지돼요</span>}
          {confirming ? (
            <span className="sn-chat-confirm" role="group" aria-label="대화 삭제 확인">
              <span>이 대화를 서버에서 삭제할까요?</span>
              <SecondaryButton
                className="is-compact is-danger"
                disabled={locked}
                onClick={() => {
                  setConfirming(false)
                  void controller.deleteConversation()
                }}
              >
                삭제
              </SecondaryButton>
              <button type="button" className="sn-link" onClick={() => setConfirming(false)}>
                취소
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="sn-link"
                disabled={locked || !snapshot}
                onClick={() => setConfirming(true)}
              >
                {state.busyAction === 'delete' ? '삭제하는 중…' : '대화 삭제'}
              </button>
            </>
          )}
        </div>
      </details>
    </div>
  )
}
