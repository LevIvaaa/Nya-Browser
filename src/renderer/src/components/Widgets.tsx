/**
 * The widgets that came after the first eight.
 *
 * They live in their own file because the start page was already a thousand
 * lines and because they have something in common the first eight do not: each
 * of them fetches or keeps something of its own — a list of files, a fortnight
 * of counts, a note somebody wrote — rather than drawing what the page was
 * already handed.
 *
 * Every one of them is off until somebody switches it on. A start page that
 * arrives full of panels nobody asked for is a start page full of things to
 * turn off first.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { currentLanguage, t } from '../i18n'
import type { BlockedDay, DownloadItem, Note, Playing, Rates, Todo } from '../../../shared/types'
import { Check, Clock, Cross, Download, Note as NoteIcon, Pause, Play, Plus, Shield, Zap } from './Icons'
import { cx, formatBytes } from './ui'

/* -------------------------------------------------------------- downloads */

/**
 * What landed recently.
 *
 * Five files, newest first, each one a press away from the folder it is in.
 * The downloads page is two clicks away and this is nought, which for the
 * thing you downloaded ninety seconds ago is the whole difference.
 */
export function DownloadsWidget() {
  const [items, setItems] = useState<DownloadItem[]>([])

  useEffect(() => {
    void window.browser.downloads().then(setItems)
    return window.browser.onDownloads(setItems)
  }, [])

  const recent = items.slice(0, 5)
  if (recent.length === 0) {
    return <p className="text-sm opacity-55">{t('Пока ничего не скачано')}</p>
  }

  return (
    <div className="flex flex-col">
      {recent.map((item) => (
        <button
          key={item.id}
          onClick={() => void window.browser.revealDownload(item.id)}
          className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
          style={{ transition: 'background var(--t-fast) linear' }}
          title={item.path || item.name}
        >
          <Download width={12} height={12} className="shrink-0 opacity-45" />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <span className="shrink-0 text-2xs tabular-nums opacity-55">
            {item.state === 'completed' ? formatBytes(item.received) : `${item.total > 0 ? Math.round((item.received / item.total) * 100) : 0}%`}
          </span>
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- calendar */

/**
 * This month, with today marked.
 *
 * Nothing is connected to it and nothing ever will be: a browser that read
 * somebody's calendar would have to be given their calendar. It answers the
 * one question a person actually asks a wall calendar — what date is the
 * Thursday of next week — and answers it without a network.
 */
export function CalendarWidget({ now }: { now: Date }) {
  const locale = currentLanguage() || undefined
  const { weeks, names, title } = useMemo(() => {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    // Monday-first, which is what most of the world uses; Sunday-first locales
    // still read it correctly because the names are drawn from the locale.
    const lead = (first.getDay() + 6) % 7
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const cells: Array<number | null> = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_one, at) => at + 1)
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    const rows: Array<Array<number | null>> = []
    for (let at = 0; at < cells.length; at += 7) rows.push(cells.slice(at, at + 7))

    const week = new Date(2024, 0, 1) // a Monday
    const labels = Array.from({ length: 7 }, (_one, at) => {
      const day = new Date(week)
      day.setDate(week.getDate() + at)
      return day.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2)
    })

    return {
      weeks: rows,
      names: labels,
      title: (() => {
        const written = now.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
        return written.charAt(0).toLocaleUpperCase(locale) + written.slice(1)
      })()
    }
  }, [now.getFullYear(), now.getMonth(), locale])

  const today = now.getDate()

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 text-sm font-medium">{title}</div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-2xs opacity-55">
        {names.map((name, at) => (
          <span key={at}>{name}</span>
        ))}
      </div>
      <div className="mt-0.5 grid flex-1 grid-cols-7 gap-y-0.5 text-center text-sm tabular-nums">
        {weeks.flat().map((day, at) => (
          <span key={at} className="flex items-center justify-center">
            {day === null ? (
              ''
            ) : day === today ? (
              <span
                className="flex h-[22px] w-[22px] items-center justify-center rounded-pill font-semibold"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {day}
              </span>
            ) : (
              <span className="opacity-80">{day}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ notes */

const NOTE_COLOURS: Record<Note['colour'], string> = {
  yellow: '#ffe58a',
  pink: '#ffc2d6',
  blue: '#b9dcff',
  green: '#bdf0c8',
  plain: 'transparent'
}

/**
 * Notes stuck on the page.
 *
 * They are kept in this profile's own folder and go nowhere else. Editing is
 * the note itself rather than a dialog, because a sticky note you have to open
 * a window to write on is not a sticky note.
 */
export function NotesWidget() {
  const [notes, setNotes] = useState<Note[]>([])

  useEffect(() => {
    void window.browser.desk().then((desk) => setNotes(desk.notes))
  }, [])

  const save = (note: Note) => {
    setNotes((list) => {
      const at = list.findIndex((one) => one.id === note.id)
      if (at === -1) return [note, ...list]
      const next = [...list]
      next[at] = note
      return next
    })
    void window.browser.setNote(note)
  }

  const add = () =>
    save({ id: Math.random().toString(36).slice(2, 10), text: '', colour: 'yellow', at: Date.now() })

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto">
      {notes.length === 0 && (
        <p className="text-sm opacity-55">{t('Ничего не записано — нажмите плюс')}</p>
      )}
      {notes.map((note) => (
        <div
          key={note.id}
          className="group relative rounded-[10px] p-2"
          style={{
            background: NOTE_COLOURS[note.colour],
            color: note.colour === 'plain' ? undefined : '#1b1b1f',
            border: note.colour === 'plain' ? '1px solid var(--line)' : 'none'
          }}
        >
          <textarea
            value={note.text}
            placeholder={t('Заметка')}
            onChange={(event) => save({ ...note, text: event.target.value })}
            className="min-h-[46px] w-full resize-none bg-transparent text-sm outline-none placeholder:opacity-50"
            rows={2}
          />
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {(Object.keys(NOTE_COLOURS) as Array<Note['colour']>).map((colour) => (
              <button
                key={colour}
                aria-label={colour}
                onClick={() => save({ ...note, colour })}
                className="h-3 w-3 rounded-pill"
                style={{
                  background: NOTE_COLOURS[colour],
                  outline: note.colour === colour ? '1.5px solid #1b1b1f' : '1px solid rgba(0,0,0,0.25)'
                }}
              />
            ))}
            <button
              aria-label={t('Удалить')}
              onClick={() => {
                setNotes((list) => list.filter((one) => one.id !== note.id))
                void window.browser.removeNote(note.id)
              }}
              className="ml-1"
            >
              <Cross width={11} height={11} />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center justify-center gap-1 rounded-[9px] py-1.5 text-sm opacity-60 hover:bg-[var(--surface-hover)]"
      >
        <Plus width={13} height={13} />
        {t('Стикер')}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------- todo */

/**
 * A list of things to do.
 *
 * Ticked items stay where they are rather than sinking to the bottom: a list
 * that rearranges itself under the hand ticking it off is a list that gets the
 * wrong thing ticked.
 */
export function TodoWidget() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [typed, setTyped] = useState('')

  useEffect(() => {
    void window.browser.desk().then((desk) => setTodos(desk.todos))
  }, [])

  const add = () => {
    const text = typed.trim()
    if (!text) return
    const todo: Todo = {
      id: Math.random().toString(36).slice(2, 10),
      text,
      done: false,
      at: Date.now()
    }
    setTodos((list) => [...list, todo])
    setTyped('')
    void window.browser.setTodo(todo)
  }

  const toggle = (todo: Todo) => {
    const next = { ...todo, done: !todo.done }
    setTodos((list) => list.map((one) => (one.id === todo.id ? next : one)))
    void window.browser.setTodo(next)
  }

  const left = todos.filter((one) => !one.done).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {todos.length === 0 && <p className="text-sm opacity-55">{t('Список пуст')}</p>}
        {todos.map((todo) => (
          <div key={todo.id} className="group flex items-center gap-2 rounded-[9px] px-1 py-1">
            <button
              onClick={() => toggle(todo)}
              aria-label={todo.text}
              className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px]"
              style={{
                background: todo.done ? 'var(--accent)' : 'transparent',
                border: todo.done ? 'none' : '1.5px solid var(--line-strong)',
                color: '#fff'
              }}
            >
              {todo.done && <Check width={10} height={10} />}
            </button>
            <span className={cx('min-w-0 flex-1 truncate text-sm', todo.done && 'line-through opacity-50')}>
              {todo.text}
            </span>
            <button
              aria-label={t('Удалить')}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
              onClick={() => {
                setTodos((list) => list.filter((one) => one.id !== todo.id))
                void window.browser.removeTodo(todo.id)
              }}
            >
              <Cross width={11} height={11} />
            </button>
          </div>
        ))}
      </div>

      {todos.some((one) => one.done) && (
        <button
          className="mt-1 self-start text-2xs opacity-55 hover:opacity-100"
          onClick={() => {
            setTodos((list) => list.filter((one) => !one.done))
            void window.browser.clearDoneTodos()
          }}
        >
          {t('Убрать сделанное')}
        </button>
      )}

      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
          placeholder={t('Что сделать')}
          className="min-w-0 flex-1 rounded-[9px] px-2 py-1.5 text-sm outline-none"
          style={{ background: 'var(--field-idle)' }}
        />
        {todos.length > 0 && (
          <span className="shrink-0 text-2xs tabular-nums opacity-45">{left}</span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ chart */

/**
 * How much was blocked, day by day.
 *
 * One number is a boast; a fortnight is information. The bars are drawn
 * against the biggest day rather than a fixed scale, because what matters is
 * the shape — whether it is getting better — not the absolute height.
 */
export function ChartWidget() {
  const [days, setDays] = useState<BlockedDay[]>([])

  useEffect(() => {
    void window.browser.blockedDays().then(setDays)
  }, [])

  const highest = Math.max(1, ...days.map((one) => one.count))
  const total = days.reduce((sum, one) => sum + one.count, 0)
  const locale = currentLanguage() || undefined

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 text-sm opacity-65">
        {t('За две недели: {n}', { n: total.toLocaleString(locale) })}
      </div>
      <div className="flex min-h-[40px] flex-1 items-end gap-[3px]">
        {days.map((one) => {
          const share = one.count / highest
          return (
            <div
              key={one.day}
              className="flex h-full flex-1 items-end rounded-t-[3px]"
              style={{ background: 'color-mix(in srgb, currentColor 8%, transparent)' }}
            >
            <div
              className="w-full rounded-t-[3px]"
              title={`${new Date(one.day).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} — ${one.count}`}
              style={{
                // A day with nothing on it still gets a sliver, so the chart
                // reads as fourteen days rather than as nine.
                height: `${Math.max(3, Math.round(share * 100))}%`,
                background: share > 0.66 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, transparent)',
                transition: 'height var(--t-slow) var(--ease-out)'
              }}
            />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- habits */

/** What this profile usually opens around this hour. */
export function HabitsWidget({ onOpen }: { onOpen: (url: string) => void }) {
  const [rows, setRows] = useState<Array<{ host: string; count: number }>>([])

  useEffect(() => {
    void window.browser.habitsNow().then(setRows)
  }, [])

  if (rows.length === 0) {
    return <p className="text-sm opacity-55">{t('Пока не за что зацепиться — походите по сайтам')}</p>
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <button
          key={row.host}
          onClick={() => onOpen(`https://${row.host}`)}
          onMouseEnter={() => void window.browser.preconnect(`https://${row.host}`)}
          className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
          style={{ transition: 'background var(--t-fast) linear' }}
        >
          <Zap width={12} height={12} className="shrink-0 opacity-45" />
          <span className="min-w-0 flex-1 truncate">{row.host}</span>
          <span className="shrink-0 text-2xs tabular-nums opacity-45">{row.count}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- playing */

/** Whatever is playing, wherever it is playing, with one button to stop it. */
export function PlayingWidget({ onOpen }: { onOpen: (tabId: number) => void }) {
  const [list, setList] = useState<Playing[]>([])

  useEffect(() => {
    void window.browser.playing().then(setList)
    return window.browser.onMedia(setList)
  }, [])

  if (list.length === 0) {
    return <p className="text-sm opacity-55">{t('Сейчас ничего не играет')}</p>
  }

  return (
    <div className="flex flex-col gap-1">
      {list.slice(0, 3).map((one) => (
        <div key={one.tabId} className="flex items-center gap-2">
          <button
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-pill"
            style={{ background: 'var(--accent)', color: '#fff' }}
            aria-label={!one.playing ? t('Воспроизвести') : t('Пауза')}
            onClick={() => void window.browser.mediaCommand(one.tabId, !one.playing ? 'play' : 'pause')}
          >
            {!one.playing ? <Play width={12} height={12} /> : <Pause width={12} height={12} />}
          </button>
          <button
            className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
            onClick={() => onOpen(one.tabId)}
            title={one.title}
          >
            {one.title}
          </button>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ rates */

/**
 * What a currency is worth today.
 *
 * The European Central Bank's own daily reference rates, which is why there is
 * no key and no account. Nothing goes out until this widget is switched on.
 */
export function RatesWidget() {
  const [value, setValue] = useState<Rates | null>(null)
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    void window.browser.rates().then((answer) => {
      setValue(answer)
      setAsked(true)
    })
  }, [])

  if (!asked) return <p className="text-sm opacity-55">{t('Спрашиваем…')}</p>
  if (!value) return <p className="text-sm opacity-55">{t('Курс сейчас не получить')}</p>

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
        {Object.entries(value.rates).map(([code, rate]) => (
          <div key={code} className="flex items-baseline gap-2">
            <span className="text-sm opacity-65">
              1 {value.base} =
            </span>
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
              {rate.toLocaleString(currentLanguage() || undefined, { maximumFractionDigits: 4 })}
            </span>
            <span className="text-sm opacity-65">{code}</span>
          </div>
        ))}
      </div>
      {value.date && <div className="mt-1 text-2xs opacity-45">{value.date}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ icons */

/** The icon each of the later widgets wears in its card's header. */
export const WIDGET_ICONS: Record<string, ReactNode> = {
  downloads: <Download width={13} height={13} />,
  calendar: <Clock width={13} height={13} />,
  notes: <NoteIcon width={13} height={13} />,
  chart: <Shield width={13} height={13} />,
  habits: <Zap width={13} height={13} />,
  todo: <Check width={13} height={13} />,
  playing: <Play width={13} height={13} />,
  rates: <Zap width={13} height={13} />
}
