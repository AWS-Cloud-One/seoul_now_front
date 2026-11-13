import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArchivedRecommendations } from '../chat/components/ArchivedRecommendations'
import { PlaceDetailsHost } from '../chat/components/PlaceDetailsHost'
import { useSavedRecommendations } from '../chat/state/recommendations'
import { useAppState } from '../state/useAppState'
import Icon from '../components/common/Icon'
import { LoadingNote } from '../components/common/ui'
import { LayoutContext, nextLayout, type Layout } from '../hooks/layout'
import { LayerMenu, MapLegend } from '../components/map/MapOverlays'
import { HomePanel } from '../components/workspace/LivePanel'
import { ParkingPanel } from '../components/workspace/OtherPanels'
import DirectionsPanel from '../components/directions/DirectionsPanel'
import { setMapOverlay, useRoute } from '../hooks/useRoute'
import { useVisualViewport } from '../hooks/useVisualViewport'
import type { CSSProperties, PointerEvent } from 'react'
import type { Route } from '../hooks/useRoute'

const GeoMap = lazy(() => import('../components/map/GeoMap'))
const ChatPanel = lazy(() => import('../chat/components/ChatPanel'))
// Four top-level tabs. AI 대화 is a view of the AI 추천 tab (same trip and results), and the
// parking list is a sub-view opened from a place or the map; neither has its own tab.
type Tab = 'home' | 'recommend' | 'directions' | 'saved'
const NAV: { route: Tab; label: string; icon: string }[] = [
  { route: 'home', label: '지도 홈', icon: 'home' },
  { route: 'recommend', label: 'AI 추천', icon: 'chat' },
  { route: 'directions', label: '길찾기', icon: 'map' },
  { route: 'saved', label: '저장', icon: 'bookmark' },
]
const TITLES: Record<Route, string> = {
  home: '지도 홈',
  recommend: 'AI 추천',
  chat: 'AI 대화',
  directions: '길찾기',
  parking: '주차장',
  saved: '저장',
}
const BACK_LABEL: Record<Tab, string> = {
  home: '지도 홈으로',
  recommend: '추천으로 돌아가기',
  directions: '길찾기로 돌아가기',
  saved: '저장으로 돌아가기',
}
const tabOf = (route: Route, parkingFrom: Tab): Tab =>
  route === 'chat' ? 'recommend' : route === 'parking' ? parkingFrom : route
type Sheet = 'peek' | 'half' | 'full'

