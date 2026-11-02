import { useEffect, useEffectEvent, useLayoutEffect, useState } from 'react'
import { useDemo } from './demo/useDemo'
import DemoProvider from './demo/DemoProvider'
import { conditionsEqual } from './demo/domain.js'
import Chat from './demo/components/Chat'
import Dialog from './demo/components/Dialog'
import Navigation from './demo/components/Navigation'
import MapPanel from './demo/components/MapPanel'
import PlaceDetail from './demo/components/PlaceDetail'
import Icon from './demo/components/Icon'
import WorkspaceDivider from './demo/components/WorkspaceDivider'
import { PreviewScreen, ScenarioControls, StartScreen, Welcome } from './demo/components/Screens'

function useDesktop(onDesktop: () => void) {
  const onDesktopChange = useEffectEvent(onDesktop)
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width:901px)').matches)
  useEffect(() => {
    const media = matchMedia('(min-width:901px)')
    const change = () => {
      setDesktop(media.matches)
      if (media.matches) onDesktopChange()
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return desktop
}
function Application() {
  const { active, result, ui, patchUI, openEdit, showChat, retrySearch } = useDemo()
  const desktop = useDesktop(() => {
    if (ui.panel?.type === 'chat') patchUI({ panel: null })
  })
  const hasResults = active.onboardingComplete && !!(result || ui.progress?.conditions || ui.notice)
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('app-entered', ui.page !== 'start')
    document.documentElement.classList.toggle('map-preview', ui.page === 'preview')
    document.body.classList.toggle('landing-active', ui.page === 'start')
    document.body.classList.toggle('workspace-mode', ui.page === 'main')
    document.body.classList.toggle(
      'needs-onboarding',
      ui.page === 'main' && !active.onboardingComplete,
    )
    document.body.classList.toggle('has-results', ui.page === 'main' && hasResults)
    return () => {
      for (const name of ['landing-active', 'workspace-mode', 'needs-onboarding', 'has-results'])
        document.body.classList.remove(name)
      document.documentElement.classList.remove('app-entered', 'map-preview')
    }
  }, [ui.page, active.onboardingComplete, hasResults])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !ui.panel && !ui.drawer && ui.detail) patchUI({ detail: null })
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [ui.panel, ui.drawer, ui.detail, patchUI])
  if (ui.page === 'start') return <StartScreen />
  if (ui.page === 'preview')
    return (
      <>
        <PreviewScreen />
        <Dialog />
        <div className="toast" role="status" aria-live="polite">
          {ui.toast}
        </div>
      </>
    )
  return (
    <>
      <a className="skip" href="#main">
        본문으로 건너뛰기
      </a>
      <Navigation />
      <div id="storage-warning">
        {!ui.storageOK && (
          <div className="storage-warning">
            이 환경에서는 저장소를 사용할 수 없어 메모리로 작동합니다. 새로고침하거나 탭을 닫으면
            여행 기록을 복원할 수 없어요.
          </div>
        )}
      </div>
      <main id="main" tabIndex={-1}>
        <section className="unified-workspace" aria-label="대화와 지도 탐색">
          <h1 className="sr-only">서울, 지금 어디? 대화와 장소 탐색</h1>
          <div className="unified-layout">
            <div className="conversation-column">
              <aside
                className="workspace-chat unified-chat"
                id="workspace-chat"
                aria-label={!active.onboardingComplete ? '새 여행 조건 입력' : '챗봇 대화'}
              >
                {(desktop || !active.onboardingComplete) && <Chat key={active.trip} />}
              </aside>
            </div>
            {desktop && hasResults && <WorkspaceDivider />}
            <div
              className="unified-content"
              id="content-pane"
              data-mode={hasResults ? 'results' : 'welcome'}
            >
              {hasResults ? (
                <section className="explore-content" aria-label="추천 장소와 지도">
                  {ui.notice && (
                    <div
                      className={`notice ${ui.notice.type === 'info' ? 'info' : ''}`}
                      role="status"
                    >
                      <p>{ui.notice.text}</p>
                      <div className="row">
                        <button className="small" onClick={() => void retrySearch()}>
                          다시 시도
                        </button>
                        {ui.notice.edit && (
                          <button className="small" onClick={openEdit}>
                            조건 수정
                          </button>
                        )}
                        <button
                          className="quiet small"
                          aria-label="알림 닫기"
                          onClick={() => patchUI({ notice: null })}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    </div>
                  )}
                  {result && !conditionsEqual(result.conditions, active.conditions) && (
                    <div className="notice info">
                      <p>
                        이 결과는 이전 조건으로 찾았어요. 조건을 바꿔도 이전 추천의 시각은
                        유지됩니다.
                      </p>
                    </div>
                  )}
                  <div className={`explore-stage ${ui.detail ? 'has-detail' : ''}`}>
                    <div className="map-overview">
                      <MapPanel />
                    </div>
                    <div
                      className={`detail-host ${ui.detail?.expanded ? 'is-expanded' : ''}`}
                      hidden={!ui.detail}
                    >
                      <PlaceDetail />
                    </div>
                  </div>
                </section>
              ) : (
                <Welcome />
              )}
            </div>
          </div>
          <button
            className="mobile-chat-launch primary"
            onClick={showChat}
            aria-label="챗봇과 대화 열기"
          >
            <Icon name="chat" />
            챗봇과 대화
          </button>
          <div id="demo-controls">
            <ScenarioControls />
          </div>
        </section>
      </main>
      <footer className="footer">
        <span>서울의 다음 목적지를 함께 찾아요. 로그인 없이, 이 탭에서만.</span>
      </footer>
      <Dialog />
      <div className="toast" id="toast" role="status" aria-live="polite">
        {ui.toast}
      </div>
      <div className="sr-only" id="live" role="status" aria-live="polite">
        {ui.notice?.text}
      </div>
    </>
  )
}
export default function App() {
  return (
    <DemoProvider>
      <Application />
    </DemoProvider>
  )
}
