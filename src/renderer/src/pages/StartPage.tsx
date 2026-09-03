import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Favorite,
  SearchEngine,
  SecurityStats,
  Settings,
  StartPageFont,
  StartPageSettings,
  Suggestion,
  TileShape,
  WidgetBox,
  WidgetId
} from '../../../shared/types'
import { DEFAULT_LAYOUT, GRID_COLUMNS, GRID_GAP, GRID_ROW } from '../../../shared/startPage'
import type { ClosedTab } from '../../../preload/index'
import {
  Check,
  Clock,
  Cross,
  Grip,
  Minus,
  Pencil,
  Plus,
  Search,
  Shield,
  Star,
  Zap
} from '../components/Icons'
import { Modal, TextField, cx } from '../components/ui'
import WeatherWidget from '../components/Weather'

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

/* --------------------------------------------------------------- canvas */

const COLUMNS = GRID_COLUMNS
const ROW = GRID_ROW
const GAP = GRID_GAP

const TITLES: Record<WidgetId, string> = {
  clock: 'Часы',
  greeting: 'Приветствие',
  search: 'Поиск',
  favorites: 'Избранное',
  stats: 'Защита',
  recent: 'Недавнее',
  closed: 'Недавно закрытые',
  weather: 'Погода'
}

/** Which settings toggle decides whether a widget is on the page at all. */
const SWITCH: Record<WidgetId, keyof StartPageSettings> = {
  clock: 'clock',
  greeting: 'greeting',
  search: 'favorites', // the search field is always welcome; see visible()
  favorites: 'favorites',
  stats: 'stats',
  recent: 'recent',
  closed: 'closed',
  weather: 'weather'
}

const FONTS: Record<StartPageFont, string> = {
  system: 'var(--font)',
  rounded: '"Segoe UI Variable Display", Nunito, ui-rounded, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'ui-monospace, "Cascadia Code", Consolas, monospace'
}

const ORDER: WidgetId[] = [
  'clock',
  'greeting',
  'search',
  'favorites',
  'stats',
  'recent',
  'closed',
  'weather'
]

const SHAPES: { value: TileShape; label: string }[] = [
  { value: 'rounded', label: 'Скруглённые' },
  { value: 'soft', label: 'Мягкие' },
  { value: 'circle', label: 'Круглые' },
  { value: 'square', label: 'Прямые' }
]

/**
 * The corner radius for a box of a given size. Circles are half the size
 * rather than a fixed number so an icon and the card around it stay the same
 * shape at different scales.
 */
