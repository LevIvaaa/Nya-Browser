import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { InternalPage, Settings, TabGroup, TabSpace, TabState } from '../../../shared/types'
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Cross, Download, Gear, Globe, Key, Pin, Plus, Sleep, Star, Volume, VolumeOff } from './Icons'
import { cx } from './ui'

/** The same icons these pages carry in the toolbar and in the menu. */
const INTERNAL_ICONS: Record<InternalPage, typeof Gear> = {
  settings: Gear,
  history: Clock,
  downloads: Download,
  bookmarks: Star,
  passwords: Key
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
interface ItemProps {
  tab: TabState
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
  onDragStart: (id: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
}

function TabItem({
  tab,
  leaving,
  settings,
  vertical,
  index,
  group,
  first,
  last,
  dropIndex,
  onDragStart,
  onDragOver,
  onDrop
}: ItemProps) {
  const [hover, setHover] = useState(false)
  const height = tabHeight(settings)
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
        onDragStart(tab.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver(index)
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onClick={() => window.browser.switchTab(tab.id)}
      onAuxClick={(event) => {
        if (event.button === 1 && settings.middleClickClose) window.browser.closeTab(tab.id)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.browser.tabMenu(tab.id)
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={vertical ? undefined : `${title}${tab.origin ? ` — ${tab.origin}` : ''}`}
      data-active-tab={tab.active ? '' : undefined}
      className={cx(
        leaving ? (vertical ? 'animate-tab-out-tall' : 'animate-tab-out') : 'animate-tab',
        'no-drag group relative flex cursor-default select-none items-center gap-2 px-2.5',
        vertical ? 'w-full' : 'min-w-[54px] flex-1'
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
        height,
        // A pinned tab is its icon and nothing else: it is there to be found
        // in the same place every time, not to be read.
        width: tab.pinned && !vertical ? 38 : undefined,
        maxWidth: tab.pinned && !vertical ? 38 : vertical ? undefined : settings.tabMaxWidth,
        background: tab.active
          ? 'var(--surface-solid)'
          : hover
            ? 'var(--surface)'
            : group
              ? `color-mix(in srgb, ${group.color} 13%, transparent)`
              : 'transparent',
        boxShadow: tab.active && !group ? 'var(--shadow-sm)' : undefined,
        opacity: asleep(tab) ? 0.62 : 1,
        outline: dropIndex === index ? '2px solid var(--accent)' : 'none',
        outlineOffset: -2,
        transition:
          'background var(--t-base) var(--ease-out), box-shadow var(--t-base) var(--ease-out), opacity var(--t-base) linear, max-width var(--t-slow) var(--ease-out)'
      }}
    >
      {vertical && tab.active && (
        <span
          className="absolute -left-[7px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-pill"
          style={{ background: 'var(--accent)', transition: 'height var(--t-base) var(--ease-spring)' }}
        />
      )}

      <Favicon tab={tab} />

      {!(tab.pinned && !vertical) && (
        <span
          className={cx('min-w-0 flex-1 truncate text-sm', tab.active ? 'font-medium text-ink' : 'text-dim')}
        >
          {title}
        </span>
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
        hidden={tab.pinned}
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
    </div>
  )
}

/** How tall anything that stands in the strip is. */
const tabHeight = (settings: Settings) => (settings.compact ? 30 : 34)

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
      <span
        className='shrink-0 rounded-pill'
        style={{ width: 7, height: 7, background: group.color }}
      />
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
  const reorder = useReorder()
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
              leaving={leaving.has(row.tab.id)}
              settings={settings}
              index={row.index}
              group={row.group}
              first={row.first}
              last={row.last}
              vertical={false}
              dropIndex={reorder.dropIndex}
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
  const reorder = useReorder()
  const { drawn, leaving } = useFarewell(tabs)
  const rows = rowsOf(drawn, groups)

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
          on the big group's chip just below. */}
      <div className="flex items-center justify-end px-1 pb-0.5">
        <button className="icon-btn h-6 w-6" title={t('Новая вкладка · Ctrl+T')} onClick={() => window.browser.newTab()}>
          <Plus width={14} height={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-0.5 pb-1">
        {chipsOf(spaces).map(({ space, index }) => (
          <SpaceChip
            key={space.id}
            space={space}
            index={index}
            withArrow={space.id === arrowHolder(chipsOf(spaces))}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overflow-x-hidden pr-0.5">
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
              leaving={leaving.has(row.tab.id)}
              settings={settings}
              index={row.index}
              group={row.group}
              first={row.first}
              last={row.last}
              vertical
              dropIndex={reorder.dropIndex}
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
