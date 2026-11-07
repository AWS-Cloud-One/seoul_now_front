/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'

// Keep this screen test independent of external map services and API keys.
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
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('현재 시작 화면에서 시작하기를 누르면 지도와 주요 메뉴가 열린다', async () => {
  const user = userEvent.setup()
  const view = render(<App />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('SEOUL')
  expect(screen.getByRole('img', { name: 'SEOUL' })).toHaveAttribute(
    'src',
    '/images/seoul-wordmark.svg',
  )
  const picture = view.container.querySelector('picture')!
  expect(picture.querySelector('img')).toHaveAttribute('src', '/images/seoul-wide.png')
  expect(picture.querySelector('source')).toHaveAttribute('srcset', '/images/seoul-portrait.png')

  await user.click(screen.getByRole('button', { name: '시작하기' }))
  expect(screen.queryByRole('button', { name: '시작하기' })).not.toBeInTheDocument()
  expect(await screen.findByText('테스트 지도')).toBeInTheDocument()
  const navigation = within(screen.getByRole('navigation', { name: '주요 메뉴' }))
  for (const name of ['지도 홈', 'AI 추천', 'AI 대화', '길찾기', '주차장', '저장']) {
    expect(navigation.getByRole('button', { name })).toBeInTheDocument()
  }
  await user.click(navigation.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('저장한 여행이 없어요')).toBeInTheDocument()
  expect(screen.getByRole('main', { name: '지도' })).toBeInTheDocument()
})

it('현재 화면에 필요한 배경 이미지와 SUIT 글꼴 파일이 유효하다', () => {
  for (const image of ['seoul-wide.png', 'seoul-portrait.png']) {
    const bytes = readFileSync(resolve('public/images', image))
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(0)
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(0)
  }
  const font = readFileSync(resolve('src/demo/assets/suit-variable.woff2'))
  expect(font.subarray(0, 4).toString()).toBe('wOF2')
})

it('패널 손잡이를 위아래로 끌면 높이가 바뀌고 뒤따르는 클릭으로 다시 토글되지 않는다', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const user = userEvent.setup()
  const view = render(<App />)
  await user.click(screen.getByRole('button', { name: '시작하기' }))
  const handle = screen.getByRole('button', { name: '패널 높이기' })
  const panel = screen.getByRole('complementary', { name: '탐색 패널' })
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect)
  fireEvent.pointerDown(handle, { clientY: 400, button: 0 })
  fireEvent.pointerMove(handle, { clientY: 280 })
  expect(panel.style.height).toBe('520px')
  fireEvent.pointerUp(handle, { clientY: 280 })
  fireEvent.click(handle)
  expect(view.container.querySelector('.sn-app')).toHaveAttribute('data-sheet', 'full')
  expect(panel.style.height).toBe('')
  fireEvent.pointerDown(handle, { clientY: 200, button: 0 })
  fireEvent.pointerMove(handle, { clientY: 330 })
  fireEvent.pointerUp(handle, { clientY: 330 })
  fireEvent.click(handle)
  expect(view.container.querySelector('.sn-app')).toHaveAttribute('data-sheet', 'half')
  fireEvent.pointerDown(handle, { clientY: 300, button: 0 })
  fireEvent.pointerMove(handle, { clientY: 430 })
  fireEvent.pointerUp(handle, { clientY: 430 })
  fireEvent.click(handle)
  expect(view.container.querySelector('.sn-app')).toHaveAttribute('data-sheet', 'peek')
})
