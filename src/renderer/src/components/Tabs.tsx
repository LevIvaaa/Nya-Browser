import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { InternalPage, Settings, TabGroup, TabState } from '../../../shared/types'
import { Clock, Cross, Download, Gear, Globe, Key, Pin, Plus, Sleep, Star, Volume, VolumeOff } from './Icons'
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
  const height = settings.compact ? 30 : 34
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
      className={cx(
        'animate-tab no-drag group relative flex cursor-default select-none items-center gap-2 px-2.5',
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

/* ------------------------------------------------------------ group chip */

/**
 * The name over a run of tabs. Clicking folds the run away; right-clicking
 * opens the group's own menu, where it is renamed, recoloured or closed.
 * Double-clicking renames it in place, which is how a folder gets a name
 * without a dialog in the way.
 */
function GroupChip({
  group,
  count,
  vertical
}: {
  group: TabGroup
  count: number
  vertical: boolean
}) {
  const [editing, setEditing] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      field.current?.focus()
      field.current?.select()
    }
  }, [editing])

  const commit = () => {
    const name = field.current?.value ?? ''
    setEditing(false)
    if (name.trim() && name !== group.name) void window.browser.renameGroup(group.id, name.trim())
  }

  return (
    <div
      className={cx(
        'no-drag flex shrink-0 items-center gap-1.5 rounded-[8px] px-2',
        vertical ? 'w-full' : ''
      )}
      style={{
        height: vertical ? 24 : 26,
        background: `color-mix(in srgb, ${group.color} 22%, transparent)`,
        border: `1px solid color-mix(in srgb, ${group.color} 45%, transparent)`,
        cursor: 'pointer'
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
      {group.collapsed && <span className='shrink-0 text-2xs text-dim'>{count}</span>}
    </div>
  )
}

/* ---------------------------------------------------------------- the rows */

type Row =
  | { kind: 'tab'; tab: TabState; index: number; group?: TabGroup; first?: boolean; last?: boolean }
  | { kind: 'group'; group: TabGroup; count: number }

/**
 * The strip is a flat list of tabs with names laid over runs of them. This
 * turns one into the other: a chip before each group, and the group's tabs
 * left out while it is folded. The index carried along is the tab's index in
 * the real list, because that is what a drop has to be expressed in.
 */
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
function useReorder() {
  const dragId = useRef<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  return {
    dropIndex,
    onDragStart: (id: number) => {
      dragId.current = id
    },
    onDragOver: (index: number) => setDropIndex(index),
    onDrop: () => {
      if (dragId.current !== null && dropIndex !== null) {
        void window.browser.moveTab(dragId.current, dropIndex)
      }
      dragId.current = null
      setDropIndex(null)
    },
    onDragEnd: () => {
      dragId.current = null
      setDropIndex(null)
    }
  }
}

/* -------------------------------------------------------------- horizontal */
export function TabStrip({
  tabs,
  groups,
  settings
}: {
  tabs: TabState[]
  groups: TabGroup[]
  settings: Settings
}) {
  const reorder = useReorder()
  const rows = rowsOf(tabs, groups)

  return (
    <div
      className="drag flex items-center gap-1 overflow-hidden px-2 pb-1.5"
      onDragEnd={reorder.onDragEnd}
      onDoubleClick={() => window.browser.maximize()}
    >
      <div className="flex min-w-0 items-center gap-1" style={{ flex: '0 1 auto' }}>
        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupChip key={`g${row.group.id}`} group={row.group} count={row.count} vertical={false} />
          ) : (
            <TabItem
              key={row.tab.id}
              tab={row.tab}
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
      <button className="icon-btn shrink-0" title={t('Новая вкладка · Ctrl+T')} onClick={() => window.browser.newTab()}>
        <Plus />
      </button>
      <div className="flex-1" />
    </div>
  )
}

/* ---------------------------------------------------------------- vertical */
export function TabRail({
  tabs,
  groups,
  settings,
  side
}: {
  tabs: TabState[]
  groups: TabGroup[]
  settings: Settings
  side: 'left' | 'right'
}) {
  const reorder = useReorder()
  const rows = rowsOf(tabs, groups)

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
      <div className="flex items-center justify-between px-1 pb-0.5">
        <span className="text-2xs font-semibold uppercase tracking-wider text-faint">
          Вкладки · {tabs.length}
        </span>
        <button className="icon-btn h-6 w-6" title={t('Новая вкладка · Ctrl+T')} onClick={() => window.browser.newTab()}>
          <Plus width={14} height={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overflow-x-hidden pr-0.5">
        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupChip key={`g${row.group.id}`} group={row.group} count={row.count} vertical />
          ) : (
            <TabItem
              key={row.tab.id}
              tab={row.tab}
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
