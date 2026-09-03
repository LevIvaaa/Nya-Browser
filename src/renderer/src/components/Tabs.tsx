import { t } from '../i18n'
import { useRef, useState } from 'react'
import type { InternalPage, Settings, TabState } from '../../../shared/types'
import { Clock, Cross, Download, Gear, Globe, Key, Plus, Sleep, Star, Volume, VolumeOff } from './Icons'
import { cx } from './ui'

/** The same icons these pages carry in the toolbar and in the menu. */
const INTERNAL_ICONS: Record<InternalPage, typeof Gear> = {
  settings: Gear,
  history: Clock,
  downloads: Download,
  bookmarks: Star,
  passwords: Key
}

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
        className={cx('shrink-0 rounded-[4px] object-contain', tab.sleeping && 'opacity-45 saturate-0')}
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
        opacity: tab.sleeping ? 0.45 : 1
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
  dropIndex: number | null
  onDragStart: (id: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
}

function TabItem({ tab, settings, vertical, index, dropIndex, onDragStart, onDragOver, onDrop }: ItemProps) {
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
        'animate-tab no-drag group relative flex cursor-default select-none items-center gap-2 rounded-[11px] px-2.5',
        vertical ? 'w-full' : 'min-w-[54px] flex-1'
      )}
      style={{
        height,
        maxWidth: vertical ? undefined : settings.tabMaxWidth,
        background: tab.active ? 'var(--surface-solid)' : hover ? 'var(--surface)' : 'transparent',
        boxShadow: tab.active ? 'var(--shadow-sm)' : 'none',
        opacity: tab.sleeping && !tab.active ? 0.62 : 1,
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

      <span className={cx('min-w-0 flex-1 truncate text-sm', tab.active ? 'font-medium text-ink' : 'text-dim')}>
        {title}
      </span>

      {tab.sleeping && <Sleep width={12} height={12} className="shrink-0 text-faint" />}

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
export function TabStrip({ tabs, settings }: { tabs: TabState[]; settings: Settings }) {
  const reorder = useReorder()

  return (
    <div
      className="drag flex items-center gap-1 overflow-hidden px-2 pb-1.5"
      onDragEnd={reorder.onDragEnd}
      onDoubleClick={() => window.browser.maximize()}
    >
      <div className="flex min-w-0 items-center gap-1" style={{ flex: '0 1 auto' }}>
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            settings={settings}
            index={index}
            vertical={false}
            dropIndex={reorder.dropIndex}
            onDragStart={reorder.onDragStart}
            onDragOver={reorder.onDragOver}
            onDrop={reorder.onDrop}
          />
        ))}
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
  settings,
  side
}: {
  tabs: TabState[]
  settings: Settings
  side: 'left' | 'right'
}) {
  const reorder = useReorder()

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
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            settings={settings}
            index={index}
            vertical
            dropIndex={reorder.dropIndex}
            onDragStart={reorder.onDragStart}
            onDragOver={reorder.onDragOver}
            onDrop={reorder.onDrop}
          />
        ))}
      </div>
    </aside>
  )
}
