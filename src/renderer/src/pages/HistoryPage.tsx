import { useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '../../../shared/types'
import { Clock, Cross, Search, Trash } from '../components/Icons'
import { EmptyState, TextField, formatDate } from '../components/ui'

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')

  const load = () => void window.browser.history().then(setEntries)
  useEffect(load, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (entry) => entry.title.toLowerCase().includes(q) || entry.url.toLowerCase().includes(q)
    )
  }, [entries, query])

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const entry of filtered) {
      const key = new Date(entry.last).toLocaleDateString('ru-RU', {
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
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">История</h1>
            <p className="text-sm text-dim">{entries.length} записей в этом профиле</p>
          </div>
          <div className="relative">
            <Search width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по истории"
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
            Очистить
          </button>
        </header>

        {groups.length === 0 ? (
          <EmptyState icon={<Clock width={26} height={26} />} title="Пока ничего нет" hint="Посещённые страницы появятся здесь." />
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
                      title="Удалить запись"
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
