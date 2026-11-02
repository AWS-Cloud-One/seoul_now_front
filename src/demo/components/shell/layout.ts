import { createContext, useContext } from 'react'

/**
 * Layout mode derived from the left panel's width (not from the window alone), so dragging the
 * panel handle re-arranges the map overlays:
 * - wide: the panel is more than a third of the screen → the selected place lives in the panel
 *   and the map shows no place card.
 * - legendOpen: the map is roomy enough to show the spread-out legend next to the place card;
 *   otherwise the legend folds into the "지도 정보" popover.
 */
export type Layout = { wide: boolean; legendOpen: boolean }

export const LayoutContext = createContext<Layout>({ wide: false, legendOpen: true })
export const useLayout = () => useContext(LayoutContext)

/** Legend (~500px) + place card (~360px) + gutters need this much map width. */
const LEGEND_AND_CARD = 960
/** Dead zone around each threshold so dragging near it does not make elements flicker. */
const HYSTERESIS = 16
const RAIL = 72

export function nextLayout(prev: Layout, panelWidth: number, viewport: number): Layout {
  // Phones use the bottom sheet; the compact legend stays and the place card is not shown.
  if (viewport <= 900) return { wide: false, legendOpen: true }
  const third = viewport / 3
  const wide = prev.wide ? panelWidth > third - HYSTERESIS : panelWidth > third + HYSTERESIS
  const mapWidth = viewport - RAIL - panelWidth
  const legendOpen =
    !wide &&
    (prev.legendOpen
      ? mapWidth >= LEGEND_AND_CARD - HYSTERESIS
      : mapWidth >= LEGEND_AND_CARD + HYSTERESIS)
  return { wide, legendOpen }
}
