import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

function editing() {
  return (
    document.activeElement instanceof HTMLElement &&
    document.activeElement.matches(
      'input:not([type="checkbox"]):not([type="radio"]):not([readonly]), textarea:not([readonly]), [contenteditable="true"]',
    )
  )
}
function snapshot(layoutHeight = window.innerHeight, keyboard = false, chatActive = false) {
  const visual = window.visualViewport
  return {
    height: visual?.height ?? window.innerHeight,
    top: visual?.offsetTop ?? 0,
    layoutHeight,
    keyboard,
    chatActive,
  }
}

/** Follow the native keyboard frames without resizing the map or snapping on blur. */
export function useVisualViewport() {
  const [viewport, setViewport] = useState(() => snapshot())
  useEffect(() => {
    let baseline = window.innerHeight
    let width = window.innerWidth
    let tracking = editing()
    let keyboard = false
    let chatActive = document.activeElement?.id === 'chat-input'
    let frame = 0
    const visual = window.visualViewport
    const update = () => {
      frame = 0
      const focused = editing()
      const height = visual?.height ?? window.innerHeight
      const scale = visual?.scale ?? 1
      if (width !== window.innerWidth) {
        width = window.innerWidth
        baseline = window.innerHeight
        tracking = focused
        keyboard = false
      }
      if (Math.abs(scale - 1) >= 0.01) {
        setViewport((previous) => (previous.keyboard ? { ...previous, keyboard: false } : previous))
        return
      }
      if (focused && !tracking) {
        baseline = Math.max(baseline, window.innerHeight)
        tracking = true
      }
      const gap = Math.max(baseline, window.innerHeight) - height
      if (tracking && gap > 120) {
        keyboard = true
        if (document.activeElement?.id === 'chat-input') chatActive = true
      }
      // Blur happens before the keyboard finishes closing. Keep following its height until restored.
      if (keyboard && gap <= 40) {
        keyboard = false
        chatActive = false
      }
      if (document.activeElement?.id !== 'chat-input' && gap <= 40) chatActive = false
      if (!focused && !keyboard && gap <= 40) tracking = false
      if (!tracking) baseline = window.innerHeight
      const next = snapshot(baseline, keyboard, chatActive)
      setViewport((previous) =>
        previous.height === next.height &&
        previous.top === next.top &&
        previous.layoutHeight === next.layoutHeight &&
        previous.chatActive === next.chatActive &&
        previous.keyboard === next.keyboard
          ? previous
          : next,
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const beginChat = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.id === 'chat-input') {
        chatActive = true
        flushSync(() => {
          setViewport((previous) =>
            previous.chatActive ? previous : { ...previous, chatActive: true },
          )
        })
      }
      schedule()
    }
    document.addEventListener('pointerdown', beginChat)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', beginChat)
    document.addEventListener('focusout', schedule)
    visual?.addEventListener('resize', schedule)
    visual?.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('pointerdown', beginChat)
      document.removeEventListener('focusin', beginChat)
      document.removeEventListener('focusout', schedule)
      visual?.removeEventListener('resize', schedule)
      visual?.removeEventListener('scroll', schedule)
    }
  }, [])
  return viewport
}