export default function AppShell() {
  const { active, result, ui, patchUI, savedTrips, notify } = useAppState()
  const savedCount = useSavedRecommendations().length + savedTrips.length
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
  const sheetDrag = useRef<{
    y: number
    height: number
    panel: HTMLElement
    moved: boolean
  } | null>(null)
  const suppressSheetClick = useRef(false)
  const [chatMap, setChatMap] = useState(false)
  // Which tab opened the parking list: it stays highlighted and the list returns there.
  const [parkingFrom, setParkingFrom] = useState<Tab>('home')
  const parkingFromApp = useRef(false)
  const tab = tabOf(route, parkingFrom)
  const finishSheetDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = sheetDrag.current
    if (!current) return
    sheetDrag.current = null
    current.panel.style.removeProperty('height')
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    suppressSheetClick.current = current.moved
    const delta = event.clientY - current.y
    if (cancelled || Math.abs(delta) < 24) return
    if (route === 'chat') setChatMap(delta > 0)
    else
      setSheet(
        delta < 0 ? (sheet === 'peek' ? 'half' : 'full') : sheet === 'full' ? 'half' : 'peek',
      )
  }
  const displayedSheet = route === 'chat' && chatMap ? 'peek' : sheet
  const visibleViewport = useVisualViewport()
  const hasResult = !!result
  useEffect(() => {
    document.title = `${TITLES[route]} · 밖과사전`
    if (route === 'home' || route === 'parking' || route === 'directions')
      setMapOverlay({ recommendation: null, lookup: null })
    if (route === 'home') setMapOverlay({ destination: null })
  }, [route])
  useEffect(() => {
    const openRecommendation = () => {
      go('recommend')
      setOpen(true)
      setSheet('full')
      setChatMap(false)
    }
    const openChat = () => {
      go('chat')
      setOpen(true)
      setChatMap(false)
    }
    window.addEventListener('sn:open-recommendation', openRecommendation)
    window.addEventListener('sn:open-chat', openChat)
    return () => {
      window.removeEventListener('sn:open-recommendation', openRecommendation)
      window.removeEventListener('sn:open-chat', openChat)
    }
  }, [go])
  const select = (next: Route) => {
    if (next === 'parking' && route !== 'parking') {
      setParkingFrom(tab)
      parkingFromApp.current = true
    }
    go(next)
    if (next === 'chat') setChatMap(false)
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
      // The parking sub-view keeps the place detail it was opened from, so Back returns to it.
      const hash = window.location.hash
      if (!hash.endsWith('/detail') && !hash.startsWith('#/parking') && ui.detail)
        patchUI({ detail: null })
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [ui.detail, patchUI])
  const panel =
    route === 'home' ? (
      <HomePanel go={select} />
    ) : route === 'recommend' ? (
      <Suspense fallback={<LoadingNote>추천 목록을 불러오고 있어요…</LoadingNote>}>
        <ChatPanel
          view="recommend"
          go={select}
          onShowMap={() => setSheet('peek')}
          onNotify={notify}
        />
      </Suspense>
    ) : route === 'chat' ? (
      <Suspense fallback={<LoadingNote>대화 화면을 불러오고 있어요…</LoadingNote>}>
        <ChatPanel go={select} onShowMap={() => setChatMap(true)} onNotify={notify} />
      </Suspense>
    ) : route === 'directions' ? (
      <DirectionsPanel go={select} />
    ) : route === 'parking' ? (
      <ParkingPanel
        from={parkingFrom}
        back={{
          label: BACK_LABEL[parkingFrom],
          onClick: () => {
            // Return to the exact previous screen (e.g. a place detail) when we came from it.
            if (parkingFromApp.current) {
              parkingFromApp.current = false
              window.history.back()
            } else select(parkingFrom)
          },
        }}
      />
    ) : (
      <Suspense fallback={<LoadingNote>저장한 추천을 불러오고 있어요…</LoadingNote>}>
        <ChatPanel view="saved" go={select} />
        <ArchivedRecommendations go={select} onShowMap={() => setOpen(false)} />
      </Suspense>
    )
  return (
    <LayoutContext.Provider value={layout}>
      <div
        className="sn-app"
        data-open={open}
        data-sheet={displayedSheet}
        data-chat-map={route === 'chat' && chatMap}
        data-result-map={route === 'recommend' && sheet === 'peek'}
        data-route={route}
        data-has-results={hasResult}
        data-keyboard={visibleViewport.keyboard}
        data-chat-editing={visibleViewport.chatActive}
        style={
          {
            '--sn-panel': `${width}px`,
            '--sn-layout-height': `${visibleViewport.layoutHeight}px`,
            '--sn-visible-height': `${visibleViewport.height}px`,
            '--sn-visible-top': `${visibleViewport.top}px`,
          } as CSSProperties
        }
      >
        <a className="skip" href="#sn-panel">
          본문으로 건너뛰기
        </a>
        <nav className="sn-rail" aria-label="주요 메뉴">
          <button
            type="button"
            className="sn-logo"
            aria-label="밖과사전 지도 홈"
            onClick={() => select('home')}
          >
            <Icon name="pin" />
          </button>
          {NAV.map((item) => (
            <button
              type="button"
              key={item.route}
              className="sn-nav"
              aria-current={tab === item.route ? 'page' : undefined}
              onClick={() => select(item.route)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.route === 'saved' && savedCount > 0 && (
                <i className="sn-dot" aria-label={`${savedCount}개`} />
              )}
            </button>
          ))}
        </nav>
        <aside className="sn-panel" id="sn-panel" aria-label="탐색 패널" tabIndex={-1}>
          {((route === 'chat' && chatMap) || (route === 'recommend' && sheet === 'peek')) && (
            <button
              type="button"
              className="sn-chat-return"
              onClick={() => (route === 'chat' ? setChatMap(false) : setSheet('full'))}
              aria-controls="sn-panel-content"
            >
              <Icon name="chat" /> {route === 'chat' ? '대화로 돌아가기' : '추천으로 돌아가기'}{' '}
              <Icon name="chevronUp" />
            </button>
          )}
          <button
            type="button"
            className="sn-sheet-handle"
            aria-label={sheet === 'full' ? '패널 낮추기' : '패널 높이기'}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const panel = event.currentTarget.closest<HTMLElement>('.sn-panel')
              if (!panel) return
              suppressSheetClick.current = false
              sheetDrag.current = {
                y: event.clientY,
                height: panel.getBoundingClientRect().height,
                panel,
                moved: false,
              }
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerMove={(event) => {
              const current = sheetDrag.current
              if (!current) return
              const delta = event.clientY - current.y
              if (Math.abs(delta) > 6) current.moved = true
              if (!current.moved) return
              const available =
                current.panel.closest('.sn-app')?.getBoundingClientRect().height ||
                window.innerHeight
              current.panel.style.height = `${Math.max(56, Math.min(available - 120, current.height - delta))}px`
            }}
            onPointerUp={(event) => finishSheetDrag(event)}
            onPointerCancel={(event) => finishSheetDrag(event, true)}
            onLostPointerCapture={(event) => finishSheetDrag(event, true)}
            onClick={() => {
              if (suppressSheetClick.current) {
                suppressSheetClick.current = false
                return
              }
              if (route === 'chat') setChatMap(true)
              else setSheet(sheet === 'full' ? 'half' : sheet === 'half' ? 'full' : 'half')
            }}
          >
            <span />
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
          <div className="sn-panel-inner" id="sn-panel-content" key={route}>
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
          <Suspense
            fallback={
              <div className="sn-map-loading">
                <LoadingNote>서울 지도를 준비하고 있어요…</LoadingNote>
              </div>
            }
          >
            <GeoMap key={active.trip} preview={!hasResult} parkingHintRequested />
          </Suspense>
          <div className="sn-map-top">
            <LayerMenu />
          </div>
          <MapLegend />
        </main>
        <PlaceDetailsHost
          onShowMap={() => {
            if (route === 'chat') setChatMap(true)
            else setSheet('peek')
          }}
        />
      </div>
    </LayoutContext.Provider>
  )
}
