import { useEffect, useMemo, useRef, useState } from 'react'
import type { Favorite, SearchEngine, SecurityStats, Settings, Suggestion } from '../../../shared/types'
import type { ClosedTab } from '../../../preload/index'
import { Clock, Cross, Pencil, Plus, Search, Shield, Star, Zap } from '../components/Icons'
import { Modal, TextField, cx } from '../components/ui'

interface Props {
  settings: Settings
  engine: SearchEngine
  stats: SecurityStats
  closed: ClosedTab[]
  profileName: string
  /** a private window greets differently: it has nothing to remember */
  incognito: boolean
  onOpenAddress: () => void
  onPatch: (patch: Partial<Settings>) => void
}

const hueFor = (url: string) => {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) % 360
  return hash
}

const greeting = () => {
  const hour = new Date().getHours()
  if (hour < 5) return 'Доброй ночи'
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

const newId = () => Math.random().toString(36).slice(2, 10)

const normalizeUrl = (raw: string) => {
  const value = raw.trim()
  if (!value) return ''
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

/** Tiles are keyed by host, the way the icon cache is. */
function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export default function StartPage({
  settings,
  engine,
  stats,
  closed,
  profileName,
  incognito,
  onOpenAddress,
  onPatch
}: Props) {
  const [recent, setRecent] = useState<Suggestion[]>([])
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; item: Favorite } | null>(null)
  const [now, setNow] = useState(() => new Date())
  // Icons of sites that have been visited, kept by the main process; tiles for
  // anything else fall back to the letter.
  const [icons, setIcons] = useState<Record<string, string>>({})
  const dragId = useRef<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const page = settings.startPage
  const blockedTotal = stats.ads + stats.trackers + stats.crypto

  useEffect(() => {
    void window.browser.favicons().then(setIcons)
  }, [settings.favorites])

  useEffect(() => {
    void window.browser.recentHistory(12).then(setRecent)
  }, [])

  useEffect(() => {
    if (!page.clock) return
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [page.clock])

  const hello = useMemo(greeting, [])

  const save = (item: Favorite, mode: 'add' | 'edit') => {
    const url = normalizeUrl(item.url)
    if (!url) return
    const next: Favorite = { ...item, url, title: item.title.trim() || url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0] }
    onPatch({
      favorites:
        mode === 'add'
          ? [...settings.favorites, next]
          : settings.favorites.map((fav) => (fav.id === next.id ? next : fav))
    })
    setDialog(null)
  }

  const remove = (id: string) =>
    onPatch({ favorites: settings.favorites.filter((fav) => fav.id !== id) })

  const reorder = (toIndex: number) => {
    const id = dragId.current
    dragId.current = null
    setDropIndex(null)
    if (!id) return
    const list = [...settings.favorites]
    const from = list.findIndex((fav) => fav.id === id)
    if (from === -1) return
    const [item] = list.splice(from, 1)
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, item)
    onPatch({ favorites: list })
  }

  const open = (url: string) => void window.browser.navigate(url)

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[940px] flex-col px-6 py-10">
        {/* ---------------------------------------------------------- hero */}
        {(page.greeting || page.clock) && (
          <div className="animate-fade-up mb-8 text-center">
            {page.clock && (
              <div className="mb-1 text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {page.greeting && (
              <>
                <h1 className={cx('tracking-[-0.03em]', page.clock ? 'text-[19px] font-medium' : 'text-[34px] font-semibold')}>
                  {incognito ? 'Приватное окно' : `${hello}${profileName ? `, ${profileName}` : ''}`}
                </h1>
                <p className="mt-1 text-base text-dim">
                  {incognito
                    ? 'История, кэш и cookie этого окна исчезнут, когда вы его закроете'
                    : blockedTotal > 0
                      ? `Заблокировано ${blockedTotal} трекеров и рекламных запросов`
                      : 'Быстрый и приватный старт'}
                </p>
              </>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- search */}
        <button
          onClick={onOpenAddress}
          className="animate-fade-up lift group mx-auto mb-10 flex h-[56px] w-full max-w-[640px] items-center gap-3 rounded-[18px] border px-5 text-left"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--line)',
            backdropFilter: 'blur(22px) saturate(180%)',
            boxShadow: 'var(--shadow-md)',
            transition: 'transform var(--t-base) var(--ease-out), box-shadow var(--t-base) var(--ease-out), border-color var(--t-base) linear'
          }}
        >
          <Search width={19} height={19} className="text-faint" />
          <span className="flex-1 text-[15px] text-faint">Поиск или адрес сайта</span>
          <span
            className="rounded-pill px-2.5 py-1 text-2xs font-medium text-dim"
            style={{ background: 'var(--field-idle)' }}
          >
            {engine.name}
          </span>
        </button>

        {/* ----------------------------------------------------- favorites */}
        {page.favorites && (
          <section className="animate-fade-up mb-10">
            <header className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-faint">Избранное</h2>
              <div className="flex items-center gap-1">
                <button
                  className="rounded-pill px-2.5 py-1 text-2xs font-medium text-dim hover:bg-[var(--surface-hover)]"
                  style={{ transition: 'background var(--t-fast) linear, color var(--t-fast) linear' }}
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? 'Готово' : 'Изменить'}
                </button>
              </div>
            </header>

            <div
              className="stagger grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))` }}
            >
              {settings.favorites.map((fav, index) => {
                const hue = hueFor(fav.url)
                return (
                  <div
                    key={fav.id}
                    className="group relative"
                    draggable={editing}
                    onDragStart={() => (dragId.current = fav.id)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDropIndex(index)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      reorder(index)
                    }}
                    onDragEnd={() => {
                      dragId.current = null
                      setDropIndex(null)
                    }}
                    style={{
                      outline: dropIndex === index && editing ? '2px dashed var(--accent)' : 'none',
                      outlineOffset: 2,
                      borderRadius: 'calc(var(--radius) + 4px)'
                    }}
                  >
                    <button
                      onClick={() => (editing ? setDialog({ mode: 'edit', item: fav }) : open(fav.url))}
                      onMouseEnter={() => void window.browser.preconnect(fav.url)}
                      onAuxClick={(event) => event.button === 1 && void window.browser.newTab(fav.url, true)}
                      className="flex w-full flex-col items-center gap-2 rounded-card p-2"
                      style={{ transition: 'background var(--t-base) var(--ease-out)' }}
                      onMouseOver={(event) => (event.currentTarget.style.background = 'var(--surface)')}
                      onMouseOut={(event) => (event.currentTarget.style.background = 'transparent')}
                    >
                      <span
                        className="flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-[17px] text-[20px] font-semibold text-white"
                        style={{
                          background: icons[hostOf(fav.url)]
                            ? 'var(--surface-solid)'
                            : `linear-gradient(140deg, hsl(${hue} 72% 58%), hsl(${(hue + 42) % 360} 70% 46%))`,
                          boxShadow: 'var(--shadow-sm)',
                          transition: 'transform var(--t-base) var(--ease-spring), box-shadow var(--t-base) var(--ease-out)'
                        }}
                        onMouseOver={(event) => {
                          event.currentTarget.style.transform = 'scale(1.07)'
                          event.currentTarget.style.boxShadow = 'var(--shadow-md)'
                        }}
                        onMouseOut={(event) => {
                          event.currentTarget.style.transform = ''
                          event.currentTarget.style.boxShadow = 'var(--shadow-sm)'
                        }}
                      >
                        {icons[hostOf(fav.url)] ? (
                          <img src={icons[hostOf(fav.url)]} alt="" className="h-8 w-8 object-contain" />
                        ) : (
                          fav.title.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="w-full truncate text-center text-sm text-dim">{fav.title}</span>
                    </button>

                    {editing && (
                      <div className="animate-pop absolute right-0.5 top-0.5 flex gap-1">
                        <button
                          className="flex h-5 w-5 items-center justify-center rounded-pill text-white"
                          style={{ background: 'var(--accent)' }}
                          onClick={() => setDialog({ mode: 'edit', item: fav })}
                          title="Изменить"
                        >
                          <Pencil width={10} height={10} />
                        </button>
                        <button
                          className="flex h-5 w-5 items-center justify-center rounded-pill text-white"
                          style={{ background: 'var(--bad)' }}
                          onClick={() => remove(fav.id)}
                          title="Удалить"
                        >
                          <Cross width={10} height={10} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}

              <button
                onClick={() => setDialog({ mode: 'add', item: { id: newId(), title: '', url: '' } })}
                className="flex flex-col items-center gap-2 rounded-card p-2 text-faint hover:text-ink"
                style={{ transition: 'color var(--t-fast) linear, background var(--t-base) var(--ease-out)' }}
                onMouseOver={(event) => (event.currentTarget.style.background = 'var(--surface)')}
                onMouseOut={(event) => (event.currentTarget.style.background = 'transparent')}
              >
                <span
                  className="flex h-[54px] w-[54px] items-center justify-center rounded-[17px] border border-dashed"
                  style={{ borderColor: 'var(--line-strong)' }}
                >
                  <Plus width={19} height={19} />
                </span>
                <span className="text-sm">Добавить</span>
              </button>
            </div>
          </section>
        )}

        {/* --------------------------------------------------------- widgets */}
        <div className="animate-fade-up grid gap-3 md:grid-cols-2">
          {page.stats && (
            <div className="card p-4">
              <div className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-faint">
                <Shield width={13} height={13} /> Защита
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Реклама', value: stats.ads },
                  { label: 'Трекеры', value: stats.trackers },
                  { label: 'HTTPS', value: stats.upgrades },
                  { label: 'Метки', value: stats.params }
                ].map((item) => (
                  <div key={item.label}>
                    <div className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{item.value}</div>
                    <div className="text-sm text-dim">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page.closed && !incognito && closed.length > 0 && (
            <div className="card p-4">
              <div className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-faint">
                <Star width={13} height={13} /> Недавно закрытые
              </div>
              <div className="flex flex-col">
                {closed.slice(0, 5).map((tab) => (
                  <button
                    key={tab.url}
                    onClick={() => open(tab.url)}
                    className="flex items-center gap-2 truncate rounded-[9px] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
                    style={{ transition: 'background var(--t-fast) linear' }}
                  >
                    <Cross width={12} height={12} className="shrink-0 text-faint" />
                    <span className="truncate text-ink">{tab.title || tab.url}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {page.recent && !incognito && (
            <div className="card p-4">
              <div className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-faint">
                <Clock width={13} height={13} /> Недавнее
              </div>
              {recent.length === 0 ? (
                <p className="text-sm text-faint">История пуста</p>
              ) : (
                <div className="flex flex-col">
                  {recent.slice(0, 6).map((item) => (
                    <button
                      key={item.url}
                      onClick={() => open(item.url)}
                      onMouseEnter={() => void window.browser.preconnect(item.url)}
                      className="flex items-center gap-2 truncate rounded-[9px] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
                      style={{ transition: 'background var(--t-fast) linear' }}
                    >
                      <Zap width={12} height={12} className="shrink-0 text-faint" />
                      <span className="truncate text-ink">{item.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {dialog && (
        <FavoriteDialog
          mode={dialog.mode}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSave={(item) => save(item, dialog.mode)}
          onDelete={dialog.mode === 'edit' ? () => { remove(dialog.item.id); setDialog(null) } : undefined}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------ add / edit */

function FavoriteDialog({
  mode,
  item,
  onClose,
  onSave,
  onDelete
}: {
  mode: 'add' | 'edit'
  item: Favorite
  onClose: () => void
  onSave: (item: Favorite) => void
  onDelete?: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [url, setUrl] = useState(item.url)

  return (
    <Modal
      title={mode === 'add' ? 'Новая плитка' : 'Изменить плитку'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger mr-auto" onClick={onDelete}>
              Удалить
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => onSave({ ...item, title, url })}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">Адрес</span>
          <TextField value={url} onChange={setUrl} placeholder="example.com" width="100%" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">Название</span>
          <TextField value={title} onChange={setTitle} placeholder="Как подписать плитку" width="100%" />
        </label>
      </div>
    </Modal>
  )
}
