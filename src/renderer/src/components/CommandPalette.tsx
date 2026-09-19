import { t } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomEngine, SearchEngine, Suggestion } from '../../../shared/types'
import { Alert, Clock, Copy, Cross, Globe, Search, Star, Tabs } from './Icons'
import { cx } from './ui'

const iconFor = (kind: Suggestion['kind']) => {
  if (kind === 'search') return <Search width={15} height={15} />
  if (kind === 'history') return <Clock width={15} height={15} />
  if (kind === 'favorite') return <Star width={15} height={15} />
  if (kind === 'tab') return <Tabs width={15} height={15} />
  return <Globe width={15} height={15} />
}

/**
 * Address input and suggestions in one overlay. Suggestions come only from the
 * local profile — the tabs already open, history, favourites and bookmarks —
 * so keystrokes never leave the machine before you press Enter.
 *
 * Open tabs are listed first and picking one switches to it. With twenty tabs
 * the page you are after is usually already one of them, and opening a second
 * copy is the wrong answer to "where did that go".
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
  /** the row of other engines, shown when asked for */
  const [elsewhere, setElsewhere] = useState(false)
  const [engines, setEngines] = useState<SearchEngine[]>([])
  /** the list of engines to become the default one, shown when asked for */
  const [picking, setPicking] = useState(false)
  /** engines somebody added themselves, offered alongside the built-in ones */
  const [mine, setMine] = useState<CustomEngine[]>([])

  useEffect(() => {
    void window.browser.getEngines().then(setEngines)
    void window.browser.getSettings().then((s) => setMine(s.customEngines))
  }, [])

  /* Everywhere the same words could go: the engines that ship with the
     browser, minus the one they are going to anyway, plus anything added
     by hand. */
  const others = useMemo(
    () => [
      ...engines
        .filter((one) => one.id !== 'custom' && one.id !== engine.id)
        .map((one) => ({ name: one.name, template: one.template })),
      ...mine.filter((one) => one.template.includes('%s')).map((one) => ({ name: one.name || one.key, template: one.template }))
    ],
    [engines, mine, engine.id]
  )
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

  /** What is on the clipboard, gone to in one press. */
  const pasteAndGo = async () => {
    const text = (await window.browser.readText()).trim()
    if (!text) return
    void window.browser.navigate(text)
    onClose()
  }

  const go = (target?: Suggestion) => {
    if (target?.kind === 'tab' && target.tabId !== undefined) {
      void window.browser.switchTab(target.tabId)
      return onClose()
    }
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
      // Completing to a tab's address would lose the tab; only addresses you
      // could type yourself are worth completing to.
      if (items[cursor].kind !== 'tab') setValue(items[cursor].url)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const picked = items[cursor]
      // Typing something new and hitting Enter uses exactly what was typed.
      return go(picked && picked.title !== value ? picked : undefined)
    }
  }

  const hint = useMemo(
    () => (value.trim() ? t('Enter — открыть · {engine}', { engine: engine.name }) : t('Введите адрес или запрос')),
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
          {/* Where a search would go, said out loud rather than guessed at —
              and changed here, without a trip to the settings. */}
          <button
            className="icon-btn h-8 w-8 shrink-0"
            title={t('Поисковик: {name}', { name: engine.name })}
            onClick={() => {
              setPicking(!picking)
              setElsewhere(false)
            }}
            style={{ color: picking ? 'var(--accent)' : 'var(--text-faint)' }}
          >
            <Search width={18} height={18} />
          </button>
          <input
            ref={input}
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('Поиск или адрес сайта')}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
          />
          {/* The same words, somewhere else. One press rather than retyping
              them into another engine's box. */}
          {value.trim() && (
            <button
              className="icon-btn h-8 w-8 shrink-0"
              title={t('Искать в другом поисковике')}
              onClick={() => {
                setElsewhere(!elsewhere)
                setPicking(false)
              }}
              style={{ color: elsewhere ? 'var(--accent)' : undefined }}
            >
              <Globe width={15} height={15} />
            </button>
          )}
          <button
            className="icon-btn h-8 w-8 shrink-0"
            title={t('Вставить и перейти')}
            onClick={() => void pasteAndGo()}
          >
            <Copy width={15} height={15} />
          </button>
          <kbd className="shrink-0 rounded-[7px] px-2 py-1 text-2xs font-medium text-faint" style={{ background: 'var(--field-idle)' }}>
            Esc
          </kbd>
        </div>

        {/* The engine everything goes to from now on. */}
        {picking && (
          <div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
            {engines
              .filter((one) => one.id !== 'custom')
              .map((one) => (
                <button
                  key={one.id}
                  className="h-[26px] rounded-pill px-3 text-2xs font-medium"
                  style={{
                    background: one.id === engine.id ? 'var(--accent)' : 'var(--field-idle)',
                    color: one.id === engine.id ? '#fff' : 'var(--text-dim)'
                  }}
                  onClick={() => {
                    void window.browser.setSettings({ searchEngine: one.id })
                    setPicking(false)
                  }}
                >
                  {one.name}
                </button>
              ))}
          </div>
        )}

        {/* Every other engine, with the words already in them. */}
        {elsewhere && value.trim() && (
          <div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
            {others.map((one) => (
              <button
                key={one.name + one.template}
                className="h-[26px] rounded-pill px-3 text-2xs font-medium"
                style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
                onClick={() => {
                  void window.browser.navigate(one.template.replace('%s', encodeURIComponent(value.trim())))
                  onClose()
                }}
              >
                {one.name}
              </button>
            ))}
          </div>
        )}

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
                <span
                  className="shrink-0"
                  style={{ color: item.warn ? 'var(--warn)' : item.answer ? 'var(--accent)' : 'var(--text-dim)' }}
                >
                  {item.warn ? <Alert width={15} height={15} /> : iconFor(item.kind)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cx('block truncate', item.answer ? 'text-[19px] font-semibold' : 'text-base')}
                    style={item.warn ? { color: 'var(--warn)' } : undefined}
                  >
                    {item.title}
                  </span>
                  <span className="block truncate text-sm text-faint">
                    {item.subtitle ?? readable(item.url)}
                  </span>
                </span>
                {item.visits && item.visits > 1 && (
                  <span className="shrink-0 text-2xs text-faint">{item.visits}×</span>
                )}
                {/* Off the list for good: the row that keeps coming back. */}
                {item.forgettable && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t('Убрать из подсказок')}
                    title={t('Убрать из подсказок')}
                    className="icon-btn h-6 w-6 shrink-0"
                    onClick={(event) => {
                      event.stopPropagation()
                      void window.browser.forgetSuggestion(item.url)
                      setItems((list) => list.filter((row) => row.url !== item.url))
                    }}
                  >
                    <Cross width={12} height={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* One line, and only while it says something: what Enter will do.
            «Введите адрес или запрос» under an empty field with that very
            placeholder, and a note that the suggestions are local, were two
            labels nobody ever needed to read twice. */}
        {value.trim() && (
          <div
            className="border-t px-4 py-2 text-2xs text-faint"
            style={{ borderColor: 'var(--line)' }}
          >
            {hint}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * An address as it was written rather than as it is sent.
 *
 * A Russian Wikipedia link is two thirds percent-escapes on the wire, and
 * showing that in a list of suggestions is showing a wall of `%D0%97%D0%B0`
 * where the title of the page should be. Decoding is display-only: what is
 * opened is always the original.
 */
function readable(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}
