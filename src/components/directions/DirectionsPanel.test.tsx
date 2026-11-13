import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import DirectionsPanel from './DirectionsPanel'
import { fetchDirections } from '../../api/routing'
import { getMapOverlay } from '../../hooks/useRoute'
import { queryApi } from '../../api/queries'
import { clearPageCache } from '../../api/usePages'
import { setOrigin } from '../../state/origin'
import { openDirectionsTo } from '../../state/directionsTarget'
import { screenOrigin } from '../../api/screenTestApi'
vi.mock('../../api/queries', async (original) => ({
  ...(await original<typeof import('../../api/queries')>()),
  queryApi: vi.fn(),
}))

vi.mock('../../api/routing', async (original) => ({
  ...(await original<typeof import('../../api/routing')>()),
  fetchDirections: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  clearPageCache()
})

const route = {
  distance: 5000,
  duration: 600,
  taxiFare: null,
  tollFare: null,
  path: [
    [37.51, 127.02],
    [37.56, 126.97],
  ] as [number, number][],
}
const at = (label: string, latitude: number, longitude: number) => ({
  ...screenOrigin,
  label,
  coordinates: { latitude, longitude },
})

it('개발 모드의 재마운트로 취소된 자동 길찾기는 다시 요청해 완료한다', async () => {
  vi.mocked(fetchDirections).mockImplementation(async (_origin, _place, signal) => {
    await Promise.resolve()
    signal.throwIfAborted()
    return route
  })
  setOrigin(at('서울역', 37.55, 126.97))
  openDirectionsTo({ id: 'strict-dest', name: '서울숲 카페', lat: 37.54, lon: 127.04, sub: '서울' })
  render(
    <StrictMode>
      <DirectionsPanel go={vi.fn()} />
    </StrictMode>,
  )
  expect(await screen.findByText('자동차 10분')).toBeInTheDocument()
  const calls = vi.mocked(fetchDirections).mock.calls
  expect(calls[0][2].aborted).toBe(true)
  expect(calls.at(-1)![2].aborted).toBe(false)
  expect(screen.queryByText('경로 찾는 중…')).not.toBeInTheDocument()
})

it('공유 출발지에서 고른 도착지까지 경로를 찾고, 출발지를 바꾸면 이전 경로를 지운다', async () => {
  const user = userEvent.setup()
  vi.mocked(queryApi).mockResolvedValue({
    items: [
      {
        place_id: 'dest',
        name: '목적장소',
        category_name: '장소',
        address: '서울 주소',
        coordinates: { latitude: 37.56, longitude: 126.97 },
      },
    ],
    next_cursor: null,
  })
  vi.mocked(fetchDirections).mockResolvedValue(route)
  setOrigin(at('출발카페', 37.51, 127.02))
  render(<DirectionsPanel go={vi.fn()} />)
  await user.type(screen.getByRole('searchbox', { name: '도착지 검색' }), '목적장소')
  await user.click(await screen.findByRole('button', { name: /목적장소.*서울 주소/ }))
  expect(screen.getByText('출발카페에서 출발')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '목적장소까지 길찾기' }))
  await waitFor(() =>
    expect(fetchDirections).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 37.51, lon: 127.02 }),
      expect.objectContaining({ lat: 37.56, lon: 126.97 }),
      expect.any(AbortSignal),
    ),
  )
  expect(await screen.findByText('자동차 10분')).toBeInTheDocument()
  expect(getMapOverlay().route).not.toBeNull()
  act(() => setOrigin(at('다른 출발지', 37.5, 127)))
  expect(screen.getByText('다른 출발지에서 출발')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '목적장소까지 길찾기' })).toBeEnabled()
  expect(getMapOverlay().route).toBeNull()
})

it('다른 화면에서 넘겨준 도착지는 공유 출발지에서 바로 경로를 찾는다', async () => {
  vi.mocked(fetchDirections).mockResolvedValue(route)
  setOrigin(at('서울역', 37.55, 126.97))
  openDirectionsTo({ id: 'live-1', name: '강남역', lat: 37.49, lon: 127.02, sub: '실시간' })
  render(<DirectionsPanel go={vi.fn()} />)
  expect(screen.getByText('강남역')).toBeInTheDocument()
  await waitFor(() => expect(fetchDirections).toHaveBeenCalledTimes(1))
  expect(vi.mocked(fetchDirections).mock.calls[0][1]).toMatchObject({ lat: 37.49, lon: 127.02 })
  expect(await screen.findByText('자동차 10분')).toBeInTheDocument()
})

it('출발지가 없으면 경로를 찾지 않고 출발지를 정하도록 안내한다', () => {
  openDirectionsTo({ id: 'live-1', name: '강남역', lat: 37.49, lon: 127.02, sub: '실시간' })
  render(<DirectionsPanel go={vi.fn()} />)
  expect(screen.getByText('출발지를 정하면 길찾기를 할 수 있어요.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '강남역까지 길찾기' })).toBeDisabled()
  expect(fetchDirections).not.toHaveBeenCalled()
})