function radiusFor(shape: TileShape, size: number): number {
  if (shape === 'square') return 0
  if (shape === 'circle') return size / 2
  if (shape === 'soft') return Math.round(size * 0.16)
  return Math.round(size * 0.27)
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

/* --------------------------------------------------------------- helpers */

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
  const canvas = useRef<HTMLDivElement>(null)

  const page = settings.startPage
  const layout = page.layout
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

  const patchPage = (patch: Partial<StartPageSettings>) =>
    onPatch({ startPage: { ...page, ...patch } })

  const moveWidget = (id: WidgetId, box: WidgetBox) =>
    patchPage({ layout: { ...layout, [id]: box } })

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

  /** A widget is on the page when its own switch is on — and, for the two
   *  history-fed ones, when this window is allowed to look at history. */
  const visible = (id: WidgetId): boolean => {
    if (id === 'search') return true
    if ((id === 'recent' || id === 'closed') && incognito) return false
    if (id === 'closed' && closed.length === 0) return false
    return page[SWITCH[id]] === true
  }

  const content = (id: WidgetId): ReactNode => {
    switch (id) {
      case 'clock':
        return (
          <div className="flex h-full items-center justify-center text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )

      case 'greeting':
        return (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <h1 className="text-[19px] font-medium tracking-[-0.03em]">
              {incognito ? 'Приватное окно' : `${hello}${profileName ? `, ${profileName}` : ''}`}
            </h1>
            <p className="mt-1 text-base opacity-70">
              {incognito
                ? 'История, кэш и cookie этого окна исчезнут, когда вы его закроете'
                : blockedTotal > 0
                  ? `Заблокировано ${blockedTotal} трекеров и рекламных запросов`
                  : 'Быстрый и приватный старт'}
            </p>
          </div>
        )

      case 'search':
        return (
          <button
            onClick={onOpenAddress}
            className="lift group flex h-full w-full items-center gap-3 rounded-[18px] border px-5 text-left"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--line)',
              backdropFilter: 'blur(22px) saturate(180%)',
              boxShadow: 'var(--shadow-md)',
              transition: 'transform var(--t-base) var(--ease-out), box-shadow var(--t-base) var(--ease-out), border-color var(--t-base) linear'
            }}
          >
            <Search width={19} height={19} className="opacity-45" />
            <span className="flex-1 text-[15px] opacity-45">Поиск или адрес сайта</span>
            <span
              className="rounded-pill px-2.5 py-1 text-2xs font-medium opacity-70"
              style={{ background: 'var(--field-idle)' }}
            >
              {engine.name}
            </span>
          </button>
        )

      case 'favorites':
        return (
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))` }}
          >
            {settings.favorites.map((fav, index) => (
              <Tile
                key={fav.id}
                fav={fav}
                icon={icons[hostOf(fav.url)]}
                style={page.tiles}
                shape={page.shape}
                labels={page.tileLabels}
                editing={editing}
                dropping={dropIndex === index && editing}
                onOpen={() => open(fav.url)}
                onEdit={() => setDialog({ mode: 'edit', item: fav })}
                onRemove={() => remove(fav.id)}
                onDragStart={() => (dragId.current = fav.id)}
                onDragOver={() => setDropIndex(index)}
                onDrop={() => reorder(index)}
                onDragEnd={() => {
                  dragId.current = null
                  setDropIndex(null)
                }}
              />
            ))}
            <AddTile
              style={page.tiles}
              shape={page.shape}
              labels={page.tileLabels}
              onClick={() => setDialog({ mode: 'add', item: { id: newId(), title: '', url: '' } })}
            />
          </div>
        )

      case 'stats':
        return (
          <Card icon={<Shield width={13} height={13} />} title="Защита" shape={page.shape}>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Реклама', value: stats.ads },
                { label: 'Трекеры', value: stats.trackers },
                { label: 'HTTPS', value: stats.upgrades },
                { label: 'Метки', value: stats.params }
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{item.value}</div>
                  <div className="text-sm opacity-65">{item.label}</div>
                </div>
              ))}
            </div>
          </Card>
        )

      case 'closed':
        return (
          <Card icon={<Star width={13} height={13} />} title="Недавно закрытые" shape={page.shape}>
            <div className="flex flex-col">
              {closed.slice(0, 5).map((tab) => (
                <button
                  key={tab.url}
                  onClick={() => open(tab.url)}
                  className="flex items-center gap-2 truncate rounded-[9px] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
                  style={{ transition: 'background var(--t-fast) linear' }}
                >
                  <Cross width={12} height={12} className="shrink-0 opacity-45" />
                  <span className="truncate">{tab.title || tab.url}</span>
                </button>
              ))}
            </div>
          </Card>
        )

      case 'recent':
        return (
          <Card icon={<Clock width={13} height={13} />} title="Недавнее" shape={page.shape}>
            {recent.length === 0 ? (
              <p className="text-sm opacity-55">История пуста</p>
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
                    <Zap width={12} height={12} className="shrink-0 opacity-45" />
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        )

      case 'weather':
        return (
          <WeatherWidget
            place={page.place}
            shape={page.shape}
            onPick={(place) => patchPage({ place })}
          />
        )
    }
  }

  return (
    <div
      className="relative z-10 h-full overflow-y-auto"
      style={{
        fontFamily: FONTS[page.font],
        // One colour for the whole page: the widgets inherit it, so a light
        // theme over a dark wallpaper can be made readable in one move.
        ...(page.ink ? { color: page.ink } : null)
      }}
    >
      <div
        ref={canvas}
        // No width cap: the canvas is the window, so a widget can be dragged
        // into any corner of it, not just around the middle column.
        className="grid w-full px-6 py-8"
        style={{
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW}px`,
          gap: GAP,
          // Room to drop a widget below everything without the page jumping.
          paddingBottom: editing ? 220 : 40
        }}
      >
        {ORDER.filter(visible).map((id) => (
          <Widget
            key={id}
            id={id}
            box={layout[id]}
            editing={editing}
            canvas={canvas}
            onChange={(box) => moveWidget(id, box)}
            onHide={() => patchPage({ [SWITCH[id]]: false } as Partial<StartPageSettings>)}
          >
            {content(id)}
          </Widget>
        ))}
      </div>

      <EditBar
        editing={editing}
        page={page}
        onToggle={() => setEditing((value) => !value)}
        onPatch={patchPage}
        onReset={() => patchPage({ layout: { ...DEFAULT_LAYOUT } })}
      />

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

/* --------------------------------------------------------------- widget */

