import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { ChatController } from '../chat/state/controller'
import { createMockChatClient } from '../chat/api/mockClient'
import { memoryStorage } from '../chat/state/storage'
import { chatMode } from '../chat/state/useChat'

let controller: ChatController
vi.mock('../components/map/GeoMap', () => ({
  default: () => <div data-testid="map">테스트 지도</div>,
}))
vi.mock('../chat/state/useChat', async (original) => ({
  ...(await original<typeof import('../chat/state/useChat')>()),
  sharedController: () => controller,
}))
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
  window.location.hash = ''
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  controller = new ChatController({
    client: createMockChatClient({ stepsPerRun: 2 }),
    storage: memoryStorage(),
    intervals: { first: 1, visible: 5, hidden: 5, max: 20 },
  })
})
afterEach(() => {
  cleanup()
  controller.dispose()
  vi.unstubAllGlobals()
})
async function enter() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '시작하기' }))
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await screen.findByRole('tab', { name: 'AI 대화' })
  await waitFor(() => expect(controller.getState().boot).toBe('ready'))
  return user
}

it('별도 활성화 옵션 없이 기본 추천 폼 → 채팅 → 같은 추천 목록 → 저장본을 연결한다', async () => {
  expect(chatMode(undefined)).toBe('real')
  expect(chatMode('off')).toBe('real')
  const user = await enter()
  expect(screen.queryByRole('button', { name: '출발지 정하기' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: '찾을 지역' }), '성수')
  await user.click(screen.getByRole('button', { name: '카페' }))
  await user.click(screen.getByRole('button', { name: '이 조건으로 추천받기' }))
  await screen.findByRole('region', { name: '1회차 추천' })
  await waitFor(() => expect(controller.busy).toBe(false))
  const text = controller.getState().turns[0].text
  expect(text).toContain('출발지와 이동시간 제한 없이')
  await user.click(screen.getByRole('tab', { name: '추천 목록' }))
  const result = await screen.findByRole('region', { name: '1회차 추천' })
  await user.click(within(result).getByRole('button', { name: '추천 묶음 저장' }))
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /^저장/ }))
  await user.click(await screen.findByRole('button', { name: /성수 일대 추천 · 3곳/ }))
  expect(await screen.findByText(/에 저장한 추천 묶음이에요/)).toBeInTheDocument()
  expect(controller.getState().turns).toHaveLength(1)
})

it('대화·지도·탭을 오가도 지도 인스턴스와 작성 중인 메시지를 유지한다', async () => {
  const user = await enter()
  const map = screen.getByTestId('map')
  await user.click(screen.getByRole('tab', { name: 'AI 대화' }))
  const input = await screen.findByRole('textbox', { name: 'AI에게 보낼 메시지' })
  await user.type(input, '작성 중인 조건')
  const log = screen.getByRole('log', { name: 'AI 대화 기록' })
  log.scrollTop = 168
  fireEvent.scroll(log)
  await user.click(screen.getByRole('button', { name: '지도 보기' }))
  expect(document.querySelector('.sn-app')).toHaveAttribute('data-chat-map', 'true')
  await user.click(screen.getByRole('button', { name: '대화로 돌아가기' }))
  expect(screen.getByRole('log')).toBe(log)
  expect(log.scrollTop).toBe(168)
  await user.click(screen.getByRole('button', { name: '지도 홈' }))
  expect(await screen.findByRole('heading', { name: '밖과사전' })).toBeInTheDocument()
  expect(screen.getByTestId('map')).toBe(map)
  await user.click(screen.getByRole('button', { name: 'AI 추천' }))
  await user.click(await screen.findByRole('tab', { name: 'AI 대화' }))
  expect(await screen.findByRole('textbox', { name: 'AI에게 보낼 메시지' })).toHaveValue(
    '작성 중인 조건',
  )
})
