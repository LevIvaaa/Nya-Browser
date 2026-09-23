import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { ArrowMark, Cross, Eraser, FrameMark, TextMark } from './Icons'

/**
 * Снимок, пока он ещё не файл.
 *
 * Снимок делают не ради снимка: на нём либо на что-то указывают, либо
 * что-то прячут. И то и другое нельзя сделать с картинкой, уже уехавшей в
 * папку загрузок, — её надо оттуда достать, открыть чем-то ещё и сохранить
 * заново. Поэтому снимок останавливается здесь.
 *
 * Четыре инструмента, больше не нужно: стрелка — указать, рамка — обвести,
 * замазка — скрыть, подпись — объяснить.
 *
 * Про замазку отдельно. Она закрашивает, а не размывает. Размытие выглядит
 * надёжным и таковым не является: размытый текст восстанавливают, а пароль
 * или номер карты стоят того, чтобы этого не случилось. Закрашенный пиксель
 * не восстановит никто.
 */

type Tool = 'arrow' | 'box' | 'redact' | 'text'

type Mark =
  | { tool: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { tool: 'box'; x: number; y: number; w: number; h: number }
  | { tool: 'redact'; x: number; y: number; w: number; h: number }
  | { tool: 'text'; x: number; y: number; text: string }

const TOOLS: { id: Tool; label: string; icon: JSX.Element }[] = [
  { id: 'arrow', label: 'Стрелка', icon: <ArrowMark width={14} height={14} /> },
  { id: 'box', label: 'Рамка', icon: <FrameMark width={14} height={14} /> },
  { id: 'redact', label: 'Замазать', icon: <Eraser width={14} height={14} /> },
  { id: 'text', label: 'Текст', icon: <TextMark width={14} height={14} /> }
]

/** Цвет разметки — акцент браузера, чтобы снимок был узнаваемо наш. */
const INK = '#7c6cff'

export default function ShotEditor({ image, onClose }: { image: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const photo = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [marks, setMarks] = useState<Mark[]>([])
  const [drawing, setDrawing] = useState<Mark | null>(null)
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null)
  const [ready, setReady] = useState(false)

  // Картинка приходит строкой; в холст она попадает один раз, дальше холст
  // перерисовывается из неё и списка пометок.
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      photo.current = img
      const box = canvas.current
      if (box) {
        box.width = img.naturalWidth
        box.height = img.naturalHeight
      }
      setReady(true)
    }
    img.src = image
  }, [image])

  /** Перерисовка целиком: снимок, потом всё, что на нём нарисовали. */
  useEffect(() => {
    const box = canvas.current
    const img = photo.current
    if (!box || !img || !ready) return
    const ctx = box.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, box.width, box.height)
    ctx.drawImage(img, 0, 0)

    const scale = Math.max(1, box.width / 900)
    const all = drawing ? [...marks, drawing] : marks

    for (const mark of all) {
      ctx.save()
      ctx.strokeStyle = INK
      ctx.fillStyle = INK
      ctx.lineWidth = 3 * scale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (mark.tool === 'arrow') {
        const { x1, y1, x2, y2 } = mark
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        // Наконечник: две линии под углом к самой стрелке.
        const angle = Math.atan2(y2 - y1, x2 - x1)
        const wing = 16 * scale
        ctx.beginPath()
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - wing * Math.cos(angle - Math.PI / 7), y2 - wing * Math.sin(angle - Math.PI / 7))
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - wing * Math.cos(angle + Math.PI / 7), y2 - wing * Math.sin(angle + Math.PI / 7))
        ctx.stroke()
      } else if (mark.tool === 'box') {
        ctx.strokeRect(mark.x, mark.y, mark.w, mark.h)
      } else if (mark.tool === 'redact') {
        // Плотная заливка, а не размытие: размытое читается обратно.
        ctx.fillStyle = '#12141c'
        ctx.fillRect(mark.x, mark.y, mark.w, mark.h)
      } else {
        ctx.font = `600 ${20 * scale}px system-ui, "Segoe UI", sans-serif`
        ctx.textBaseline = 'top'
        // Подложка под подпись, чтобы она читалась на любом фоне.
        const width = ctx.measureText(mark.text).width
        ctx.fillStyle = 'rgba(18, 20, 28, 0.82)'
        ctx.fillRect(mark.x - 6 * scale, mark.y - 4 * scale, width + 12 * scale, 28 * scale)
        ctx.fillStyle = '#fff'
        ctx.fillText(mark.text, mark.x, mark.y)
      }
      ctx.restore()
    }
  }, [marks, drawing, ready])

  /** Точка в координатах снимка, а не окна: холст показан уменьшенным. */
  const at = (event: React.PointerEvent) => {
    const box = canvas.current
    if (!box) return { x: 0, y: 0 }
    const rect = box.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * box.width,
      y: ((event.clientY - rect.top) / rect.height) * box.height
    }
  }

  const down = (event: React.PointerEvent) => {
    if (typing) return
    const { x, y } = at(event)
    // Подпись заводится на клике, а не здесь. Поле, созданное по нажатию,
    // получает фокус — и тут же его теряет, потому что следом приходит
    // отпускание кнопки и уводит фокус на страницу. onBlur видит пустую
    // подпись и закрывает поле: набрать в него не успевал никто.
    if (tool === 'text') {
      event.preventDefault()
      return
    }
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    // Подпись уже ушла выше, значит здесь только стрелка, рамка и замазка.
    setDrawing(
      tool === 'arrow'
        ? { tool: 'arrow', x1: x, y1: y, x2: x, y2: y }
        : { tool: tool === 'box' ? 'box' : 'redact', x, y, w: 0, h: 0 }
    )
  }

  const move = (event: React.PointerEvent) => {
    if (!drawing) return
    const { x, y } = at(event)
    if (drawing.tool === 'arrow') {
      setDrawing({ ...drawing, x2: x, y2: y })
    } else if (drawing.tool === 'box' || drawing.tool === 'redact') {
      setDrawing({ ...drawing, w: x - drawing.x, h: y - drawing.y })
    }
  }

  const up = () => {
    if (!drawing) return
    if (drawing.tool === 'arrow') {
      // Случайный клик без движения — не пометка.
      if (Math.hypot(drawing.x2 - drawing.x1, drawing.y2 - drawing.y1) > 8) {
        setMarks((was) => [...was, drawing])
      }
    } else if (drawing.tool === 'box' || drawing.tool === 'redact') {
      if (Math.abs(drawing.w) > 6 && Math.abs(drawing.h) > 6) {
        // Прямоугольник, нарисованный справа налево, имеет отрицательный
        // размер; холст такого не понимает.
        setMarks((was) => [
          ...was,
          {
            tool: drawing.tool,
            x: drawing.w < 0 ? drawing.x + drawing.w : drawing.x,
            y: drawing.h < 0 ? drawing.y + drawing.h : drawing.y,
            w: Math.abs(drawing.w),
            h: Math.abs(drawing.h)
          }
        ])
      }
    }
    setDrawing(null)
  }

  /**
   * Куда поставить поле ввода.
   *
   * Холст показан уменьшенным и стоит по центру блока, который шире его.
   * Поэтому доля от ширины блока — это не то же самое, что доля от снимка, и
   * поле уезжало в сторону от места, куда ткнули.
   */
  const spotOf = (x: number, y: number) => {
    const box = canvas.current
    const wrap = box?.parentElement
    if (!box || !wrap) return { left: 0, top: 0 }
    const r = box.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    return {
      left: r.left - w.left + (x / box.width) * r.width,
      top: r.top - w.top + (y / box.height) * r.height
    }
  }

  const startText = (event: React.MouseEvent) => {
    if (tool !== 'text' || typing) return
    const box = canvas.current
    if (!box) return
    const r = box.getBoundingClientRect()
    setTyping({
      x: ((event.clientX - r.left) / r.width) * box.width,
      y: ((event.clientY - r.top) / r.height) * box.height,
      text: ''
    })
  }

  const commitText = () => {
    if (typing && typing.text.trim()) {
      setMarks((was) => [...was, { tool: 'text', x: typing.x, y: typing.y, text: typing.text.trim() }])
    }
    setTyping(null)
  }

  const undo = () => setMarks((was) => was.slice(0, -1))

  const out = () => canvas.current?.toDataURL('image/png') ?? ''

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (typing) return setTyping(null)
        onClose()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !typing) undo()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [typing, onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-6"
      style={{ background: 'rgba(8, 9, 13, 0.82)', backdropFilter: 'blur(18px)' }}>
      {/* Инструменты над снимком: их четыре, и прятать их некуда. */}
      <div className="animate-fade-up flex items-center gap-1.5">
        {TOOLS.map((one) => (
          <button
            key={one.id}
            className="btn"
            onClick={() => setTool(one.id)}
            style={
              tool === one.id
                ? { background: 'color-mix(in srgb, var(--accent) 24%, transparent)', color: 'var(--accent)' }
                : undefined
            }
          >
            {one.icon}
            {t(one.label)}
          </button>
        ))}
        <button className="btn" onClick={undo} disabled={marks.length === 0}>
          {t('Отменить')}
        </button>
      </div>

      <div className="relative min-h-0 flex-1" style={{ maxWidth: '100%' }}>
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onClick={startText}
          className="animate-fade-up block h-full w-auto max-w-full rounded-[var(--radius)]"
          style={{
            objectFit: 'contain',
            boxShadow: 'var(--shadow-xl)',
            cursor: tool === 'text' ? 'text' : 'crosshair',
            touchAction: 'none'
          }}
        />
        {typing && (
          <input
            autoFocus
            value={typing.text}
            onChange={(event) => setTyping({ ...typing, text: event.target.value })}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitText()
            }}
            placeholder={t('Подпись')}
            className="field focus-ring absolute"
            style={{
              left: spotOf(typing.x, typing.y).left,
              top: spotOf(typing.x, typing.y).top,
              width: 220
            }}
          />
        )}
      </div>

      <div className="animate-fade-up flex items-center gap-2">
        <button
          className="btn btn-primary"
          onClick={async () => {
            await window.browser.keepShot(out())
            onClose()
          }}
        >
          {t('Сохранить')}
        </button>
        <button
          className="btn"
          onClick={async () => {
            await window.browser.copyShot(out())
            onClose()
          }}
        >
          {t('Копировать')}
        </button>
        <button className="btn" onClick={onClose}>
          <Cross width={14} height={14} />
          {t('Отмена')}
        </button>
      </div>
    </div>
  )
}
