import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useVisualViewport } from './useVisualViewport'
import { nextLayout } from './layout'

let frames: Map<number, FrameRequestCallback>
let sequence = 0
function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(0))
}
function setup(focused = true) {
  const input = document.createElement('input')
  input.dataset.viewportTest = ''
  document.body.append(input)
  if (focused) input.focus()
  const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  vi.stubGlobal('innerHeight', 844)
  vi.stubGlobal('visualViewport', visual)
  return { input, visual, ...renderHook(useVisualViewport) }
}
function resize(visual: ReturnType<typeof setup>['visual'], height: number, top = 0) {
  act(() => {
    visual.height = height
    visual.offsetTop = top
    visual.dispatchEvent(new Event('resize'))
    flushFrames()
  })
}
beforeEach(() => {
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-viewport-test]').forEach((element) => element.remove())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('모바일 범례는 접고 데스크톱 여유 공간에서는 펼친다', () => {
  expect(nextLayout({ wide: false, legendOpen: true }, 380, 390).legendOpen).toBe(false)
  expect(nextLayout({ wide: false, legendOpen: false }, 380, 1440).legendOpen).toBe(true)
})
it('키보드가 열려도 지도 기준 높이를 고정하고 실제 보이는 높이를 전달한다', () => {
  const { visual, result } = setup()
  resize(visual, 460, 32)
  expect(result.current).toEqual({
    height: 460,
    top: 32,
    layoutHeight: 844,
    keyboard: true,
    chatActive: false,
  })
  resize(visual, 844)
  expect(result.current).toEqual({
    height: 844,
    top: 0,
    layoutHeight: 844,
    keyboard: false,
    chatActive: false,
  })
})
it('포커스 해제 직후에는 복원하지 않고 키보드 닫힘이 끝날 때까지 유지한다', () => {
  const { visual, input, result } = setup()
  resize(visual, 460)
  act(() => {
    input.blur()
    flushFrames()
  })
  expect(result.current.keyboard).toBe(true)
  resize(visual, 600)
  expect(result.current.keyboard).toBe(true)
  expect(result.current.layoutHeight).toBe(844)
  resize(visual, 844)
  expect(result.current.keyboard).toBe(false)
})
it('연속 resize와 scroll을 한 프레임으로 합쳐 최신 높이만 반영한다', () => {
  const { visual, result } = setup()
  act(() => {
    visual.height = 700
    visual.dispatchEvent(new Event('resize'))
    visual.height = 460
    visual.dispatchEvent(new Event('scroll'))
  })
  expect(frames.size).toBe(1)
  expect(result.current.height).toBe(844)
  act(flushFrames)
  expect(result.current.height).toBe(460)
})
it('창 자체가 줄어드는 브라우저에서도 입력 전 높이를 유지한다', () => {
  const { visual, result } = setup()
  vi.stubGlobal('innerHeight', 460)
  resize(visual, 460)
  expect(result.current.keyboard).toBe(true)
  expect(result.current.layoutHeight).toBe(844)
})
it('입력 중이 아닌 높이 변경과 수동 확대를 키보드로 오인하지 않는다', () => {
  const { visual, result } = setup(false)
  resize(visual, 460)
  expect(result.current.keyboard).toBe(false)
  visual.scale = 2
  resize(visual, 422)
  expect(result.current.keyboard).toBe(false)
})
it('화면을 벗어나면 예약된 프레임과 이벤트 구독을 정리한다', () => {
  const { visual, unmount } = setup()
  const remove = vi.spyOn(visual, 'removeEventListener')
  act(() => visual.dispatchEvent(new Event('resize')))
  expect(frames.size).toBe(1)
  unmount()
  expect(frames.size).toBe(0)
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
})

it('채팅 입력을 누른 즉시 편집 화면을 유지하고 키보드가 닫힌 뒤 복원한다', () => {
  const { visual, input, result } = setup(false)
  input.id = 'chat-input'
  act(() => input.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(result.current.chatActive).toBe(true)
  expect(result.current.keyboard).toBe(false)
  act(() => {
    input.focus()
    flushFrames()
  })
  resize(visual, 760)
  expect(result.current.chatActive).toBe(true)
  resize(visual, 460)
  act(() => {
    input.blur()
    flushFrames()
  })
  expect(result.current.chatActive).toBe(true)
  resize(visual, 650)
  expect(result.current.chatActive).toBe(true)
  resize(visual, 844)
  expect(result.current.chatActive).toBe(false)
})

it('닫힌 뒤 입력 포커스가 남아 있어도 편집 화면을 다시 띄우지 않는다', () => {
  const { visual, input, result } = setup(false)
  input.id = 'chat-input'
  act(() => {
    input.focus()
    flushFrames()
  })
  resize(visual, 460)
  resize(visual, 844)
  expect(result.current.chatActive).toBe(false)
  resize(visual, 844)
  expect(result.current.chatActive).toBe(false)
  act(() => input.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(result.current.chatActive).toBe(true)
})
