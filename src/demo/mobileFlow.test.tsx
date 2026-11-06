import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
vi.mock('./components/GeoMap', () => ({ default: () => <div>테스트 지도</div> }))
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.location.hash = ''
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('모바일 추천을 별도 대화창 없이 열고 선택·저장·복원·길찾기 재시도까지 이어진다', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '시작하기' }))
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await user.selectOptions(screen.getByLabelText(/어디에서 출발하세요/), '서울역')
  await user.click(screen.getByRole('checkbox', { name: '카페' }))
  await user.click(screen.getByRole('button', { name: '이 조건으로 찾아보기' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /선택$/ })).toHaveLength(3))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'AI 대화' }))
  const chat = await screen.findByRole('log', { name: 'AI 대화 기록' })
  chat.scrollTop = 168
  await user.type(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' }), '작성 중인 조건')
  await user.click(screen.getByRole('button', { name: '지도 보기' }))
  expect(document.querySelector('.sn-app')).toHaveAttribute('data-chat-map', 'true')
  await user.click(screen.getByRole('button', { name: '대화로 돌아가기' }))
  expect(screen.getByRole('log', { name: 'AI 대화 기록' })).toBe(chat)
  expect(chat.scrollTop).toBe(168)
  expect(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' })).toHaveValue('작성 중인 조건')
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'AI 추천' }))
  const second = screen.getAllByRole('button', { name: /선택$/ })[1]
  const name = second
    .getAttribute('aria-label')!
    .replace(/^2번 /, '')
    .replace(/ 선택$/, '')
  await user.click(second)
  await user.click(screen.getByRole('button', { name: name + ' 상세 보기' }))
  await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: '저장' }))
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /저장/ }))
  await user.click(await screen.findByRole('button', { name: '서울역 · 카페 열기' }))
  expect(await screen.findByRole('button', { name: '2번 ' + name + ' 선택' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(screen.getByRole('button', { name: name + ' 상세 보기' }))
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        summary: { distance: 4200, duration: 600 },
        coordinates: [
          [126.97, 37.55],
          [126.98, 37.57],
        ],
      }),
    })
  vi.stubGlobal('fetch', request)
  await user.click(screen.getByRole('button', { name: name + '까지 길찾기' }))
  expect(await screen.findByText('서버에 연결하지 못했어요.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('자동차 10분')).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
  const url = new URL(request.mock.calls[1][0], 'http://localhost')
  expect(url.pathname).toBe('/api/v1/kakao/directions')
  expect(url.searchParams.get('origin_lat')).toBeTruthy()
}, 15000)
