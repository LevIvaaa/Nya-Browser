import { currentLanguage, t } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '../../../shared/types'
import { Clock, Cross, Search, Trash } from '../components/Icons'
import { EmptyState, TextField, formatDate } from '../components/ui'

/** Midnight at the start of the day `days` ago. */
function startOfDay(days = 0): number {
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - days)
  return day.getTime()
}

type Span = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'

/** The spans people actually ask for, and what each one means in time. */
const SPANS: { id: Exclude<Span, 'custom'>; label: string; from: () => number; to: () => number }[] = [
  { id: 'all', label: 'Всё время', from: () => 0, to: () => Infinity },
  { id: 'today', label: 'Сегодня', from: () => startOfDay(), to: () => Infinity },
  { id: 'yesterday', label: 'Вчера', from: () => startOfDay(1), to: () => startOfDay() },
  { id: 'week', label: 'Неделя', from: () => startOfDay(7), to: () => Infinity },
  { id: 'month', label: 'Месяц', from: () => startOfDay(30), to: () => Infinity }
]

/** A date field's value for a moment in time, in the browser's own zone. */
function isoDay(ms: number): string {
  const day = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [span, setSpan] = useState<Span>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = () => void window.browser.history().then(setEntries)
  useEffect(load, [])

  const window_ = useMemo(() => {
    if (span === 'custom') {
      // An open end is an open end: a range with only a start still works.
      const start = from ? new Date(`${from}T00:00:00`).getTime() : 0
      const end = to ? new Date(`${to}T00:00:00`).getTime() + 86_400_000 : Infinity
      return { start, end }
    }
    const found = SPANS.find((item) => item.id === span) ?? SPANS[0]
    return { start: found.from(), end: found.to() }
  }, [span, from, to])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (entry.last < window_.start || entry.last >= window_.end) return false
      if (!q) return true
      return entry.title.toLowerCase().includes(q) || entry.url.toLowerCase().includes(q)
    })
  }, [entries, query, window_])

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const entry of filtered) {
      const key = new Date(entry.last).toLocaleDateString(currentLanguage() || undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      })
      const list = map.get(key) ?? []
      list.push(entry)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [filtered])

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 py-8">
        <header className="animate-fade-up mb-5 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('История')}</h1>
            <p className="text-sm text-dim">
              {filtered.length === entries.length
                ? t('{n} записей в этом профиле', { n: entries.length })
                : t('Показано {n} из {total}', { n: filtered.length, total: entries.length })}
            </p>
          </div>
          <div className="relative">
            <Search width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Поиск по истории')}
              className="field focus-ring pl-8"
              style={{ width: 260 }}
            />
          </div>
          <button
            className="btn btn-danger"
            onClick={async () => {
              await window.browser.clearHistory()
              load()
            }}
          >
            <Trash width={15} height={15} />
            {t('Очистить')}
          </button>
        </header>

        {/* When: the spans people ask for as one click, and a pair of dates
            for the times they ask for something else. */}
        <div className="animate-fade-up mb-5 flex flex-wrap items-center gap-2">
          {SPANS.map((item) => (
            <button
              key={item.id}
              className="rounded-pill px-3 py-1.5 text-sm"
              onClick={() => setSpan(item.id)}
              style={{
                background:
                  span === item.id
                    ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                    : 'var(--surface)',
                color: span === item.id ? 'var(--accent)' : 'var(--dim)',
                border: `1px solid ${
                  span === item.id ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'transparent'
                }`,
                transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
              }}
            >
              {t(item.label)}
            </button>
          ))}

          <span className="mx-1 h-5 w-px" style={{ background: 'var(--line)' }} />

          <label className="flex items-center gap-2 text-sm text-faint">
            {t('с')}
            <input
              type="date"
              value={from}
              max={to || isoDay(Date.now())}
              onChange={(event) => {
                setFrom(event.target.value)
                setSpan('custom')
              }}
              className="field focus-ring"
              style={{ width: 148, padding: '4px 10px' }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-faint">
            {t('по')}
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={isoDay(Date.now())}
              onChange={(event) => {
                setTo(event.target.value)
                setSpan('custom')
              }}
              className="field focus-ring"
              style={{ width: 148, padding: '4px 10px' }}
            />
          </label>

          {span === 'custom' && (from || to) && (
            <button
              className="btn"
              onClick={() => {
                setFrom('')
                setTo('')
                setSpan('all')
              }}
            >
              <Cross width={13} height={13} />
              {t('Сбросить')}
            </button>
          )}
        </div>

        {groups.length === 0 ? (
          <EmptyState icon={<Clock width={26} height={26} />} title={t('Пока ничего нет')} hint={t('Посещённые страницы появятся здесь.')} />
        ) : (
          groups.map(([day, list]) => (
            <section key={day} className="animate-fade-up mb-6">
              <h2 className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-faint">{day}</h2>
              <div className="card overflow-hidden">
                {list.map((entry) => (
                  <div
                    key={entry.url}
                    className="group flex items-center gap-3 px-3 py-2"
                    style={{ borderTop: '1px solid var(--line)', transition: 'background var(--t-fast) linear' }}
                    onMouseOver={(event) => (event.currentTarget.style.background = 'var(--surface-hover)')}
                    onMouseOut={(event) => (event.currentTarget.style.background = 'transparent')}
                  >
                    <span className="w-12 shrink-0 text-2xs tabular-nums text-faint">{formatDate(entry.last)}</span>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => window.browser.navigate(entry.url)}
                      onMouseEnter={() => void window.browser.preconnect(entry.url)}
                    >
                      <span className="block truncate text-base">{entry.title}</span>
                      <span className="block truncate text-sm text-faint">{entry.url}</span>
                    </button>
                    {entry.visits > 1 && <span className="shrink-0 text-2xs text-faint">{entry.visits}×</span>}
                    <button
                      className="icon-btn h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                      title={t('Удалить запись')}
                      onClick={async () => {
                        await window.browser.removeHistory(entry.url)
                        load()
                      }}
                    >
                      <Cross width={13} height={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
