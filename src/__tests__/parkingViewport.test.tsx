import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import AppStateProvider from '../state/AppStateProvider'
import { useAppState } from '../state/useAppState'
import { HomePanel } from '../components/workspace/LivePanel'
import { MAP_FOCUS_EVENT } from '../hooks/useRoute'
import * as queries from '../api/queries'
import { clearPageCache } from '../api/usePages'

vi.mock('../hooks/useRoadTraffic', () => ({
  useRoadTraffic: () => ({ roads: [], status: 'ready', error: null, refresh: vi.fn() }),
}))

function MoveMap() {
  const { saveMap } = useAppState()
  return <button onClick={() => saveMap({ center: [37.55, 126.92], zoom: 13 })}>지도 이동</button>
}

afterEach(() => vi.restoreAllMocks())

it('지도 이동은 주차 패널의 검색 입력·반경을 보존하며 다시 확대하지 않는다', async () => {
  localStorage.clear()
  clearPageCache()
  const query = vi.spyOn(queries, 'queryApi').mockResolvedValue({
    items: [],
    next_cursor: null,
    checked_at: null,
  })
  const focus = vi.fn()
  window.addEventListener(MAP_FOCUS_EVENT, focus)
  const user = userEvent.setup()
  const view = render(
    <AppStateProvider parkingSource={{ kind: 'api', load: async () => [] }}>
      <HomePanel go={vi.fn()} />
      <MoveMap />
    </AppStateProvider>,
  )
  try {
    await user.click(screen.getByRole('tab', { name: /주차/ }))
    await user.type(screen.getByRole('searchbox', { name: '주차장 검색' }), '공영')
    await user.click(screen.getByRole('button', { name: '500m' }))
    const count = focus.mock.calls.length
    await user.click(screen.getByRole('button', { name: '지도 이동' }))
    expect(screen.getByRole('searchbox', { name: '주차장 검색' })).toHaveValue('공영')
    expect(screen.getByRole('button', { name: '500m' })).toHaveAttribute('aria-pressed', 'true')
    expect(focus).toHaveBeenCalledTimes(count)
    await user.click(screen.getByRole('button', { name: '이 지도 위치에서 재검색' }))
    expect(focus).toHaveBeenCalledTimes(count + 1)
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        '/parking/search',
        expect.objectContaining({
          latitude: 37.55,
          longitude: 126.92,
          radius_meters: 500,
          name: '공영',
        }),
        expect.any(AbortSignal),
      ),
    )
  } finally {
    window.removeEventListener(MAP_FOCUS_EVENT, focus)
    view.unmount()
  }
})
