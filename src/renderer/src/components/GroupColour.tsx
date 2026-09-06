import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import type { TabGroup } from '../../../shared/types'
import { cx } from './ui'

/**
 * A colour of your own for a tab group.
 *
 * Electron has no colour chooser — an `<input type="color">` opens nothing at
 * all, checked with a visible one and a real gesture — so this is the picker.
 * It lives in the overlay because the tab strip is drawn under the page view,
 * and anything hanging below a chip would be behind the page.
 *
 * Hue, saturation and lightness rather than a square to drag in: three sliders
 * can be used from the keyboard, say what they do, and cannot put the dot
 * somewhere you cannot see.
 */

const PRESETS = ['#7c6cff', '#2fbf71', '#f5a524', '#e5484d', '#38bdf8', '#e879f9', '#94a3b8']

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

function hexOf(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const part = (n: number) => {
    const k = (n + h / 30) % 12
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${part(0)}${part(8)}${part(4)}`
}

function hslOf(hex: string): { h: number; s: number; l: number } {
  const value = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!value) return { h: 250, s: 80, l: 70 }
  const int = parseInt(value[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return {
    h: Math.round(((h * 60) % 360 + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  }
}

export default function GroupColour({
  group,
  onClose
}: {
  group: TabGroup | null
  onClose: () => void
}) {
  const start = useMemo(() => hslOf(group?.color ?? PRESETS[0]), [group?.color])
  const [h, setH] = useState(start.h)
  const [s, setS] = useState(start.s)
  const [l, setL] = useState(start.l)
  // The exact colour, when one was named rather than dialled. Going through
  // hue/saturation/lightness and back rounds to whole degrees and percents, so
  // a named #2fbf71 would come back as #2fc173 — close, and not the colour that
  // was asked for. A slider clears this and takes over.
  const [typed, setTyped] = useState(group?.color ?? '')

  const colour = typed && /^#[0-9a-f]{6}$/i.test(typed) ? typed.toLowerCase() : hexOf(h, s, l)

  // Live, so the strip shows the colour while it is being chosen and the
  // choice is made against the thing itself rather than a swatch.
  useEffect(() => {
    if (group) void window.browser.setGroupColour(group.id, colour)
  }, [colour, group?.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Enter') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!group) return null

  const track = (to: string) => ({
    background: `linear-gradient(to right, ${hexOf(h, s, l).slice(0, 0)}${to})`
  })

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center" onClick={onClose}>
      <div
        className="animate-fade absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg) 40%, transparent)' }}
      />

      <div
        className="animate-sheet contain relative mt-[12vh] w-[min(340px,92vw)] overflow-hidden rounded-card p-4"
        style={{
          background: 'var(--elevated)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid var(--line)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span
            className="h-6 w-6 shrink-0 rounded-[8px]"
            style={{ background: colour, border: '1px solid var(--line)' }}
          />
          <span className="min-w-0 flex-1 truncate text-base font-medium">{group.name}</span>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              aria-label={preset}
              onClick={() => {
                const next = hslOf(preset)
                setTyped(preset)
                setH(next.h)
                setS(next.s)
                setL(next.l)
              }}
              className={cx('h-7 w-7 rounded-[8px]')}
              style={{
                background: preset,
                outline: colour === preset ? '2px solid var(--text)' : '1px solid var(--line)',
                outlineOffset: colour === preset ? 2 : -1
              }}
            />
          ))}
        </div>

        <label className="mb-2 block">
          <span className="mb-1 block text-2xs uppercase tracking-wider text-faint">{t('Оттенок')}</span>
          <input
            type="range"
            min={0}
            max={359}
            value={h}
            onChange={(event) => {
              setTyped('')
              setH(Number(event.target.value))
            }}
            className="h-2 w-full appearance-none rounded-pill"
            style={{
              background:
                'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)'
            }}
          />
        </label>

        <label className="mb-2 block">
          <span className="mb-1 block text-2xs uppercase tracking-wider text-faint">
            {t('Насыщенность')}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={s}
            onChange={(event) => {
              setTyped('')
              setS(Number(event.target.value))
            }}
            className="h-2 w-full appearance-none rounded-pill"
            style={track(`${hexOf(h, 0, l)}, ${hexOf(h, 100, l)}`)}
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-2xs uppercase tracking-wider text-faint">
            {t('Светлота')}
          </span>
          <input
            type="range"
            min={5}
            max={95}
            value={l}
            onChange={(event) => {
              setTyped('')
              setL(Number(event.target.value))
            }}
            className="h-2 w-full appearance-none rounded-pill"
            style={track(`${hexOf(h, s, 10)}, ${hexOf(h, s, 50)}, ${hexOf(h, s, 90)}`)}
          />
        </label>

        <div className="flex items-center gap-2">
          <input
            value={typed || colour}
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value
              setTyped(next)
              if (/^#[0-9a-f]{6}$/i.test(next.trim())) {
                const parsed = hslOf(next.trim())
                setH(parsed.h)
                setS(parsed.s)
                setL(clamp(parsed.l, 5, 95))
              }
            }}
            className="min-w-0 flex-1 rounded-[8px] px-2 py-1.5 font-mono text-sm outline-none"
            style={{ background: 'var(--field-idle)', border: '1px solid var(--line)' }}
          />
          <button className="btn btn-primary" onClick={onClose}>
            {t('Готово')}
          </button>
        </div>
      </div>
    </div>
  )
}
