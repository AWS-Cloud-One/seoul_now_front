import { useEffect, useRef } from 'react'
import { openOriginPicker, toggleOriginPicker, useOrigin } from '../../state/origin'
import Icon from '../common/Icon'
import OriginForm from './OriginForm'

/** The shared departure on the map (top right): a button that opens and closes the picker. */
export default function OriginControl() {
  const origin = useOrigin()
  const popover = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!origin.open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') openOriginPicker(false)
    }
    window.addEventListener('keydown', close)
    popover.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', close)
  }, [origin.open])
  const missing = !origin.location && origin.status !== 'locating'
  const label =
    origin.status === 'locating'
      ? '위치 확인 중…'
      : origin.location
        ? origin.location.label
        : '출발지 설정'
  return (
    <div className="sn-map-origin">
      <button
        type="button"
        className={`sn-origin-button ${missing ? 'is-missing' : ''}`}
        aria-expanded={origin.open}
        aria-controls="sn-origin-popover"
        aria-label={origin.location ? `출발지 ${origin.location.label}, 변경` : '출발지 설정'}
        title={origin.location ? `출발: ${origin.location.label}` : '출발지 설정'}
        onClick={toggleOriginPicker}
      >
        <Icon name={missing ? 'locate' : 'pin'} />
        <span className="sn-origin-button-text">
          {origin.location && <small>출발</small>}
          <span>{label}</span>
        </span>
        {missing && <i className="sn-dot" aria-hidden="true" />}
      </button>
      {origin.open && (
        <div
          ref={popover}
          className="sn-origin-popover"
          id="sn-origin-popover"
          role="dialog"
          aria-label="출발지 설정"
        >
          <header>
            <strong>출발지</strong>
            <button
              type="button"
              className="sn-icon-btn"
              aria-label="출발지 설정 닫기"
              onClick={() => openOriginPicker(false)}
            >
              <Icon name="close" />
            </button>
          </header>
          <OriginForm />
        </div>
      )}
    </div>
  )
}
