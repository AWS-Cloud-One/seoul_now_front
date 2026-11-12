import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import DirectionsPanel from './DirectionsPanel'
import { fetchDirections } from '../../api/routing'
import { getMapOverlay } from '../../hooks/useRoute'
import { queryApi } from '../../api/queries'
import { clearPageCache } from '../../api/usePages'
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

it('검색한 출발지 좌표로 경로를 요청하고 출발지를 바꾸면 이전 경로를 지운다', async () => {
  const user = userEvent.setup()
  vi.mocked(queryApi).mockImplementation(async (_path, params) => ({
    items: [
      {
        place_id: params.query,
        name: params.query,
        category_name: '장소',
        address: '서울 주소',
        coordinates: {
          latitude: params.query === '출발카페' ? 37.51 : 37.56,
          longitude: params.query === '출발카페' ? 127.02 : 126.97,
        },
      },
    ],
    next_cursor: null,
  }))
  vi.mocked(fetchDirections).mockResolvedValue({
    distance: 5000,
    duration: 600,
    taxiFare: null,
    tollFare: null,
    path: [
      [37.51, 127.02],
      [37.56, 126.97],
    ],
  })
  render(<DirectionsPanel go={vi.fn()} />)
  await user.type(screen.getByRole('searchbox', { name: '도착지 검색' }), '목적장소')
  await user.click(await screen.findByRole('button', { name: /목적장소.*서울 주소/ }))
  expect(screen.getByRole('button', { name: '목적장소까지 길찾기' })).toBeDisabled()
  await user.type(screen.getByRole('searchbox', { name: '출발지 검색' }), '출발카페')
  const results = await screen.findByRole('list', { name: '출발지 검색 결과' })
  await user.click(within(results).getByRole('button', { name: /출발카페/ }))
  await user.click(screen.getByRole('button', { name: '목적장소까지 길찾기' }))
  await waitFor(() =>
    expect(fetchDirections).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 37.51, lon: 127.02 }),
      expect.objectContaining({ lat: 37.56, lon: 126.97 }),
      expect.any(AbortSignal),
    ),
  )
  expect(await screen.findByText('자동차 10분')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '출발지 바꾸기' }))
  expect(screen.getByRole('searchbox', { name: '출발지 검색' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '목적장소까지 길찾기' })).toBeDisabled()
  expect(getMapOverlay().route).toBeNull()
})

it('출발지 검색 실패 시 다시 시도할 수 있다', async () => {
  const user = userEvent.setup()
  vi.mocked(queryApi)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [], next_cursor: null })
  render(<DirectionsPanel go={vi.fn()} />)
  await user.type(screen.getByRole('searchbox', { name: '출발지 검색' }), '출발카페')
  await user.click(await screen.findByRole('button', { name: '출발지 검색 다시 시도' }))
  expect(
    await screen.findByText('검색 결과가 없어요. 다른 이름으로 찾아보세요.'),
  ).toBeInTheDocument()
  expect(queryApi).toHaveBeenCalledTimes(2)
})
