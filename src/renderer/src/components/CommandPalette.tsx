import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchEngine, Suggestion } from '../../../shared/types'
import { Clock, Globe, Search, Star } from './Icons'
import { cx } from './ui'

const iconFor = (kind: Suggestion['kind']) => {
  if (kind === 'search') return <Search width={15} height={15} />
  if (kind === 'history') return <Clock width={15} height={15} />
  if (kind === 'favorite') return <Star width={15} height={15} />
  return <Globe width={15} height={15} />
}

/**
 * Address input and suggestions in one overlay. Suggestions come only from the
 * local profile — history, favourites and bookmarks — so keystrokes never leave
 * the machine before you press Enter.
 */
export default function CommandPalette({
  initialValue,
  engine,
  onClose
}: {
  initialValue: string
  engine: SearchEngine
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [items, setItems] = useState<Suggestion[]>([])
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const result = await window.browser.suggest(value)
      setItems(result)
      setCursor(0)
      if (value.trim()) void window.browser.preconnect(value)
    }, 55)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value])

  const go = (target?: Suggestion) => {
    const url = target ? target.url : value
    if (!url.trim()) return onClose()
    void window.browser.navigate(url)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      return onClose()
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      return setCursor((current) => (items.length ? (current + 1) % items.length : 0))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      return setCursor((current) => (items.length ? (current - 1 + items.length) % items.length : 0))
    }
    if (event.key === 'Tab' && items[cursor]) {
      event.preventDefault()
      return setValue(items[cursor].url)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const picked = items[cursor]
      // Typing something new and hitting Enter uses exactly what was typed.
      return go(picked && picked.title !== value ? picked : undefined)
    }
  }

  const hint = useMemo(
    () => (value.trim() ? `Enter — открыть · ${engine.name}` : 'Введите адрес или запрос'),
    [value, engine.name]
  )

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center" onClick={onClose}>
      <div
        className="animate-fade absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg) 58%, transparent)', backdropFilter: 'blur(10px)' }}
      />

      <div
        className="animate-sheet contain relative mt-[11vh] w-[min(720px,92vw)] overflow-hidden rounded-card"
        style={{
          background: 'var(--elevated)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid var(--line)'
        }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4" style={{ height: 58 }}>
          <Search width={18} height={18} className="shrink-0 text-faint" />
          <input
            ref={input}
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder="Поиск или адрес сайта"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded-[7px] px-2 py-1 text-2xs font-medium text-faint" style={{ background: 'var(--field-idle)' }}>
            Esc
          </kbd>
        </div>

        {items.length > 0 && (
          <div className="max-h-[48vh] overflow-y-auto border-t px-2 py-2" style={{ borderColor: 'var(--line)' }}>
            {items.map((item, index) => (
              <button
                key={item.url + index}
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(item)}
                className={cx('flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left')}
                style={{
                  background: index === cursor ? 'var(--surface-hover)' : 'transparent',
                  transition: 'background var(--t-fast) linear'
                }}
              >
                <span className="shrink-0 text-dim">{iconFor(item.kind)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base">{item.title}</span>
                  <span className="block truncate text-sm text-faint">{item.subtitle ?? item.url}</span>
                </span>
                {item.visits && item.visits > 1 && (
                  <span className="shrink-0 text-2xs text-faint">{item.visits}×</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div
          className="flex items-center justify-between border-t px-4 py-2 text-2xs text-faint"
          style={{ borderColor: 'var(--line)' }}
        >
          <span>{hint}</span>
          <span>Подсказки только из локального профиля</span>
        </div>
      </div>
    </div>
  )
}
