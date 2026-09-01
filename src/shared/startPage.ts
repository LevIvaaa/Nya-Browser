import type { WidgetBox, WidgetId } from './types'

/**
 * The canvas the start page arranges itself on. The grid is the same on every
 * screen, so a layout arranged in one window looks the same in another.
 */
export const GRID_COLUMNS = 24
export const GRID_ROW = 34
export const GRID_GAP = 10

const box = (x: number, y: number, w: number, h: number, scale = 1): WidgetBox => ({ x, y, w, h, scale })

/**
 * The arrangement everyone starts from: the clock and the search field down
 * the middle, tiles under them, the two lists side by side, and the weather
 * out of the way in the top right corner.
 */
export const DEFAULT_LAYOUT: Record<WidgetId, WidgetBox> = {
  clock: box(9, 1, 6, 3),
  greeting: box(7, 4, 10, 2),
  search: box(6, 6, 12, 2),
  favorites: box(3, 9, 18, 6),
  stats: box(3, 16, 9, 4),
  recent: box(12, 16, 9, 4),
  closed: box(3, 21, 18, 4),
  weather: box(19, 1, 5, 4)
}
