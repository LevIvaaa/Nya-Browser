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

  useEffect(() => window.browser.onSplit(setSplit), [])

  // While the handle is held, the pointer is captured here — a mouse moving
  // over a page view is gone as far as this renderer is concerned, so the
  // capture is what keeps the drag alive across it.
  useEffect(() => {
    if (!dragging || !split) return
    const move = (event: PointerEvent) => {
      const width = split.rect.width
      if (width <= 0) return
      void window.browser.setSplitRatio((event.clientX - split.rect.x) / width)
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, split])

  if (!split) return null

  const gap = 8
  const left = split.rect.x + Math.round((split.rect.width - gap) * split.ratio)

  return (
    <div
      ref={box}
      className="no-drag absolute"
      title={t('Потяните, чтобы поделить')}
      style={{
        left,
        top: split.rect.y,
        width: gap,
        height: split.rect.height,
        cursor: 'col-resize',
        background: dragging ? 'var(--accent)' : 'var(--line)',
        transition: dragging ? 'none' : 'background var(--t-fast) linear',
        zIndex: 5
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDoubleClick={() => void window.browser.setSplitRatio(0.5)}
    />
  )
}
