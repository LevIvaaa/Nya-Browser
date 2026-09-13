import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { SplitState } from '../../../shared/types'

/**
 * The handle between two pages shown side by side.
 *
 * Page views are native layers above this interface, so nothing drawn here can
 * appear over a page — but the two pages are laid out with a gap between them,
 * and through that gap this is the only thing there is. That is why the gap
 * exists: it is the one place a control can live between two pages.
 */
export default function SplitDivider() {
  const [split, setSplit] = useState<SplitState | null>(null)
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Asked for, not only waited for: a window that has just come up was told
    // about its restored pair before it existed to hear it.
    void window.browser.splitState().then(setSplit)
    return window.browser.onSplit(setSplit)
  }, [])

  // While the handle is held, the pointer is captured here — a mouse moving
  // over a page view is gone as far as this renderer is concerned, so the
  // capture is what keeps the drag alive across it.
  useEffect(() => {
    const rect = split?.rect
    if (!dragging || !rect) return
    const move = (event: PointerEvent) => {
      const width = rect.width
      if (width <= 0) return
      void window.browser.setSplitRatio((event.clientX - rect.x) / width)
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, split])

  // The pair can stand while there is nothing to divide — one of the browser's
  // own pages fills the window, and a line down the middle of it would divide
  // nothing.
  const rect = split?.rect
  if (!split || !rect) return null

  const gap = 8
  const left = rect.x + Math.round((rect.width - gap) * split.ratio)

  return (
    <div
      ref={box}
      className="no-drag animate-fade absolute flex items-center justify-center"
      title={t('Потяните, чтобы поделить')}
      style={{
        left,
        top: rect.y,
        width: gap,
        height: rect.height,
        cursor: 'col-resize',
        background: dragging ? 'var(--accent)' : 'var(--line)',
        transition: dragging ? 'none' : 'background var(--t-fast) linear',
        // Above the page area of the interface, which is where it lies.
        zIndex: 25
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDoubleClick={() => void window.browser.setSplitRatio(0.5)}
    >
      {/* Something to take hold of. It grows under the pointer, which is the
          only way a three-pixel line can say it is a control. */}
      <span
        className="pointer-events-none rounded-pill"
        style={{
          width: 3,
          height: dragging ? 72 : 40,
          // Light enough to be seen against the line it sits in, in either
          // theme: a grip nobody can find is not a grip.
          background: dragging ? 'var(--bg)' : 'var(--text-dim)',
          opacity: dragging ? 0.85 : 0.75,
          transition: 'height var(--t-base) var(--ease-out), opacity var(--t-fast) linear'
        }}
      />
    </div>
  )
}
