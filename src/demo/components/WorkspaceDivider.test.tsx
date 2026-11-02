import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import WorkspaceDivider from './WorkspaceDivider'

afterEach(cleanup)
it('손잡이의 키보드 조작으로 챗봇을 줄이고 지도 공간을 늘리며 최소 폭을 지킨다', () => {
  const { container } = render(
    <div>
      <div />
      <WorkspaceDivider />
      <div />
    </div>,
  )
  const layout = container.firstElementChild as HTMLElement
  Object.defineProperty(layout, 'clientWidth', { value: 1000 })
  const separator = screen.getByRole('separator', { name: '챗봇과 지도 너비 조절' })
  fireEvent.keyDown(separator, { key: 'ArrowLeft' })
  expect(layout.style.getPropertyValue('--chat-width')).toBe('376px')
  fireEvent.keyDown(separator, { key: 'Home' })
  expect(layout.style.getPropertyValue('--chat-width')).toBe('280px')
  fireEvent.keyDown(separator, { key: 'End' })
  expect(layout.style.getPropertyValue('--chat-width')).toBe('640px')
  expect(separator).toHaveAttribute('aria-valuenow', '64')
})