/**
 * One widget on the canvas: a grid item that, while the page is being
 * arranged, can be dragged by its grip and resized from its corner.
 *
 * Moving happens by the grip rather than by the body on purpose — the tiles
 * inside "Избранное" are themselves draggable, and a body that also moved the
 * widget would make reordering them impossible.
 */
function Widget({
  id,
  box,
  editing,
  canvas,
  onChange,
  onHide,
  children
}: {
  id: WidgetId
  box: WidgetBox
  editing: boolean
  canvas: React.RefObject<HTMLDivElement | null>
  onChange: (box: WidgetBox) => void
  onHide: () => void
  children: ReactNode
}) {
  const gesture = useRef<{ id: number; x: number; y: number; from: WidgetBox; cell: number } | null>(null)

  /** Width of one column plus its gap, which is what a step of x costs. */
  const cellWidth = () => {
    const width = canvas.current?.clientWidth ?? 0
    const inner = width - 48 - GAP * (COLUMNS - 1)
    return inner / COLUMNS + GAP
  }

  const begin = (event: React.PointerEvent) => {
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: box, cell: cellWidth() }
    ;(event.target as Element).setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const steps = (event: React.PointerEvent) => {
    const state = gesture.current
    if (!state || state.id !== event.pointerId) return null
    return {
      from: state.from,
      dx: Math.round((event.clientX - state.x) / state.cell),
      dy: Math.round((event.clientY - state.y) / (ROW + GAP))
    }
  }

  const scaleBy = (delta: number) =>
    onChange({ ...box, scale: Math.round(clamp(box.scale + delta, 0.6, 2.2) * 20) / 20 })

  return (
    <div
      className={cx('relative', !editing && 'animate-fade-up')}
      style={{
        gridColumn: `${box.x + 1} / span ${box.w}`,
        gridRow: `${box.y + 1} / span ${box.h}`,
        outline: editing ? '1px dashed var(--line-strong)' : 'none',
        outlineOffset: 4,
        borderRadius: 'var(--radius)'
      }}
    >
      {/* The content keeps the box's size while drawing at the chosen scale.
          At 1x no transform is applied at all: a transformed ancestor becomes
          the containing block for anything fixed inside it. */}
      <div
        className="h-full"
        style={
          box.scale === 1
            ? undefined
            : {
                width: `${100 / box.scale}%`,
                height: `${100 / box.scale}%`,
                transform: `scale(${box.scale})`,
                transformOrigin: 'top left'
              }
        }
      >
        {children}
      </div>

      {editing && (
        <>
          <div className="animate-pop absolute -top-8 left-0 flex items-center gap-0.5 rounded-pill px-1 py-1"
            style={{ background: 'var(--surface-solid)', boxShadow: 'var(--shadow-md)' }}
          >
            <span
              className="flex h-6 cursor-grab items-center gap-1.5 rounded-pill pl-1.5 pr-2 text-2xs font-medium text-dim"
              style={{ touchAction: 'none' }}
              onPointerDown={begin}
              onPointerMove={(event) => {
                const move = steps(event)
                if (!move) return
                onChange({
                  ...move.from,
                  x: clamp(move.from.x + move.dx, 0, COLUMNS - move.from.w),
                  y: Math.max(0, move.from.y + move.dy)
                })
              }}
              onPointerUp={() => (gesture.current = null)}
              title="Перетащить"
            >
              <Grip width={11} height={11} />
              {TITLES[id]}
            </span>
            <button className="icon-btn h-6 w-6" onClick={() => scaleBy(-0.1)} title="Мельче">
              <Minus width={12} height={12} />
            </button>
            <button className="icon-btn h-6 w-6" onClick={() => scaleBy(0.1)} title="Крупнее">
              <Plus width={12} height={12} />
            </button>
            <button className="icon-btn h-6 w-6" onClick={onHide} title="Убрать с главной">
              <Cross width={12} height={12} />
            </button>
          </div>

          <span
            className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize rounded-[5px]"
            style={{ background: 'var(--accent)', touchAction: 'none' }}
            onPointerDown={begin}
            onPointerMove={(event) => {
              const move = steps(event)
              if (!move) return
              onChange({
                ...move.from,
                w: clamp(move.from.w + move.dx, 2, COLUMNS - move.from.x),
                h: Math.max(1, move.from.h + move.dy)
              })
            }}
            onPointerUp={() => (gesture.current = null)}
            title="Размер"
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- edit bar */

function EditBar({
  editing,
  page,
  onToggle,
  onPatch,
  onReset
}: {
  editing: boolean
  page: StartPageSettings
  onToggle: () => void
  onPatch: (patch: Partial<StartPageSettings>) => void
  onReset: () => void
}) {
  const hidden = ORDER.filter((id) => id !== 'search' && page[SWITCH[id]] !== true)

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-20 flex flex-col items-end gap-2">
      {editing && (
        <div
          className="animate-pop pointer-events-auto flex max-w-[520px] flex-wrap items-center justify-end gap-2 rounded-card p-2.5"
          style={{ background: 'var(--surface-solid)', boxShadow: 'var(--shadow-lg)' }}
        >
          {hidden.map((id) => (
            <button
              key={id}
              className="btn h-7 px-2.5 text-2xs"
              onClick={() => onPatch({ [SWITCH[id]]: true } as Partial<StartPageSettings>)}
            >
              <Plus width={11} height={11} /> {TITLES[id]}
            </button>
          ))}
          <select
            className="h-7 rounded-pill px-2 text-2xs"
            style={{ background: 'var(--field-idle)', color: 'var(--ink)', border: 'none' }}
            value={page.font}
            onChange={(event) => onPatch({ font: event.target.value as StartPageFont })}
          >
            <option value="system">Шрифт системы</option>
            <option value="rounded">Округлый</option>
            <option value="serif">С засечками</option>
            <option value="mono">Моноширинный</option>
          </select>
          <select
            className="h-7 rounded-pill px-2 text-2xs"
            style={{ background: 'var(--field-idle)', color: 'var(--ink)', border: 'none' }}
            value={page.tiles}
            onChange={(event) => onPatch({ tiles: event.target.value as StartPageSettings['tiles'] })}
          >
            <option value="card">Плитки карточками</option>
            <option value="icon">Плитки значками</option>
          </select>
          <select
            className="h-7 rounded-pill px-2 text-2xs"
            style={{ background: 'var(--field-idle)', color: 'var(--ink)', border: 'none' }}
            value={page.shape}
            onChange={(event) => onPatch({ shape: event.target.value as TileShape })}
          >
            {SHAPES.map((item) => (
              <option key={item.value} value={item.value}>
                Форма: {item.label.toLowerCase()}
              </option>
            ))}
          </select>
          <button
            className="btn h-7 px-2.5 text-2xs"
            onClick={() => onPatch({ tileLabels: !page.tileLabels })}
          >
            {page.tileLabels ? 'Скрыть подписи' : 'Показать подписи'}
          </button>

          {/* Text colour. Over a wallpaper the theme's ink is often the wrong
              one, and the page has no way to know that — so it is a choice.
              The swatch is the input itself rather than a label wrapping a
              hidden one: a label that big is easy to hit by accident, and
              turning all the text black by accident is not a small mistake. */}
          <span
            className="flex h-7 items-center gap-1.5 rounded-pill pl-1.5 pr-2.5 text-2xs"
            style={{ background: 'var(--field-idle)' }}
          >
            <input
              type="color"
              className="h-[18px] w-[18px] cursor-pointer border-0 bg-transparent p-0"
              value={page.ink || '#ffffff'}
              onChange={(event) => onPatch({ ink: event.target.value })}
              title="Цвет текста главной"
            />
            Цвет текста
          </span>
          <button
            className="btn h-7 px-2.5 text-2xs"
            onClick={() => onPatch({ ink: '' })}
            disabled={!page.ink}
          >
            По теме
          </button>

          <button className="btn h-7 px-2.5 text-2xs" onClick={onReset}>
            Сбросить расположение
          </button>
        </div>
      )}
      {/* Just the pencil. The bar it opens explains itself, and a labelled
          button sat in the corner of every new tab saying what it was. */}
      <button
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-pill"
        onClick={onToggle}
        title={editing ? 'Готово' : 'Настроить главную'}
        aria-label={editing ? 'Готово' : 'Настроить главную'}
        style={{
          background: editing ? 'var(--accent)' : 'var(--surface-solid)',
          color: editing ? '#fff' : 'var(--ink)',
          boxShadow: 'var(--shadow-md)',
          transition: 'background var(--t-base) linear, color var(--t-base) linear'
        }}
      >
        {editing ? <Check width={16} height={16} /> : <Pencil width={15} height={15} />}
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- parts */

function Card({
  icon,
  title,
  shape,
  children
}: {
  icon: ReactNode
  title: string
  shape: TileShape
  children: ReactNode
}) {
  return (
    <div
      className="card h-full overflow-hidden p-4"
      // A circle is the wrong shape for a panel of text, so the widget cards
      // take the roundest of the two soft options instead of a real circle.
      style={{ borderRadius: radiusFor(shape === 'circle' ? 'rounded' : shape, 72) }}
    >
      <div
        className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider opacity-60"
      >
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function Tile({
  fav,
  icon,
  style,
  shape,
  labels,
  editing,
  dropping,
  onOpen,
  onEdit,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  fav: Favorite
  icon: string | undefined
  style: StartPageSettings['tiles']
  shape: TileShape
  labels: boolean
  editing: boolean
  dropping: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const hue = hueFor(fav.url)
  const card = style === 'card'
  const size = card ? 44 : 54

  const glyph = (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        borderRadius: radiusFor(shape, size),
        background: icon
          ? 'var(--surface-solid)'
          : `linear-gradient(140deg, hsl(${hue} 72% 58%), hsl(${(hue + 42) % 360} 70% 46%))`,
        boxShadow: 'var(--shadow-sm)'
      }}
    >
      {icon ? (
        <img src={icon} alt="" className={card ? 'h-7 w-7 object-contain' : 'h-8 w-8 object-contain'} />
      ) : (
        fav.title.charAt(0).toUpperCase()
      )}
    </span>
  )

  return (
    <div
      className="group relative"
      draggable={editing}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      style={{
        outline: dropping ? '2px dashed var(--accent)' : 'none',
        outlineOffset: 2,
        borderRadius: 'calc(var(--radius) + 4px)'
      }}
    >
      <button
        onClick={() => (editing ? onEdit() : onOpen())}
        onMouseEnter={() => void window.browser.preconnect(fav.url)}
        onAuxClick={(event) => event.button === 1 && void window.browser.newTab(fav.url, true)}
        // The Yandex shape: the icon in the middle of the card, the caption
        // centred right under it, both on the same vertical line.
        className={cx(
          'lift flex w-full flex-col items-center justify-center gap-2',
          // Without a caption the card has nothing to be wide for, so it
          // becomes a square and the logo sits dead centre in it.
          card ? (labels ? 'aspect-[1.25] border p-3' : 'aspect-square border p-3') : 'p-2'
        )}
        style={{
          borderRadius: radiusFor(shape, 96),
          ...(card
            ? {
                background: 'var(--surface)',
                borderColor: 'var(--line)',
                backdropFilter: 'blur(18px) saturate(160%)',
                boxShadow: 'var(--shadow-sm)',
                transition: 'transform var(--t-base) var(--ease-out), box-shadow var(--t-base) var(--ease-out)'
              }
            : { transition: 'background var(--t-base) var(--ease-out)' })
        }}
        onMouseOver={(event) => {
          if (!card) event.currentTarget.style.background = 'var(--surface)'
        }}
        onMouseOut={(event) => {
          if (!card) event.currentTarget.style.background = 'transparent'
        }}
      >
        {glyph}
        {labels && (
          <span
            className={cx('w-full truncate text-center text-sm', card ? 'font-medium' : 'opacity-75')}
          >
            {fav.title}
          </span>
        )}
      </button>

      {editing && (
        <div className="animate-pop absolute right-0.5 top-0.5 flex gap-1">
          <button
            className="flex h-5 w-5 items-center justify-center rounded-pill text-white"
            style={{ background: 'var(--accent)' }}
            onClick={onEdit}
            title="Изменить"
          >
            <Pencil width={10} height={10} />
          </button>
          <button
            className="flex h-5 w-5 items-center justify-center rounded-pill text-white"
            style={{ background: 'var(--bad)' }}
            onClick={onRemove}
            title="Удалить"
          >
            <Cross width={10} height={10} />
          </button>
        </div>
      )}
    </div>
  )
}

function AddTile({
  style,
  shape,
  labels,
  onClick
}: {
  style: StartPageSettings['tiles']
  shape: TileShape
  labels: boolean
  onClick: () => void
}) {
  const card = style === 'card'
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex flex-col items-center justify-center gap-2 border border-dashed opacity-55 hover:opacity-100',
        card ? (labels ? 'aspect-[1.25] p-3' : 'aspect-square p-3') : 'p-2'
      )}
      style={{
        borderRadius: radiusFor(shape, 96),
        // currentColor, so the dashed outline follows the page's text colour
        // instead of a token that assumes a light or dark background.
        borderColor: 'currentColor',
        transition: 'opacity var(--t-fast) linear'
      }}
    >
      <Plus width={19} height={19} />
      {labels && <span className="text-sm">Добавить</span>}
    </button>
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
