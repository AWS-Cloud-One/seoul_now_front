import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import OriginControl from './OriginControl'
import { openOriginPicker, setOrigin } from '../../state/origin'
import { screenOrigin } from '../../api/screenTestApi'

it('출발지가 없으면 설정 버튼을 보여주고 눌러서 검색 창을 열고 닫는다', async () => {
  const user = userEvent.setup()
  render(<OriginControl />)
  const button = screen.getByRole('button', { name: '출발지 설정' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('dialog', { name: '출발지 설정' })).not.toBeInTheDocument()
  await user.click(button)
  expect(screen.getByRole('dialog', { name: '출발지 설정' })).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: /어디에서 출발하세요/ })).toBeInTheDocument()
  await user.click(button)
  expect(screen.queryByRole('dialog', { name: '출발지 설정' })).not.toBeInTheDocument()
  await user.click(button)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: '출발지 설정' })).not.toBeInTheDocument()
})

it('출발지를 고르면 창이 닫히고 버튼에 출발지가 표시된다', () => {
  render(<OriginControl />)
  act(() => openOriginPicker())
  expect(screen.getByRole('dialog', { name: '출발지 설정' })).toBeInTheDocument()
  act(() => setOrigin({ ...screenOrigin, label: '강남역' }))
  expect(screen.queryByRole('dialog', { name: '출발지 설정' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '출발지 강남역, 변경' })).toHaveTextContent('강남역')
})
