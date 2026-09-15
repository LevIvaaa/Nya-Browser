import { t } from '../i18n'
import { tabHeight } from '../look'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type {
  InternalPage,
  Settings,
  SplitState,
  TabGroup,
  TabSpace,
  TabState
} from '../../../shared/types'
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Cross, Download, Gear, Globe, HalfLeft, HalfRight, Pin, Plus, Sleep, Star, Volume, VolumeOff, Wallet, Zap } from './Icons'
import { cx } from './ui'

/** The same icons these pages carry in the toolbar and in the menu. */
const INTERNAL_ICONS: Record<InternalPage, typeof Gear> = {
  settings: Gear,
  history: Clock,
  downloads: Download,
  bookmarks: Star,
  passwords: Wallet,
  tasks: Zap
}

/**
 * The tab you are looking at is awake by definition — whatever the last state
 * push happened to say while it was waking up. Nothing about the tab in front
 * of you should be dimmed or wear a sleep mark.
 */
const asleep = (tab: TabState) => tab.sleeping && !tab.active

/* ----------------------------------------------------------------- favicon */
function Favicon({ tab, size = 15 }: { tab: TabState; size?: number }) {
  const [failed, setFailed] = useState(false)
  const letter = (tab.origin || tab.title || '?').replace(/^www\./, '').charAt(0).toUpperCase()

  if (tab.loading) {
    return (
      <span
        className="animate-spin-slow shrink-0 rounded-pill"
        style={{
          width: size,
          height: size,
          border: '1.6px solid var(--line-strong)',
          borderTopColor: 'var(--accent)'
        }}
      />
    )
  }

  // One of the browser's own pages: it has no favicon to fetch, and the icon
  // is the same one its button in the toolbar carries.
  if (tab.internal) {
    const Icon = INTERNAL_ICONS[tab.internal]
    return <Icon width={size} height={size} className="shrink-0" style={{ color: 'var(--accent)' }} />
  }

  if (tab.favicon && !failed) {
    return (
      <img
        src={tab.favicon}
        alt=""
        onError={() => setFailed(true)}
        className={cx('shrink-0 rounded-[4px] object-contain', asleep(tab) && 'opacity-45 saturate-0')}
        style={{ width: size, height: size, transition: 'opacity var(--t-base) linear' }}
      />
    )
  }

  if (!tab.hasContent) return <Globe width={size} height={size} className="shrink-0 text-faint" />

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[4px] text-2xs font-bold text-white"
      style={{
        width: size,
        height: size,
        background: 'color-mix(in srgb, var(--accent) 70%, #6b7280)',
        opacity: asleep(tab) ? 0.45 : 1
      }}
    >
      {letter}
    </span>
  )
}

/* ------------------------------------------------------------------- item */
/**
 * Which half of a split a tab is, when two are shown side by side. Both halves
 * are marked in the strip, because «which tab is that other page?» is
 * otherwise a question the window cannot answer.
 */
type Half = 'left' | 'right' | null

