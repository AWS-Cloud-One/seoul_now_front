import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LayerMenu, MapLegend } from './MapOverlays'
import { setMapOverlay } from './useRoute'

const { layers, toggleLayer } = vi.hoisted(() => ({
  layers: { roads: true, parking: false, population: false },
  toggleLayer: vi.fn(),
}))
vi.mock('../../useDemo', () => ({ useDemo: () => ({ layers, toggleLayer }) }))
vi.mock('../../live/store', () => ({
  useLive: () => ({ places: [], savedPlaces: [], status: 'idle' }),
}))
vi.mock('./layout', () => ({ useLayout: () => ({ legendOpen: true }) }))

afterEach(() => {
  cleanup()
  setMapOverlay({ route: null })
  layers.roads = true
})

it('길찾기 중에도 전체 도로 혼잡도를 켜고 끌 수 있고 범례가 표시 상태를 따른다', async () => {
  setMapOverlay({
    route: [
      [37.55, 126.97],
      [37.52, 126.92],
    ],
  })
  const content = (
    <>
      <LayerMenu />
      <MapLegend />
    </>
  )
  const view = render(content)
  const toggle = screen.getByRole('button', { name: '도로혼잡도 표시' })
  expect(toggle).toBeEnabled()
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: '도로 소통 (km/h)' })).toBeInTheDocument()
  await userEvent.click(toggle)
  expect(toggleLayer).toHaveBeenCalledWith('roads')
  layers.roads = false
  view.rerender(
    <>
      <LayerMenu />
      <MapLegend />
    </>,
  )
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toBeEnabled()
  expect(screen.queryByRole('heading', { name: '도로 소통 (km/h)' })).not.toBeInTheDocument()
})
