import { useLayoutEffect } from 'react'
import { useDemo } from './demo/useDemo'
import DemoProvider from './demo/DemoProvider'
import Dialog from './demo/components/Dialog'
import AppShell from './demo/components/shell/AppShell'
import { StartScreen } from './demo/components/Screens'

function Application() {
  const { ui } = useDemo()
  const start = ui.page === 'start'
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('app-entered', !start)
    document.body.classList.toggle('landing-active', start)
    document.body.classList.toggle('sn-body', !start)
    return () => {
      document.documentElement.classList.remove('app-entered')
      document.body.classList.remove('landing-active', 'sn-body')
    }
  }, [start])
  if (start) return <StartScreen />
  return (
    <>
      <AppShell />
      <Dialog />
      {!ui.storageOK && (
        <div className="sn-toast is-warn" role="status">
          저장소를 사용할 수 없어 이 탭에서만 기록돼요.
        </div>
      )}
      <div className="sn-toast" role="status" aria-live="polite" hidden={!ui.toast}>
        {ui.toast}
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
