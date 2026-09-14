import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'

/**
 * What happens to a screenshot between taking it and keeping it.
 *
 * Until now a screenshot went straight to the downloads folder and the
 * clipboard, which is fine for a picture of a whole page and useless for the
 * thing people actually take screenshots for: pointing at something, and
 * hiding the rest. So the picture stops here first — an arrow, a box, a
 * smudge over what should not be read, a word — and is kept when it is ready.
 *
 * Everything is drawn straight onto the picture at its own size. What you see
 * is the same canvas, scaled down to fit the window, so a save is exactly
 * what was on screen.
 */
type Tool = 'arrow' | 'box' | 'blur' | 'text'

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'box', label: 'Рамка' },
  { id: 'blur', label: 'Замазать' },
  { id: 'text', label: 'Текст' }
]

interface Mark {
  tool: Tool
  from: { x: number; y: number }
  to: { x: number; y: number }
  text?: string
}

export default function ShotEditor({ image, onClose }: { image: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const source = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [marks, setMarks] = useState<Mark[]>([])
  const [drawing, setDrawing] = useState<Mark | null>(null)
  const [typing, setTyping] = useState<{ x: number; y: number; value: string } | null>(null)
  const [ready, setReady] = useState(false)

  // The picture arrives as a data URL and is the only thing the canvas is
  // ever built from: every redraw starts by putting it back.
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      source.current = img
      if (canvas.current) {
        canvas.current.width = img.naturalWidth
        canvas.current.height = img.naturalHeight
      }
      setReady(true)
    }
    img.src = image
  }, [image])

  useEffect(() => {
    const box = canvas.current
    const img = source.current
    if (!box || !img || !ready) return
    const ctx = box.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    const all = drawing ? [...marks, drawing] : marks
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c6cff'
    // A line thick enough to be seen on a screenshot of a screenshot.
    const weight = Math.max(2, Math.round(box.width / 400))
    for (const mark of all) {
      ctx.strokeStyle = accent
      ctx.fillStyle = accent
      ctx.lineWidth = weight
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (mark.tool === 'box') {
        ctx.strokeRect(
          Math.min(mark.from.x, mark.to.x),
          Math.min(mark.from.y, mark.to.y),
          Math.abs(mark.to.x - mark.from.x),
          Math.abs(mark.to.y - mark.from.y)
        )
      } else if (mark.tool === 'arrow') {
        const angle = Math.atan2(mark.to.y - mark.from.y, mark.to.x - mark.from.x)
        const head = Math.max(10, weight * 5)
        ctx.beginPath()
        ctx.moveTo(mark.from.x, mark.from.y)
        ctx.lineTo(mark.to.x, mark.to.y)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(mark.to.x, mark.to.y)
        ctx.lineTo(mark.to.x - head * Math.cos(angle - Math.PI / 7), mark.to.y - head * Math.sin(angle - Math.PI / 7))
        ctx.lineTo(mark.to.x - head * Math.cos(angle + Math.PI / 7), mark.to.y - head * Math.sin(angle + Math.PI / 7))
        ctx.closePath()
        ctx.fill()
      } else if (mark.tool === 'blur') {
        const x = Math.min(mark.from.x, mark.to.x)
        const y = Math.min(mark.from.y, mark.to.y)
        const w = Math.abs(mark.to.x - mark.from.x)
        const h = Math.abs(mark.to.y - mark.from.y)
        if (w > 4 && h > 4) {
          // Not a blur but a coarsening: a blurred password can be recovered,
          // a pixel four hundred times too big cannot.
          const small = document.createElement('canvas')
          small.width = Math.max(1, Math.round(w / 14))
          small.height = Math.max(1, Math.round(h / 14))
          const tiny = small.getContext('2d')
          if (tiny) {
            tiny.drawImage(box, x, y, w, h, 0, 0, small.width, small.height)
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
            ctx.imageSmoothingEnabled = true
          }
        }
      } else if (mark.tool === 'text' && mark.text) {
        const size = Math.max(16, Math.round(box.width / 40))
        ctx.font = `600 ${size}px system-ui, sans-serif`
        ctx.textBaseline = 'top'
        const width = ctx.measureText(mark.text).width
        ctx.fillStyle = 'rgba(12, 13, 18, 0.72)'
        ctx.fillRect(mark.from.x - 6, mark.from.y - 4, width + 12, size + 8)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(mark.text, mark.from.x, mark.from.y)
      }
    }
  }, [marks, drawing, ready])

  /** Window pixels to picture pixels: the canvas is shown scaled down. */
  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = canvas.current
    if (!box) return { x: 0, y: 0 }
    const rect = box.getBoundingClientRect()
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * box.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * box.height)
    }
  }

  const finish = (keep: 'save' | 'copy') => {
    const box = canvas.current
    if (!box) return
    const data = box.toDataURL('image/png')
    if (keep === 'save') void window.browser.keepShot(data)
    else void window.browser.copyShot(data)
    onClose()
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <div className="flex items-center gap-2">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium"
            style={{
              background: tool === item.id ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--field-idle)',
              color: tool === item.id ? 'var(--accent)' : 'var(--text-dim)'
            }}
            onClick={() => setTool(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
        <button className="btn" disabled={marks.length === 0} onClick={() => setMarks(marks.slice(0, -1))}>
          {t('Отменить')}
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <canvas
          ref={canvas}
          className="max-h-full max-w-full rounded-[var(--radius)]"
          style={{ boxShadow: 'var(--shadow-lg)', cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={(event) => {
            const point = at(event)
            if (tool === 'text') {
              setTyping({ ...point, value: '' })
              return
            }
            event.currentTarget.setPointerCapture(event.pointerId)
            setDrawing({ tool, from: point, to: point })
          }}
          onPointerMove={(event) => {
            if (!drawing) return
            setDrawing({ ...drawing, to: at(event) })
          }}
          onPointerUp={(event) => {
            if (!drawing) return
            const to = at(event)
            const far = Math.abs(to.x - drawing.from.x) + Math.abs(to.y - drawing.from.y) > 6
            if (far) setMarks([...marks, { ...drawing, to }])
            setDrawing(null)
          }}
        />
      </div>

      {typing && (
        <input
          autoFocus
          value={typing.value}
          onChange={(event) => setTyping({ ...typing, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setTyping(null)
            if (event.key !== 'Enter') return
            if (typing.value.trim()) {
              setMarks([...marks, { tool: 'text', from: typing, to: typing, text: typing.value.trim() }])
            }
            setTyping(null)
          }}
          placeholder={t('Текст')}
          className="w-[280px] rounded-[var(--radius-md)] px-3 py-2 text-base outline-none"
          style={{ background: 'var(--field)', border: '1px solid var(--line)' }}
        />
      )}

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" onClick={() => finish('save')}>
          {t('Сохранить')}
        </button>
        <button className="btn" onClick={() => finish('copy')}>
          {t('Копировать')}
        </button>
        <button className="btn" onClick={onClose}>
          {t('Отмена')}
        </button>
      </div>
    </div>
  )
}
