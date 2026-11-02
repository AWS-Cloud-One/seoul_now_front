import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { conditionText, dateLabel, patchConditions, placeById } from '../domain.js'
import { tripTitle, useDemo } from '../useDemo'
import ConditionsForm from './ConditionsForm'
import Chat from './Chat'
import Icon from './Icon'
import SavedTrips from './SavedTrips'

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
  const { closePanel } = useDemo()
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
function TripRename({ tripId }: { tripId: string }) {
  const { store, renameTrip, closePanel } = useDemo()
  const trip = store.trips.find((t) => t.trip === tripId)!
  const [name, setName] = useState(tripTitle(trip))
  const [error, setError] = useState('')
  return (
    <Shell
      title="여행 이름 바꾸기"
      subtitle="목록에서 알아보기 쉬운 이름을 붙여 주세요."
      foot={
        <>
          <button onClick={closePanel}>취소</button>
          <button className="primary" type="submit" form="trip-rename-form">
            저장
          </button>
        </>
      }
    >
      <form
        id="trip-rename-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            setError('여행 이름을 입력해 주세요.')
            return
          }
          renameTrip(tripId, name)
        }}
      >
        <label className="field" htmlFor="trip-name">
          <span>여행 이름</span>
          <input
            id="trip-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="off"
            required
          />
        </label>
        <p role="alert">{error}</p>
      </form>
    </Shell>
  )
}
function Navigation({ placeId }: { placeId: string }) {
  const { notify, closePanel } = useDemo()
  const [failed, setFailed] = useState(false)
  const text = useRef<HTMLTextAreaElement>(null)
  const place = placeById(placeId)!
  const destination = `${place.name}\n${place.id}\n위도 ${place.lat.toFixed(6)}, 경도 ${place.lon.toFixed(6)}\n가상 목적지 · 실제 길찾기 사용 금지`
  async function copy() {
    try {
      await navigator.clipboard.writeText(destination)
      notify('가상 목적지 정보를 복사했어요.')
    } catch {
      text.current?.focus()
      text.current?.select()
      notify('자동 복사를 사용할 수 없어요. 선택된 텍스트를 직접 복사해 주세요.')
    }
  }
  return (
    <Shell
      title="이 장소로 출발할까요?"
      subtitle="외부 앱을 실제로 실행하지 않는 길안내"
      foot={
        failed ? (
          <button onClick={closePanel}>장소 상세로 돌아가기</button>
        ) : (
          <>
            <button onClick={closePanel}>취소</button>
            <button className="primary" onClick={() => setFailed(true)}>
              목적지 확인 · 실행 시연
            </button>
          </>
        )
      }
    >
      <div className="stack">
        <h3>{place.name}</h3>
        <p className="smalltext muted">
          선택한 목적지를 확인해 주세요. 가상 좌표를 실제 내비게이션으로 전송하지 않습니다.
        </p>
        <div className="nav-coords">
          <strong>전달할 목적지 정보</strong>
          <br />
          이름: {place.name}
          <br />
          ID: {place.id}
          <br />
          위도: {place.lat.toFixed(6)}
          <br />
          경도: {place.lon.toFixed(6)}
          <br />
          주소: {place.address}
        </div>
        {failed && (
          <>
            <div className="notice">
              <p>
                외부 앱 실행 실패를 재현했어요. 실제 내비게이션 연동은 미연결입니다. 위 목적지
                정보를 확인하거나 복사할 수 있어요.
              </p>
            </div>
            <button onClick={() => void copy()}>목적지 정보 복사</button>
            <label className="field">
              <span className="smalltext">직접 선택하여 복사</span>
              <textarea ref={text} readOnly rows={4} value={destination} />
            </label>
          </>
        )}
      </div>
    </Shell>
  )
}
function History({ tripId }: { tripId: string }) {
  const { store, switchTrip, activateResult, closePanel } = useDemo()
  const trip = store.trips.find((t) => t.trip === tripId)!
  return (
    <Shell title="추천 기록" subtitle={`${tripTitle(trip)} · 최근 5개 그룹`}>
      <div className="history-list">
        {trip.groups.length ? (
          trip.groups.map((group) => (
            <section className="history-item" key={group.id}>
              <div>
                <strong>추천 {group.number}</strong>
                <time>{dateLabel(group.time)}</time>
              </div>
              <p>{conditionText(group.conditions)}</p>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    {placeById(entry.id)?.name} ·{' '}
                    {entry.eta == null ? '시간 미확인' : `${entry.eta}분`}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => {
                  switchTrip(tripId)
                  activateResult(group.id)
                  closePanel()
                }}
              >
                이 추천으로 이어가기 <Icon name="arrow" />
              </button>
            </section>
          ))
        ) : (
          <div className="empty">
            <h3>아직 추천 기록이 없어요</h3>
            <p>장소를 추천받으면 이곳에 보관해요.</p>
          </div>
        )}
      </div>
    </Shell>
  )
}
export default function Dialog() {
  const { active, store, ui, search, closePanel, deleteTrip } = useDemo()
  const panel = ui.panel
  if (!panel) return null
  let body: ReactNode
  if (panel.type === 'chat') body = <Chat embedded={false} />
  else if (panel.type === 'saved-trips') body = <SavedTrips />
  else if (panel.type === 'edit')
    body = (
      <Shell title="조건을 조금 바꿔볼까요?" subtitle="적용하기 전까지 현재 추천은 그대로예요.">
        <ConditionsForm
          initial={
            active.pendingChat
              ? patchConditions(active.conditions, active.pendingChat.patch)
              : active.conditions
          }
          onSubmit={(conditions) => {
            closePanel()
            void search(conditions)
          }}
        />
      </Shell>
    )
  else if (panel.type === 'rename-trip') body = <TripRename tripId={panel.tripId!} />
  else if (panel.type === 'delete-trip') {
    const trip = store.trips.find((t) => t.trip === panel.tripId)!
    body = (
      <Shell
        title="이 여행을 삭제할까요?"
        foot={
          <>
            <button onClick={closePanel}>취소</button>
            <button className="trip-delete-confirm" onClick={() => deleteTrip(trip.trip)}>
              여행 삭제
            </button>
          </>
        }
      >
        <p className="trip-dialog-name">{tripTitle(trip)}</p>
        <p className="smalltext muted">이 여행의 대화와 추천 기록을 함께 삭제해요.</p>
      </Shell>
    )
  } else if (panel.type === 'history') body = <History tripId={panel.tripId!} />
  else if (panel.type === 'navigation') body = <Navigation placeId={panel.placeId!} />
  else return null
  return (
    <Modal
      key={`${panel.type}-${panel.tripId || panel.placeId || ''}`}
      className={`dialog ${panel.type === 'chat' ? 'chat-dialog' : panel.type === 'saved-trips' ? 'saved-trips-dialog' : ''}`}
      onClose={closePanel}
    >
      {body}
    </Modal>
  )
}
