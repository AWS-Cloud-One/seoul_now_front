import { useRef, useState } from 'react'

export default function WorkspaceDivider() {
  const root = useRef<HTMLDivElement>(null)
  const [percent, setPercent] = useState(40)
  function resize(requested: number) {
    const layout = root.current?.parentElement
    if (!layout) return
    const available = layout.clientWidth
    const width = Math.max(280, Math.min(requested, Math.min(640, available - 332)))
    layout.style.setProperty('--chat-width', `${width}px`)
    setPercent(Math.round((width / available) * 100))
  }
  return (
    <div
      ref={root}
      className="workspace-divider"
      role="separator"
      tabIndex={0}
      aria-label="챗봇과 지도 너비 조절"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`챗봇 너비 ${percent}%`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          resize(event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const current = root.current?.previousElementSibling?.getBoundingClientRect().width || 400
        resize(
          event.key === 'Home'
            ? 280
            : event.key === 'End'
              ? 640
              : current + (event.key === 'ArrowLeft' ? -24 : 24),
        )
      }}
    >
      <span aria-hidden="true" />
    </div>
  )
}
