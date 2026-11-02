import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useDemo } from '../../useDemo'
import Icon from '../Icon'
import { LayoutContext, nextLayout, type Layout } from './layout'
import { LayerMenu, MapLegend, SelectionSummary } from './MapOverlays'
import { HomePanel } from './LivePanel'
import { ParkingPanel, SavedPanel } from './OtherPanels'
import ChatPanel from './ChatPanel'
import DirectionsPanel from './DirectionsPanel'
import RecommendPanel from './RecommendPanel'
import { useRoute } from './useRoute'
import type { Route } from './useRoute'

const GeoMap = lazy(() => import('../GeoMap'))
const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'home', label: '지도 홈', icon: 'home' },
  { route: 'recommend', label: 'AI 추천', icon: 'sparkle' },
  { route: 'chat', label: 'AI 대화', icon: 'chat' },
  { route: 'directions', label: '길찾기', icon: 'map' },
  { route: 'parking', label: '주차장', icon: 'parking' },
  { route: 'saved', label: '저장', icon: 'bookmark' },
]
type Sheet = 'peek' | 'half' | 'full'

export default function AppShell() {
  const { active, result, ui, patchUI, openDetail, savedTrips } = useDemo()
  const [route, go] = useRoute()
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('sn-panel-width'))
    return saved >= 300 && saved <= 640 ? saved : 380
  })
  const grab = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const resize = (next: number) => {
    const clamped = Math.min(640, Math.max(300, Math.round(next)))
    setWidth(clamped)
    try {
      localStorage.setItem('sn-panel-width', String(clamped))
    } catch {
      /* width is a convenience, not required */
    }
  }
  const [viewport, setViewport] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Layout follows the panel width; thresholds have a dead zone so nothing flickers while dragging.
  const [layout, setLayout] = useState<Layout>({ wide: false, legendOpen: true })
  const computed = nextLayout(layout, open ? width : 0, viewport)
  if (computed.wide !== layout.wide || computed.legendOpen !== layout.legendOpen)
    setLayout(computed)
  const [sheet, setSheet] = useState<Sheet>('half')
  const hasResult = !!result
  useEffect(() => {
    document.title = `${NAV.find((n) => n.route === route)!.label} · 서울, 지금 어디?`
  }, [route])
  const select = (next: Route) => {
    go(next)
    setOpen(true)
    if (sheet === 'peek') setSheet('half')
  }
  // Keep list/detail inside browser history: opening a detail pushes #/recommend/detail.
  useEffect(() => {
    const inDetail = window.location.hash.endsWith('/detail')
    if (route === 'recommend' && ui.detail && !inDetail) window.location.hash = '/recommend/detail'
  }, [route, ui.detail])
  useEffect(() => {
    const sync = () => {
      if (!window.location.hash.endsWith('/detail') && ui.detail) patchUI({ detail: null })
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [ui.detail, patchUI])
  const panel =
    route === 'home' ? (
      <HomePanel go={select} />
    ) : route === 'recommend' ? (
      <RecommendPanel go={select} />
    ) : route === 'chat' ? (
      <ChatPanel go={select} />
    ) : route === 'directions' ? (
      <DirectionsPanel go={select} />
    ) : route === 'parking' ? (
      <ParkingPanel go={select} />
    ) : (
      <SavedPanel go={select} />
    )
  return (
    <LayoutContext.Provider value={layout}>
      <div
        className="sn-app"
        data-open={open}
        data-sheet={sheet}
        style={{ '--sn-panel': `${width}px` } as React.CSSProperties}
      >
        <a className="skip" href="#sn-panel">
          본문으로 건너뛰기
        </a>
        <nav className="sn-rail" aria-label="주요 메뉴">
          <button
            type="button"
            className="sn-logo"
            aria-label="서울 나우 — 처음부터 새로고침"
            onClick={() => window.location.reload()}
          >
            <Icon name="pin" />
          </button>
          {NAV.map((item) => (
            <button
              type="button"
              key={item.route}
              className="sn-nav"
              aria-current={route === item.route ? 'page' : undefined}
              onClick={() => select(item.route)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.route === 'saved' && savedTrips.length > 0 && (
                <i className="sn-dot" aria-label={`${savedTrips.length}개`} />
              )}
            </button>
          ))}
        </nav>
        <aside className="sn-panel" id="sn-panel" aria-label="탐색 패널" tabIndex={-1}>
          <button
            type="button"
            className="sn-sheet-handle"
            aria-label={sheet === 'full' ? '패널 낮추기' : '패널 높이기'}
            onClick={() => setSheet(sheet === 'full' ? 'half' : sheet === 'half' ? 'full' : 'half')}
          >
            <span />
          </button>
          <button
            type="button"
            className="sn-sheet-peek"
            aria-label="패널 접기"
            onClick={() => setSheet(sheet === 'peek' ? 'half' : 'peek')}
          >
            <Icon name={sheet === 'peek' ? 'chevronUp' : 'chevronDown'} />
          </button>
          <div
            className="sn-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="패널 너비 조절"
            aria-valuemin={300}
            aria-valuemax={640}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { startX: event.clientX, startWidth: width }
            }}
            onPointerMove={(event) => {
              if (drag.current)
                resize(drag.current.startWidth + event.clientX - drag.current.startX)
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onDoubleClick={() => resize(380)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') resize(width - 24)
              if (event.key === 'ArrowRight') resize(width + 24)
            }}
          />
          <div className="sn-panel-inner" key={route}>
            {panel}
          </div>
        </aside>
        <button
          type="button"
          className="sn-panel-toggle"
          aria-expanded={open}
          aria-controls="sn-panel"
          aria-label={open ? '패널 접기' : '패널 펼치기'}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            grab.current = { startX: event.clientX, startWidth: open ? width : 0, moved: false }
          }}
          onPointerMove={(event) => {
            const g = grab.current
            if (!g) return
            const dx = event.clientX - g.startX
            if (Math.abs(dx) > 4) g.moved = true
            if (!g.moved) return
            const next = g.startWidth + dx
            if (next < 220) setOpen(false)
            else {
              setOpen(true)
              resize(next)
            }
          }}
          onPointerUp={() => {
            const g = grab.current
            grab.current = null
            // A plain click (no drag) still toggles.
            if (g && !g.moved) setOpen(!open)
          }}
          onPointerCancel={() => (grab.current = null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setOpen(!open)
            }
          }}
        >
          <Icon name={open ? 'chevronLeft' : 'chevronRight'} />
        </button>
        <main className="sn-map" id="sn-main" aria-label="지도">
          {ui.mapError ? (
            <div className="sn-state is-error" role="alert">
              <strong>지도를 불러오지 못했어요</strong>
              <p>목록과 추천은 계속 사용할 수 있어요.</p>
              <button
                type="button"
                className="sn-btn sn-btn-secondary"
                onClick={() => patchUI({ mapError: false })}
              >
                지도 다시 시도
              </button>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="sn-map-loading" role="status">
                  서울 지도를 준비하고 있어요…
                </div>
              }
            >
              <GeoMap key={active.trip} preview={!hasResult} parkingHintRequested />
            </Suspense>
          )}
          <div className="sn-map-top">
            <LayerMenu />
          </div>
          <MapLegend />
          {(route === 'recommend' || route === 'chat') && (
            <SelectionSummary
              onDetail={() => active.selected && openDetail(active.selected)}
              onParking={() => select('parking')}
            />
          )}
        </main>
      </div>
    </LayoutContext.Provider>
  )
}
