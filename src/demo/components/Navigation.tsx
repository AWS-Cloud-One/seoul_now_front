import { useEffect, useRef, useState } from 'react'
import { tripTitle, useDemo } from '../useDemo'
import { Modal } from './Dialog'
import Icon from './Icon'
import { SavedTripsButton } from './SavedTrips'

function Sidebar() {
  const { store, active, ui, patchUI, newTrip, switchTrip, navigate, result } = useDemo()
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null)
  const popover = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu || !popover.current) return
    const element = popover.current
    element.showPopover()
    element.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [menu])
  const toggle = () => patchUI({ drawer: !ui.drawer })
  return (
    <aside className="app-sidebar" id="app-sidebar" aria-label="여행 메뉴">
      <button
        className={`sidebar-brand ${result ? 'sidebar-back' : ''}`}
        aria-label={result ? '이전 지도 화면으로 돌아가기' : '서울, 지금 어디? 홈'}
        data-hint={result ? '뒤로가기' : '서울, 지금 어디?'}
        onClick={() => {
          if (result) {
            patchUI({ drawer: false, panel: null, detail: null })
            navigate('preview')
          } else toggle()
        }}
      >
        <span className="brand-mark">
          <Icon name={result ? 'back' : 'pin'} />
        </span>
        <span className="nav-label">{result ? '뒤로가기' : '서울, 지금 어디?'}</span>
      </button>
      <SavedTripsButton />
      <button
        className="sidebar-toggle"
        id="sidebar-toggle"
        onClick={toggle}
        aria-label={ui.drawer ? '메뉴 접기' : '메뉴 펼치기'}
        aria-controls="navigation-drawer"
        aria-expanded={ui.drawer}
        data-hint="메뉴 펼치기"
      >
        <Icon name={ui.drawer ? 'close' : 'list'} />
        <span className="nav-label">{ui.drawer ? '메뉴 접기' : '메뉴 펼치기'}</span>
      </button>
      <nav className="sidebar-menu" aria-label="여행 기능">
        <span className="sidebar-section-label">나의 여행</span>
        <button
          className="sidebar-new"
          id="new-trip-button"
          aria-label="새 여행"
          data-hint="새 여행"
          onClick={newTrip}
        >
          <Icon name="plus" />
          <span className="nav-label">새 여행</span>
        </button>
        <button
          id="sidebar-trips-button"
          aria-label={`여행 목록 ${store.trips.length}개`}
          data-hint="여행 목록"
          onClick={() => patchUI({ drawer: true })}
        >
          <Icon name="chat" />
          <span className="nav-label">여행 목록</span>
        </button>
      </nav>
      <section className="sidebar-trips" aria-label="보관된 여행">
        <div className="sidebar-trips-heading">
          <span>내 여행</span>
          <span>{store.trips.length}</span>
        </div>
        <div id="sidebar-trip-list" onScroll={() => setMenu(null)}>
          {store.trips.map((trip) => (
            <div
              className={`sidebar-trip-row ${trip.trip === active.trip ? 'is-active' : ''}`}
              key={trip.trip}
            >
              <button
                className="sidebar-trip"
                onClick={() => switchTrip(trip.trip)}
                aria-current={trip.trip === active.trip ? 'page' : undefined}
                title={tripTitle(trip)}
              >
                <span className="trip-item-icon">
                  <Icon name="chat" />
                </span>
                <span className="trip-item-copy">
                  <strong>{tripTitle(trip)}</strong>
                  <small>
                    {trip.groups.length
                      ? `추천 ${trip.groups.length}개`
                      : trip.onboardingComplete
                        ? '대화 시작'
                        : '조건 입력 중'}{' '}
                    ·{' '}
                    {new Date(trip.createdAt).toLocaleDateString('ko-KR', {
                      month: 'numeric',
                      day: 'numeric',
                      timeZone: 'Asia/Seoul',
                    })}
                  </small>
                </span>
              </button>
              <button
                className="trip-more-button"
                aria-label={`${tripTitle(trip)} 여행 메뉴`}
                aria-haspopup="menu"
                aria-controls="trip-options-menu"
                aria-expanded={menu?.id === trip.trip}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setMenu(
                    menu?.id === trip.trip
                      ? null
                      : {
                          id: trip.trip,
                          left: Math.max(8, Math.min(rect.right - 170, innerWidth - 180)),
                          top: Math.max(8, Math.min(rect.bottom + 6, innerHeight - 160)),
                        },
                  )
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                  <circle cx="12" cy="5" r="1.7" />
                  <circle cx="12" cy="12" r="1.7" />
                  <circle cx="12" cy="19" r="1.7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </section>
      {menu && (
        <div
          ref={popover}
          id="trip-options-menu"
          popover="auto"
          role="menu"
          aria-label="여행 관리"
          style={{ left: menu.left, top: menu.top }}
          onToggle={(e) => {
            if (e.newState === 'closed') setMenu(null)
          }}
          onKeyDown={(e) => {
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault()
              items[
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? items.length - 1
                    : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              ]?.focus()
            } else if (e.key === 'Escape' || e.key === 'Tab') setMenu(null)
          }}
        >
          {[
            ['history', 'history', '추천 기록'],
            ['rename-trip', 'edit', '이름 바꾸기'],
            ['delete-trip', 'close', '삭제'],
          ].map(([type, icon, label]) => (
            <button
              className={`trip-menu-action ${type === 'delete-trip' ? 'is-danger' : ''}`}
              key={type}
              role="menuitem"
              onClick={() => {
                patchUI({ panel: { type, tripId: menu.id } })
                setMenu(null)
              }}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="sidebar-foot">
        <p className="sidebar-caption">
          익숙한 서울에서,
          <br />
          조금 다른 하루를 찾아요.
        </p>
      </div>
    </aside>
  )
}
export default function Navigation() {
  const { ui, patchUI, result, navigate } = useDemo()
  return (
    <>
      <div className="mobile-appbar">
        <button
          className="mobile-menu-toggle"
          id="mobile-menu-toggle"
          aria-label={result ? '이전 지도 화면으로 돌아가기' : '여행 메뉴 열기'}
          aria-controls={result ? undefined : 'navigation-drawer'}
          aria-expanded={result ? undefined : ui.drawer}
          onClick={() => {
            if (result) {
              patchUI({ drawer: false, panel: null, detail: null })
              navigate('preview')
            } else patchUI({ drawer: true })
          }}
        >
          <Icon name={result ? 'back' : 'list'} />
        </button>
        <span className="mobile-wordmark">서울, 지금 어디?</span>
        <SavedTripsButton />
      </div>
      <div id="sidebar-slot">{!ui.drawer && <Sidebar />}</div>
      {ui.drawer && (
        <Modal
          id="navigation-drawer"
          className=""
          labelledBy="navigation-label"
          onClose={() => patchUI({ drawer: false })}
        >
          <h2 className="sr-only" id="navigation-label">
            여행 메뉴
          </h2>
          <Sidebar />
        </Modal>
      )}
    </>
  )
}
