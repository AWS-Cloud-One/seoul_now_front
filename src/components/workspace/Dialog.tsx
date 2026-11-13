import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { patchConditions } from '../../lib/domain.js'
import { useAppState } from '../../state/useAppState'
import ConditionsForm from '../recommendation/ConditionsForm'
import Icon from '../common/Icon'

export function Modal({
  children,
  className = 'dialog',
  id = 'panel',
  labelledBy = 'panel-title',
  onClose,
}: {
  children: ReactNode
  className?: string
  id?: string
  labelledBy?: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!,
      previous = document.activeElement
    element.showModal()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduce && element.animate)
      element.animate(
        [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 220, easing: 'ease-out' },
      )
    return () => {
      element.close()
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      id={id}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          onClose()
      }}
    >
      {children}
    </dialog>
  )
}
function Shell({
  title,
  subtitle,
  children,
  foot,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  foot?: ReactNode
}) {
  const { closePanel } = useAppState()
  return (
    <div className="dialog-inner">
      <header className="dialog-head">
        <div>
          <h2 id="panel-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="quiet close-btn" aria-label="닫기" onClick={closePanel}>
          <Icon name="close" />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {foot && <footer className="dialog-foot">{foot}</footer>}
    </div>
  )
}
export default function Dialog() {
  const { active, ui, submitRecommendation, closePanel } = useAppState()
  const panel = ui.panel
  // Condition editing is the only dialog; other panels are tabs in the workspace.
  if (panel?.type !== 'edit') return null
  return (
    <Modal key={panel.type} onClose={closePanel}>
      <Shell title="조건을 조금 바꿔볼까요?" subtitle="적용하기 전까지 현재 추천은 그대로예요.">
        <ConditionsForm
          initial={
            !active.api && active.pendingChat
              ? patchConditions(active.conditions, active.pendingChat.patch)
              : active.conditions
          }
          onSubmit={(conditions) => {
            closePanel()
            void submitRecommendation(conditions)
          }}
        />
      </Shell>
    </Modal>
  )
}