interface ItemProps {
  tab: TabState
  /** the half of a side-by-side pair this tab is, if it is in one */
  half?: Half
  /** set when the other half is the tab immediately beside this one */
  joined?: Half | null
  /** gone from the browser, still on screen for a moment */
  leaving?: boolean
  settings: Settings
  vertical: boolean
  index: number
  /** set when this tab is inside a group, with where it sits in the run */
  group?: TabGroup
  first?: boolean
  last?: boolean
  dropIndex: number | null
  /** gathered up with others, waiting for something to be done to all of them */
  picked?: boolean
  onPick: (id: number) => void
  onDragStart: (id: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
}

function TabItem({
  tab,
  half,
  joined,
  leaving,
  settings,
  vertical,
  index,
  group,
  first,
  last,
  dropIndex,
  picked,
  onPick,
  onDragStart,
  onDragOver,
  onDrop
}: ItemProps) {
  const [hover, setHover] = useState(false)
  /** where the pointer is, once it has stayed long enough to mean it */
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null)
  const peekTimer = useRef<number | null>(null)
  const height = tabHeight(settings)
  /**
   * Two tabs shown as one window took the room of two tabs, and the strip has
   * no room to give. So the pair is written the way a sentence is: the half
   * you are in keeps its name, the other one shrinks to its icon — until you
   * point at it, and it tells you what it is.
   */
  const folded = Boolean(joined) && !vertical && !tab.active && !hover
  const audio = tab.audible || tab.muted
  const title = tab.title || tab.origin || t('Новая вкладка')
  const showClose =
    settings.closeButton === 'always' || (settings.closeButton === 'hover' && (hover || tab.active)) ||
    (settings.closeButton === 'active' && tab.active)

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        // Named so another window can recognise it. A drag that ends outside
        // this strip is a tab moving house, and the window it left has to be
        // findable from wherever it lands.
        event.dataTransfer.setData('application/x-nya-tab', String(tab.id))
        void window.browser.windowId().then((id) => {
          try {
            event.dataTransfer.setData('application/x-nya-window', String(id))
          } catch {
            /* the drag has already started; the strip's own reorder still works */
          }
        })
        onDragStart(tab.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver(index)
      }}
      onDrop={(event) => {
        event.preventDefault()
        // A tab from another window: it moves here rather than reordering
        // anything, and the strip's own drop has nothing to do.
        const fromWindow = Number(event.dataTransfer.getData('application/x-nya-window') || '0')
        const carried = Number(event.dataTransfer.getData('application/x-nya-tab') || '0')
        if (fromWindow && carried) {
          void window.browser.windowId().then((here) => {
            if (fromWindow !== here) void window.browser.moveTabHere(fromWindow, carried)
            else onDrop()
          })
          return
        }
        onDrop()
      }}
      onClick={(event) => {
        if (peekTimer.current) window.clearTimeout(peekTimer.current)
        setPeek(null)
        // Ctrl-click gathers tabs instead of going to them, which is what
        // makes "close these four" possible at all.
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          return onPick(tab.id)
        }
        window.browser.switchTab(tab.id)
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && settings.middleClickClose) window.browser.closeTab(tab.id)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.browser.tabMenu(tab.id)
      }}
      onMouseEnter={(event) => {
        setHover(true)
        if (!settings.tabPreview || tab.active) return
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
        if (peekTimer.current) window.clearTimeout(peekTimer.current)
        peekTimer.current = window.setTimeout(
          () => setPeek({ x: box.left + box.width / 2, y: box.bottom }),
          420
        )
      }}
      onMouseLeave={() => {
        setHover(false)
        if (peekTimer.current) window.clearTimeout(peekTimer.current)
        peekTimer.current = null
        setPeek(null)
      }}
      title={vertical ? undefined : `${title}${tab.origin ? ` — ${tab.origin}` : ''}`}
      data-active-tab={tab.active ? '' : undefined}
      data-tab-id={tab.id}
      className={cx(
        leaving ? (vertical ? 'animate-tab-out-tall' : 'animate-tab-out') : 'animate-tab',
        'no-drag group relative flex cursor-default select-none items-center gap-2',
        // A pinned tab in a row is exactly its icon: no name to leave room for,
        // and so no room left over. The width floor the other tabs stand on
        // would otherwise hold it open and put the icon off to one side.
        (tab.pinned || folded) && !vertical ? 'justify-center px-0' : 'px-2.5',
        vertical ? 'w-full' : tab.pinned ? 'flex-none' : 'min-w-[54px] flex-1'
      )}
      style={{
        // Inside a group, the run of tabs sits on the group's colour and is
        // rounded only at its ends, so where the group starts and stops is
        // something you can see rather than something you count.
        ...(group
          ? {
              borderTopLeftRadius: vertical || first ? 11 : 3,
              borderBottomLeftRadius: vertical || first ? 11 : 3,
              borderTopRightRadius: vertical || last ? 11 : 3,
              borderBottomRightRadius: vertical || last ? 11 : 3,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${group.color} 38%, transparent)`
            }
          : { borderRadius: 11 }),
        // Two tabs shown as one window are drawn as one tab: round on the
        // outside, square where they meet, and touching.
        ...(joined === 'left' && !vertical
          ? { borderTopRightRadius: 3, borderBottomRightRadius: 3, marginRight: -4 }
          : {}),
        ...(joined === 'right' && !vertical
          ? { borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }
          : {}),
        ...(joined === 'left' && vertical
          ? { borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginBottom: -4 }
          : {}),
        ...(joined === 'right' && vertical
          ? { borderTopLeftRadius: 3, borderTopRightRadius: 3 }
          : {}),
        height,
        // A pinned tab is its icon and nothing else: it is there to be found
        // in the same place every time, not to be read.
        width: tab.pinned && !vertical ? 38 : undefined,
        minWidth: tab.pinned && !vertical ? 38 : folded ? 34 : undefined,
        maxWidth: tab.pinned && !vertical
          ? 38
          : vertical
            ? undefined
            : folded
              ? 34
              : Boolean(joined)
                ? Math.round(settings.tabMaxWidth * 0.78)
                : settings.tabMaxWidth,
        background: tab.active
          ? 'var(--surface-solid)'
          : hover
            ? 'var(--surface)'
            : group
              ? `color-mix(in srgb, ${group.color} 13%, transparent)`
              : 'transparent',
        boxShadow: tab.active && !group ? 'var(--shadow-sm)' : undefined,
        opacity: asleep(tab) ? 0.62 : 1,
        // A tab that started counting while you were elsewhere says so twice
        // and then stops: a mark that never goes away is a mark nobody reads.
        animation: tab.attention && !tab.active ? 'nya-tab-attention 1.1s ease-in-out 2' : undefined,
        outline: picked
          ? '2px solid var(--accent)'
          : dropIndex === index
            ? '2px solid var(--accent)'
            : 'none',
        outlineOffset: -2,
        transition:
          'background var(--t-base) var(--ease-out), box-shadow var(--t-base) var(--ease-out), opacity var(--t-base) linear, max-width var(--t-slow) var(--ease-out), min-width var(--t-slow) var(--ease-out)'
      }}
    >
      {vertical && tab.active && (
        <span
          className="absolute -left-[7px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-pill"
          style={{ background: 'var(--accent)', transition: 'height var(--t-base) var(--ease-spring)' }}
        />
      )}

      {half && (
        <span
          className="bond pointer-events-none absolute bottom-[2px] h-[2px] rounded-pill"
          style={{
            background: 'var(--accent)',
            // Where the two halves touch, the line runs straight through: one
            // window, one line, however many tabs it is drawn under.
            left: joined === 'right' ? 0 : 6,
            right: joined === 'left' ? 0 : 6,
            borderTopLeftRadius: joined === 'right' ? 0 : undefined,
            borderBottomLeftRadius: joined === 'right' ? 0 : undefined,
            borderTopRightRadius: joined === 'left' ? 0 : undefined,
            borderBottomRightRadius: joined === 'left' ? 0 : undefined
          }}
        />
      )}

      {/* How deep in the chain of "opened from" this tab sits. A quiet step
          in, not a tree with lines: the strip has to stay a strip. */}
      {tab.depth > 0 && !tab.pinned && (
        <span
          className="pointer-events-none shrink-0"
          style={{ width: Math.min(tab.depth, 4) * (vertical ? 12 : 6) }}
        />
      )}

      <Favicon tab={tab} />

      {/* The count the page keeps in its own title, on its icon. */}
      {tab.badge > 0 && (
        <span
          className="pointer-events-none absolute flex h-[14px] min-w-[14px] items-center justify-center rounded-pill px-[3px] text-[9px] font-bold text-white"
          style={{
            left: (tab.pinned && !vertical ? 20 : 20) + Math.min(tab.depth, 4) * (vertical ? 12 : 6),
            top: 3,
            background: 'var(--bad)',
            boxShadow: '0 0 0 2px var(--surface-solid)'
          }}
        >
          {tab.badge > 99 ? '99+' : tab.badge}
        </span>
      )}

      {/* Which half of the window this one fills. The pair reads as a pair
          because the same mark is on both, filled on opposite sides. */}
      {half && !joined && !(tab.pinned && !vertical) && (
        <span
          className="animate-pop shrink-0"
          style={{ color: 'var(--accent)' }}
          title={half === 'left' ? t('Показана слева') : t('Показана справа')}
        >
          {half === 'left' ? <HalfLeft width={13} height={13} /> : <HalfRight width={13} height={13} />}
        </span>
      )}

      {!(tab.pinned && !vertical) && !folded && (
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-sm',
            tab.active ? 'font-medium text-ink' : tab.unread ? 'font-medium text-ink' : 'text-dim'
          )}
        >
          {title}
        </span>
      )}

      {/* Put aside on purpose: a dot, the way an unread message is marked. */}
      {tab.unread && !tab.active && (
        <span
          className="pointer-events-none shrink-0 rounded-pill"
          style={{ width: 6, height: 6, background: 'var(--accent)' }}
          title={t('Отметить непрочитанной')}
        />
      )}

      {asleep(tab) && <Sleep width={12} height={12} className="shrink-0 text-faint" />}

      {tab.pinned && vertical && <Pin width={12} height={12} className="shrink-0 text-faint" />}

      {audio && (
        <button
          className="no-drag shrink-0 rounded-[6px] p-[3px] text-dim hover:bg-[var(--field-idle)] hover:text-ink"
          title={tab.muted ? t('Включить звук') : t('Выключить звук')}
          onClick={(event) => {
            event.stopPropagation()
            window.browser.toggleMute(tab.id)
          }}
          style={{ transition: 'background var(--t-fast) linear, color var(--t-fast) linear' }}
        >
          {tab.muted ? <VolumeOff width={12} height={12} /> : <Volume width={12} height={12} />}
        </button>
      )}

      <button
        aria-label={t('Закрыть вкладку')}
        hidden={tab.pinned || folded}
        onClick={(event) => {
          event.stopPropagation()
          window.browser.closeTab(tab.id)
        }}
        className="no-drag shrink-0 rounded-[6px] p-[3px] text-faint hover:bg-[var(--line-strong)] hover:text-ink"
        style={{
          opacity: showClose ? 1 : 0,
          pointerEvents: showClose ? 'auto' : 'none',
          transition: 'opacity var(--t-fast) linear, background var(--t-fast) linear'
        }}
      >
        <Cross width={12} height={12} />
      </button>

      {peek && !leaving && <Preview id={tab.id} x={peek.x} y={peek.y} title={title} />}
    </div>
  )
}

/**
 * A picture of what a tab is showing, under the cursor.
 *
 * Twenty tabs called "Документ" are twenty identical tabs, and the only thing
 * that tells them apart is what they look like. The picture is asked for when
 * the pointer has stayed still for a moment — not on every pass across the
 * strip — and the browser keeps it for a few seconds so going back and forth
 * along a row costs one capture per tab.
 */
function Preview({ id, x, y, title }: { id: number; x: number; y: number; title: string }) {
  const [shot, setShot] = useState('')
  useEffect(() => {
    let alive = true
    void window.browser.tabPreview(id).then((data) => {
      if (alive) setShot(data)
    })
    return () => {
      alive = false
    }
  }, [id])

  const width = 268
  const left = Math.max(8, Math.min(x - width / 2, window.innerWidth - width - 8))
  return (
    <div
      className="animate-fade pointer-events-none fixed z-[90] overflow-hidden rounded-[12px]"
      style={{
        left,
        top: y + 6,
        width,
        background: 'var(--elevated)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(20px) saturate(160%)'
      }}
    >
      {shot ? (
        <img src={shot} alt="" className="block w-full" style={{ aspectRatio: '16 / 10', objectFit: 'cover' }} />
      ) : (
        <div
          className="flex items-center justify-center text-2xs text-faint"
          style={{ height: 96, background: 'var(--field-idle)' }}
        >
          {t('Вкладка спит')}
        </div>
      )}
      <div className="truncate px-2.5 py-1.5 text-2xs text-dim">{title}</div>
    </div>
  )
}

/**
 * Several tabs at once.
 *
 * Ctrl-clicking a tab gathers it instead of going to it, and a bar appears
 * saying how many are gathered and offering the three things anybody does with
 * a handful of tabs: close them, put them in a group, or take them into a
 * window of their own. Clicking an ungathered tab, or pressing Escape, lets
 * them go — nothing stays selected across a change of mind.
 */
function usePicked(tabs: TabState[]) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set())

  // A tab that has closed cannot still be picked.
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set([...prev].filter((id) => tabs.some((tab) => tab.id === id)))
      return alive.size === prev.size ? prev : alive
    })
  }, [tabs])

  useEffect(() => {
    if (picked.size === 0) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicked(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked.size])

  const pick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return { picked, pick, clear: () => setPicked(new Set()) }
}

/** The bar that appears while several tabs are gathered. */
function PickedBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  if (ids.length === 0) return null
  return (
    <div
      className="animate-slide-down no-drag fixed left-1/2 top-[46px] z-[80] flex -translate-x-1/2 items-center gap-2 rounded-pill py-1.5 pl-4 pr-2"
      style={{
        background: 'var(--elevated)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(24px) saturate(160%)'
      }}
    >
      <span className="text-sm font-medium">
        {t('Выбрано вкладок: {n}', { n: ids.length })}
      </span>
      <button
        className="btn h-[26px] px-2.5 text-2xs"
        onClick={() => {
          void window.browser.groupTabs(ids)
          onDone()
        }}
      >
        {t('В группу')}
      </button>
      <button
        className="btn h-[26px] px-2.5 text-2xs"
        onClick={() => {
          for (const id of ids) void window.browser.detachTab(id)
          onDone()
        }}
      >
        {t('В отдельное окно')}
      </button>
      <button
        className="btn h-[26px] px-2.5 text-2xs"
        style={{ color: 'var(--bad)' }}
        onClick={() => {
          for (const id of ids) window.browser.closeTab(id)
          onDone()
        }}
      >
        {t('Закрыть')}
      </button>
      <button className="icon-btn" aria-label={t('Отмена')} onClick={onDone}>
        <Cross width={13} height={13} />
      </button>
    </div>
  )
}

/** How tall anything that stands in the strip is. */

/* ------------------------------------------------------------ group chip */

/**
 * The name over a run of tabs. Clicking folds the run away; right-clicking
 * opens the group's own menu, where it is renamed, recoloured, pinned or
 * closed. Double-clicking renames it in place, which is how a folder gets a
 * name without a dialog in the way.
 *
 * The chip is also the group's handle: dragging it carries the whole run, and
 * dropping a tab on it puts that tab in the group.
 */
function GroupChip({
  group,
  count,
  index,
  settings,
  vertical,
  reorder
}: {
  group: TabGroup
  count: number
  /** where this group's first tab sits in the real list */
  index: number
  settings: Settings
  vertical: boolean
  reorder: Reorder
}) {
  const [editing, setEditing] = useState(false)
  const [over, setOver] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      field.current?.focus()
      field.current?.select()
    }
  }, [editing])

  // The menu cannot hold a text field, so "Rename" asks the chip to open one.
  // Choosing a colour needs more room and goes to the overlay instead.
  useEffect(
    () =>
      window.browser.onGroupEdit((edit) => {
        if (edit.id === group.id && edit.action === 'rename') setEditing(true)
      }),
    [group.id]
  )

  const commit = () => {
    const name = field.current?.value ?? ''
    setEditing(false)
    if (name.trim() && name !== group.name) void window.browser.renameGroup(group.id, name.trim())
  }

  return (
    <div
      draggable={!editing}
      className={cx(
        'no-drag relative flex shrink-0 items-center gap-1.5 px-2.5',
        vertical ? 'w-full' : ''
      )}
      style={{
        // The same height and the same corners as a tab, compact or not: the
        // chip stands in the strip beside them, and a name that is shorter than
        // what it names reads as something that fell short.
        height: tabHeight(settings),
        borderRadius: 11,
        background: `color-mix(in srgb, ${group.color} ${over ? 42 : 22}%, transparent)`,
        border: `1px solid color-mix(in srgb, ${group.color} ${over ? 90 : 45}%, transparent)`,
        cursor: 'pointer',
        transition: 'background var(--t-fast) linear, border-color var(--t-fast) linear'
      }}
      title={group.collapsed ? t('Развернуть группу') : t('Свернуть группу')}
      onClick={() => !editing && void window.browser.toggleGroup(group.id)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditing(true)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.browser.groupMenu(group.id)
      }}
      onDragStart={() => reorder.onGroupDragStart(group.id)}
      onDragOver={(event) => {
        event.preventDefault()
        // A tab being carried lands in the group; a group being carried lands
        // where this one starts.
        if (reorder.carryingTab()) setOver(true)
        else reorder.onDragOver(index)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false)
        reorder.onDropOnGroup(group.id, index)
      }}
    >
      {/* The picture replaces the dot when there is one: with four groups
          open, a colour each stops being enough to tell them apart. */}
      {group.icon ? (
        <span className='shrink-0 text-2xs leading-none'>{group.icon}</span>
      ) : (
        <span
          className='shrink-0 rounded-pill'
          style={{ width: 7, height: 7, background: group.color }}
        />
      )}
      {editing ? (
        <input
          ref={field}
          defaultValue={group.name}
          className='min-w-0 flex-1 bg-transparent text-2xs font-semibold outline-none'
          style={{ width: 90 }}
          onClick={(event) => event.stopPropagation()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className='min-w-0 max-w-[120px] truncate text-2xs font-semibold text-ink'>
          {group.name}
        </span>
      )}
      {group.pinned && <Pin width={11} height={11} className='shrink-0 text-dim' />}
      {group.collapsed && <span className='shrink-0 text-2xs text-dim'>{count}</span>}

    </div>
  )
}

/* ---------------------------------------------------------------- the rows */

type Row =
  | { kind: 'tab'; tab: TabState; index: number; group?: TabGroup; first?: boolean; last?: boolean }
  | { kind: 'group'; group: TabGroup; count: number; index: number }

/**
 * The strip is a flat list of tabs with names laid over runs of them. This
 * turns one into the other: a chip before each group, and the group's tabs
 * left out while it is folded. The index carried along is the tab's index in
 * the real list, because that is what a drop has to be expressed in.
 */
/**
 * The tabs to draw, which is the tabs there are plus the ones that have
 * just gone — put back where they were, for as long as it takes them to
 * narrow to nothing. Without this the strip jumps sideways and leaves
 * whoever pressed the × working out what happened.
 */
function useFarewell(tabs: TabState[]) {
  const [going, setGoing] = useState<Array<{ tab: TabState; at: number }>>([])
  const before = useRef(tabs)

  useEffect(() => {
    const gone = before.current
      .map((tab, at) => ({ tab, at }))
      .filter(({ tab }) => !tabs.some((one) => one.id === tab.id))
    before.current = tabs
    if (gone.length === 0) return
    setGoing((old) => [...old, ...gone])
    const timer = window.setTimeout(
      () => setGoing((old) => old.filter((item) => !gone.some((one) => one.tab.id === item.tab.id))),
      260
    )
    return () => window.clearTimeout(timer)
  }, [tabs])

  if (going.length === 0) return { drawn: tabs, leaving: EMPTY }
  const drawn = [...tabs]
  for (const { tab, at } of going) drawn.splice(Math.min(at, drawn.length), 0, tab)
  return { drawn, leaving: new Set(going.map((item) => item.tab.id)) }
}

const EMPTY: ReadonlySet<number> = new Set()

function rowsOf(tabs: TabState[], groups: TabGroup[]): Row[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const rows: Row[] = []
  let seen: number | null = null
  tabs.forEach((tab, index) => {
    if (tab.groupId !== seen) {
      seen = tab.groupId
      const group = tab.groupId === null ? undefined : byId.get(tab.groupId)
      if (group) {
        rows.push({
          kind: 'group',
          group,
          index,
          count: tabs.filter((t) => t.groupId === group.id).length
        })
      }
    }
    const group = tab.groupId === null ? undefined : byId.get(tab.groupId)
    if (group?.collapsed) return
    rows.push({
      kind: 'tab',
      tab,
      index,
      group,
      first: group ? tabs[index - 1]?.groupId !== tab.groupId : undefined,
      last: group ? tabs[index + 1]?.groupId !== tab.groupId : undefined
    })
  })
  return rows
}

/* ------------------------------------------------------------ reorder glue */
/**
 * One drag at a time, and it is carrying either a tab or a whole group. Both
 * end in the same place — an index in the real list of tabs — so the strip
 * only has to say where the pointer is and what it was let go of.
 */
function useReorder() {
  const dragTab = useRef<number | null>(null)
  const dragGroup = useRef<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const clear = () => {
    dragTab.current = null
    dragGroup.current = null
    setDropIndex(null)
  }

  return {
    dropIndex,
    carryingTab: () => dragTab.current !== null,
    onDragStart: (id: number) => {
      dragTab.current = id
      dragGroup.current = null
    },
    onGroupDragStart: (id: number) => {
      dragGroup.current = id
      dragTab.current = null
    },
    onDragOver: (index: number) => setDropIndex(index),
    onDrop: () => {
      if (dropIndex !== null) {
        if (dragTab.current !== null) void window.browser.moveTab(dragTab.current, dropIndex)
        else if (dragGroup.current !== null) void window.browser.moveGroup(dragGroup.current, dropIndex)
      }
      clear()
    },
    /** Let go over a group's name: a tab joins it, a group takes its place. */
    onDropOnGroup: (groupId: number, index: number) => {
      if (dragTab.current !== null) void window.browser.dropOnGroup(dragTab.current, groupId)
      else if (dragGroup.current !== null && dragGroup.current !== groupId) {
        void window.browser.moveGroup(dragGroup.current, index)
      }
      clear()
    },
    onDragEnd: clear
  }
}

type Reorder = ReturnType<typeof useReorder>

/* -------------------------------------------------------------- horizontal */
/**
 * Tabs that have moved are seen to move.
 *
 * When a tab changes places — joined to another, dragged, or shifted along by
 * one that left — it is put back where it was for an instant and then let go,
 * so the eye can follow it to its new place instead of finding it already
 * there. Everything here is measured and written straight to the elements:
 * a measurement that set state would measure its own result for ever.
 */
function useFlight(row: RefObject<HTMLDivElement | null>, key: string) {
  const seen = useRef(new Map<number, { x: number; y: number }>())
  useLayoutEffect(() => {
    const strip = row.current
    if (!strip) return
    const items = strip.querySelectorAll<HTMLElement>('[data-tab-id]')
    const now = new Map<number, { x: number; y: number }>()
    items.forEach((el) => {
      const id = Number(el.dataset.tabId)
      const at = el.getBoundingClientRect()
      const here = { x: at.left, y: at.top }
      const from = seen.current.get(id)
      now.set(id, here)
      if (!from) return
      // Along the strip, or down the rail: whichever way this one is stacked.
      const dx = from.x - here.x
      const dy = from.y - here.y
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      el.style.transition = 'none'
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform calc(420ms * var(--speed)) var(--ease-emph)'
        el.style.transform = 'translate3d(0, 0, 0)'
      })
    })
    seen.current = now
  }, [key, row])
}

/**
 * Whether a tab's other half is standing right next to it. Only then are the
 * two drawn as one thing — otherwise they are simply two marked tabs, which
 * is the honest picture when something else sits between them.
 */
function joinedAt(rows: Row[], id: number, halfOf: (id: number) => Half): Half | null {
  const line = rows.filter((row): row is Extract<Row, { kind: 'tab' }> => row.kind === 'tab')
  const at = line.findIndex((row) => row.tab.id === id)
  if (at === -1) return null
  const mine = halfOf(id)
  if (!mine) return null
  const next = mine === 'left' ? line[at + 1] : line[at - 1]
  if (!next || halfOf(next.tab.id) === mine || !halfOf(next.tab.id)) return null
  return mine
}

/** The two tabs shown side by side, as the strip needs to know them. */
function useSplitPair() {
  const [pair, setPair] = useState<SplitState | null>(null)
  useEffect(() => {
    void window.browser.splitState().then(setPair)
    return window.browser.onSplit(setPair)
  }, [])
  return (id: number): Half =>
    pair ? (pair.left === id ? 'left' : pair.right === id ? 'right' : null) : null
}

export function TabStrip({
  tabs,
  groups,
  spaces,
  settings
}: {
  tabs: TabState[]
  groups: TabGroup[]
  spaces: TabSpace[]
  settings: Settings
}) {
  const halfOf = useSplitPair()
  const reorder = useReorder()
  const { picked, pick, clear } = usePicked(tabs)
  const { drawn, leaving } = useFarewell(tabs)
  const rows = rowsOf(drawn, groups)
  // More tabs than the window is wide used to be drawn past its edge and cut
  // off there — tabs you could neither read nor click. The run of them slides
  // instead, and the tab in front of you is brought back into sight whenever
  // it changes.
  const scroller = useRef<HTMLDivElement>(null)
  const activeId = tabs.find((tab) => tab.active)?.id
  // Whether there are tabs behind either end of what you can see. An arrow
  // appears on that side and nowhere else: an arrow pointing at nothing is
  // worse than no arrow.
  const [more, setMore] = useState({ left: false, right: false })
  // The order of the tabs, as a single word: when it changes, they fly.
  useFlight(
    scroller,
    rows.map((row) => (row.kind === 'tab' ? row.tab.id : `g${row.group.id}`)).join(',')
  )
  const measure = () => {
    const row = scroller.current
    if (!row) return
    // A few pixels over is not something to put an arrow next to.
    const room = row.scrollWidth - row.clientWidth
    const left = room > 8 && row.scrollLeft > 4
    const right = room > 8 && row.scrollLeft + row.clientWidth < row.scrollWidth - 4
    setMore((was) => (was.left === left && was.right === right ? was : { left, right }))
  }
  const slide = (way: -1 | 1) => {
    const row = scroller.current
    if (!row) return
    row.scrollBy({ left: way * Math.max(140, row.clientWidth * 0.8), behavior: 'smooth' })
  }
  useEffect(() => {
    const at = scroller.current?.querySelector('[data-active-tab]')
    at?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeId, tabs.length])

  // A tab list that changed is measured now and again while it settles: a
  // closed tab is still on screen, narrowing, for a fifth of a second, and
  // measuring only at the start of that left an arrow pointing at nothing.
  // Watched for a moment rather than after every paint — a measurement that
  // sets state, run after every commit, has nothing to stop it going round.
  useEffect(() => {
    measure()
    const timers = [80, 180, 300, 420].map((after) => window.setTimeout(measure, after))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [tabs.length, rows.length, settings.tabMaxWidth, settings.tabPosition])

  // The window being resized changes what fits without anything scrolling,
  // and that is not a render, so it is watched for separately.
  useEffect(() => {
    const row = scroller.current
    if (!row) return
    const watch = new ResizeObserver(() => measure())
    watch.observe(row)
    return () => watch.disconnect()
  }, [])

  return (
    <div
      className="drag flex items-center gap-1 overflow-hidden px-2 pb-1.5"
      onDragEnd={reorder.onDragEnd}
      onDoubleClick={() => window.browser.maximize()}
    >
      <PickedBar ids={[...picked]} onDone={clear} />
      {/* The group in force, and any pinned beside it — never more than a
          slice of the window, however many are pinned, because the tabs are
          what the strip is for. */}
      <div className="no-bar flex max-w-[42%] shrink-0 items-center gap-0.5 overflow-x-auto pr-1">
        {chipsOf(spaces).map(({ space, index }) => (
          <SpaceChip
            key={space.id}
            space={space}
            index={index}
            withArrow={space.id === arrowHolder(chipsOf(spaces))}
          />
        ))}
      </div>
      {/* The arrows sit over the ends of the run of tabs rather than beside
          it. In the row they would take twenty pixels from the very width
          that decides whether they are needed — show one and the tabs fit,
          hide it and they do not, forever. */}
      <div className="relative flex min-w-0 items-center" style={{ flex: '0 1 auto' }}>
      <div
        ref={scroller}
        className="no-bar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden"
        onScroll={measure}
        // A wheel has one direction and the strip has the other, so whichever
        // way it is turned moves the tabs along — a touchpad's sideways swipe
        // included.
        onWheel={(event) => {
          const row = scroller.current
          if (!row || row.scrollWidth <= row.clientWidth) return
          const by = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
          if (by) row.scrollLeft += by
        }}
      >
        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupChip
              key={`g${row.group.id}`}
              group={row.group}
              count={row.count}
              index={row.index}
              settings={settings}
              vertical={false}
              reorder={reorder}
            />
          ) : (
            <TabItem
              key={row.tab.id}
              tab={row.tab}
              half={halfOf(row.tab.id)}
              joined={joinedAt(rows, row.tab.id, halfOf)}
              leaving={leaving.has(row.tab.id)}
              settings={settings}
              index={row.index}
              group={row.group}
              first={row.first}
              last={row.last}
              vertical={false}
              dropIndex={reorder.dropIndex}
              picked={picked.has(row.tab.id)}
              onPick={pick}
              onDragStart={reorder.onDragStart}
              onDragOver={reorder.onDragOver}
              onDrop={reorder.onDrop}
            />
          )
        )}
      </div>
      <Edge side="left" shown={more.left} onClick={() => slide(-1)} />
      <Edge side="right" shown={more.right} onClick={() => slide(1)} />
      </div>
      <button className="icon-btn shrink-0" title={t('Новая вкладка · Ctrl+T')} onClick={() => window.browser.newTab()}>
        <Plus />
      </button>
      <div className="flex-1" />
    </div>
  )
}

/**
 * One of the two arrows at the ends of a full strip. Always rendered, so the
 * width of the strip never depends on whether it is showing; it fades in and
 * out and takes no clicks while it is out.
 */
function Edge({
  side,
  shown,
  onClick
}: {
  side: 'left' | 'right'
  shown: boolean
  onClick: () => void
}) {
  const label = side === 'left' ? t('Прокрутить вкладки влево') : t('Прокрутить вкладки вправо')
  return (
    <button
      className="icon-btn absolute top-1/2 h-6 w-6"
      title={label}
      aria-label={label}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onClick={onClick}
      style={{
        [side]: 0,
        transform: 'translateY(-50%)',
        opacity: shown ? 1 : 0,
        pointerEvents: shown ? 'auto' : 'none',
        background: 'var(--surface-solid)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'opacity var(--t-fast) linear, background var(--t-fast) linear'
      }}
    >
      {side === 'left' ? <ChevronLeft width={13} height={13} /> : <ChevronRight width={13} height={13} />}
    </button>
  )
}

/**
 * The head of the strip: how many tabs are open, and a way into the list of
 * them. Ten tabs fit across a window and thirty do not, and past that point
 * the strip is favicons and guesswork.
 */
/**
 * Which big groups the strip shows, in the order it shows them: the pinned
 * ones first, because pinned means staying put, and then whichever else is
 * open — the same shape as a pinned tab and the rest of the strip.
 *
 * The index travels with each, because an unnamed group is called by its
 * number and that number is where it sits in the list, not in this row.
 */
function chipsOf(spaces: TabSpace[]): Array<{ space: TabSpace; index: number }> {
  const all = spaces.map((space, index) => ({ space, index }))
  return [
    ...all.filter((item) => item.space.pinned),
    ...all.filter((item) => item.space.active && !item.space.pinned)
  ]
}

/**
 * Which of them carries the arrow: whichever is leftmost. With groups
 * pinned that is the first pinned one — and it moves with them when they
 * are dragged about — and with none pinned it is the one in force, which
 * is the only chip there is then.
 */
function arrowHolder(chips: Array<{ space: TabSpace }>): number {
  return chips[0]?.space.id ?? -1
}

/**
 * A big group in the strip: the one in force, and any that are pinned.
 *
 * Pressing it switches to that group. One of them also carries the arrow into
 * the list of tabs and groups — the pinned one, because a pinned group is the
 * one that is always there, and the group in force when none is pinned. The
 * arrow is a target of its own inside the chip, so it never gets in the way of
 * the switch.
 */
function SpaceChip({
  space,
  index,
  withArrow
}: {
  space: TabSpace
  index: number
  /** whether this is the chip that opens the list */
  withArrow: boolean
}) {
  // Only pinned ones are dragged: the loose one is wherever you happen to
  // be, and moving it would be moving nothing.
  const movable = space.pinned
  const tint = space.colour || 'var(--accent)'
  // Numbered by the group itself, not by where it sits: a name that changes
  // when something else is dragged past it is not a name.
  const name = space.name || t('Группа {n}', { n: space.id })
  /**
   * The list opens under the chip, aligned with its left edge — the arrow is a
   * button of its own at the right end of it, and measuring from there put the
   * whole panel a chip's width too far over.
   */
  const openList = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.currentTarget as HTMLElement
    const chip = target.closest('[data-space-chip]') ?? target
    const box = chip.getBoundingClientRect()
    void window.browser.setOverlay(`tabs-panel:${Math.round(box.left)}`)
  }

  return (
    <span
      data-space-chip=""
      className="no-drag flex h-7 shrink-0 items-center rounded-[9px] pl-1 pr-0.5 text-2xs font-semibold"
      draggable={movable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/nya-space', String(space.id))
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (!movable) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        const dragged = Number(event.dataTransfer.getData('text/nya-space'))
        if (!dragged || dragged === space.id) return
        event.preventDefault()
        void window.browser.moveSpace(dragged, index)
      }}
      style={{
        background: space.active ? `color-mix(in srgb, ${tint} 22%, transparent)` : 'transparent',
        color: space.active ? 'var(--ink)' : 'var(--text-dim)',
        boxShadow: space.active
          ? `inset 0 0 0 1px color-mix(in srgb, ${tint} 45%, transparent)`
          : 'none',
        transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
      }}
    >
      <button
        className="flex h-7 items-center gap-1.5 pr-1"
        title={space.active ? t('Все вкладки и группы') : name}
        onClick={(event) => {
          if (space.active) return openList(event)
          void window.browser.switchSpace(space.id)
        }}
      >
        {/* How many tabs are in it, before its name. In a square of its own,
            because a bare number beside a name reads as part of the name — and
            it carries the group's colour, so the dot that used to sit in front
            of it was the same thing said twice. */}
        <span
          className="flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-[6px] px-1 tabular-nums"
          style={{
            background: space.active
              ? `color-mix(in srgb, ${tint} 34%, transparent)`
              : 'var(--surface-hover)',
            color: space.active ? 'var(--ink)' : 'var(--text-dim)'
          }}
        >
          {space.count}
        </span>
        <span className="max-w-[120px] truncate">{name}</span>
      </button>
      {withArrow && (
        <button
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] hover:bg-[var(--surface-hover)]"
          title={t('Все вкладки и группы')}
          aria-label={t('Все вкладки и группы')}
          onClick={openList}
        >
          <ChevronDown width={11} height={11} />
        </button>
      )}
    </span>
  )
}
/* ---------------------------------------------------------------- vertical */
export function TabRail({
  tabs,
  groups,
  spaces,
  settings,
  side
}: {
  tabs: TabState[]
  groups: TabGroup[]
  spaces: TabSpace[]
  settings: Settings
  side: 'left' | 'right'
}) {
  const halfOf = useSplitPair()
  const reorder = useReorder()
  const { picked, pick, clear } = usePicked(tabs)
  const { drawn, leaving } = useFarewell(tabs)
  const rows = rowsOf(drawn, groups)
  const column = useRef<HTMLDivElement>(null)
  useFlight(
    column,
    rows.map((row) => (row.kind === 'tab' ? row.tab.id : `g${row.group.id}`)).join(',')
  )

  return (
    <aside
      className="contain flex h-full shrink-0 flex-col gap-1.5 px-2.5 pb-2.5 pt-1"
      style={{
        width: settings.railWidth,
        [side === 'left' ? 'borderRight' : 'borderLeft']: '1px solid var(--line)',
        transition: 'width var(--t-slow) var(--ease-out)'
      }}
      onDragEnd={reorder.onDragEnd}
    >
      {/* No heading: a column of tabs does not need a line above it saying
          how many tabs are in the column, and the way into the full list is
          on the big group's chip. The new tab keeps the corner it had, and
          the groups come up beside it into the row that heading was using. */}
      <div className="flex items-start gap-1 px-0.5 pb-1">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {chipsOf(spaces).map(({ space, index }) => (
            <SpaceChip
              key={space.id}
              space={space}
              index={index}
              withArrow={space.id === arrowHolder(chipsOf(spaces))}
            />
          ))}
        </div>
        <button
          className="icon-btn h-7 w-7 shrink-0"
          title={t('Новая вкладка · Ctrl+T')}
          onClick={() => window.browser.newTab()}
        >
          <Plus width={14} height={14} />
        </button>
      </div>

      <PickedBar ids={[...picked]} onDone={clear} />

      <div
        ref={column}
        className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overflow-x-hidden pr-0.5"
      >
        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupChip
              key={`g${row.group.id}`}
              group={row.group}
              count={row.count}
              index={row.index}
              settings={settings}
              vertical
              reorder={reorder}
            />
          ) : (
            <TabItem
              key={row.tab.id}
              tab={row.tab}
              half={halfOf(row.tab.id)}
              joined={joinedAt(rows, row.tab.id, halfOf)}
              leaving={leaving.has(row.tab.id)}
              settings={settings}
              index={row.index}
              group={row.group}
              first={row.first}
              last={row.last}
              vertical
              dropIndex={reorder.dropIndex}
              picked={picked.has(row.tab.id)}
              onPick={pick}
              onDragStart={reorder.onDragStart}
              onDragOver={reorder.onDragOver}
              onDrop={reorder.onDrop}
            />
          )
        )}
      </div>
    </aside>
  )
}
