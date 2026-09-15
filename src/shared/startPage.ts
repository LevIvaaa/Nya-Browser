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
  weather: box(19, 1, 5, 4),

  /*
   * The eight that arrived later, laid out below the fold.
   *
   * None of them is on until somebody switches it on, so where they sit only
   * matters the moment they are: they go under everything that was here
   * before, side by side in pairs, and get dragged wherever they are wanted.
   */
  downloads: box(3, 26, 9, 5),
  playing: box(12, 26, 9, 4),
  todo: box(3, 31, 9, 6),
  notes: box(12, 30, 9, 6),
  calendar: box(3, 37, 9, 7),
  chart: box(12, 36, 9, 5),
  habits: box(12, 41, 9, 5),
  rates: box(3, 44, 9, 5)
}
