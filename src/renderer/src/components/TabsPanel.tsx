import { t } from '../i18n'
import { useState } from 'react'
import type { TabGroup, TabSpace, TabState } from '../../../shared/types'
import { ChevronDown, ChevronRight, Cross, Globe, Pencil, Pin, Plus, Tabs } from './Icons'

/** The same seven a small group can wear, so the two kinds match. */
const SPACE_COLOURS = ['#7c6cff', '#2fbf71', '#f5a524', '#e5484d', '#38bdf8', '#e879f9', '#94a3b8']

/**
 * Every tab in this window as a list, and every group with it.
 *
 * The strip is fine while ten tabs fit in it and useless at thirty, which is
 * where the titles are gone and the favicons are guesswork. This is the same
 * tabs read down a page instead of across one, with the groups they belong to
 * named above them — and it is where a group gets made, which until now needed
 * a right-click on a tab to find.
 */
export default function TabsPanel({
  tabs,
  groups,
  spaces,
  x,
  onClose
}: {
  tabs: TabState[]
  groups: TabGroup[]
  spaces: TabSpace[]
  /** the left edge of the button that opened this */
  x: number
  onClose: () => void
}) {
  /** The big group being renamed right now, if any. */
  const [editing, setEditing] = useState<number | null>(null)
  const [name, setName] = useState('')
  /** And the one whose colour is being picked. */
  const [painting, setPainting] = useState<number | null>(null)
  const width = 320
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
  const active = tabs.find((tab) => tab.active)
  const grouped = new Map<number, TabState[]>()
  const loose: TabState[] = []
  for (const tab of tabs) {
    if (tab.groupId == null) loose.push(tab)
    else grouped.set(tab.groupId, [...(grouped.get(tab.groupId) ?? []), tab])
  }

  const row = (tab: TabState, colour?: string) => (
    <div
      key={tab.id}
      className="group flex h-8 w-full items-center gap-2 rounded-[8px] px-2 hover:bg-[var(--surface-hover)]"
      style={{ transition: 'background var(--t-fast) linear' }}
    >
      {colour && (
        <span className="h-4 w-[3px] shrink-0 rounded-pill" style={{ background: colour }} />
      )}
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          void window.browser.switchTab(tab.id)
          onClose()
        }}
      >
        {tab.favicon ? (
          <img src={tab.favicon} alt="" className="h-4 w-4 shrink-0 rounded-[3px]" />
        ) : (
          <span className="shrink-0 text-faint">
            <Globe width={13} height={13} />
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm"
          style={{ color: tab.active ? 'var(--ink)' : 'var(--text-dim)', fontWeight: tab.active ? 600 : 400 }}
        >
          {tab.title || t('Новая вкладка')}
        </span>
      </button>
      <button
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] opacity-0 hover:bg-[var(--line)] group-hover:opacity-100"
        title={t('Закрыть вкладку')}
        onClick={() => void window.browser.closeTab(tab.id)}
      >
        <Cross width={11} height={11} />
      </button>
    </div>
  )

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40"
        style={{ background: 'color-mix(in srgb, var(--bg) 40%, transparent)' }}
        onClick={onClose}
      />
      <div
        className="animate-fade-down contain absolute z-50 flex max-h-[min(560px,80vh)] flex-col overflow-hidden rounded-card"
        style={{
          top: 40,
          left,
          width,
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
      >
        <div className="flex shrink-0 items-center justify-between px-2.5 pb-0.5 pt-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-faint">
            {t('Вкладки')} · {tabs.length}
          </span>
          <button
            className="icon-btn h-6 w-6"
            title={t('Новая вкладка · Ctrl+T')}
            onClick={() => {
              void window.browser.newTab()
              onClose()
            }}
          >
            <Plus width={13} height={13} />
          </button>
        </div>

        {/* The big groups: a whole strip of tabs each, kept while you work in
            another. Only worth showing once there is more than the one every
            browser starts with. */}
        {spaces.length > 1 && (
          <div className="shrink-0 border-b px-1.5 pb-1" style={{ borderColor: 'var(--line)' }}>
            {spaces.map((space, index) => (
              <div
                key={space.id}
                className="flex h-8 items-center gap-2 rounded-[8px] pl-2 pr-1 hover:bg-[var(--surface-hover)]"
                style={space.active ? { background: 'var(--surface-hover)' } : undefined}
              >
                {/* The dot is the colour control: nothing else in the row is a
                    colour, and a separate button would be a fourth icon. */}
                <button
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-pill"
                  title={t('Цвет группы')}
                  onClick={() => setPainting(painting === space.id ? null : space.id)}
                >
                  <span
                    className="h-2 w-2 rounded-pill"
                    style={{ background: space.colour || 'var(--accent)' }}
                  />
                </button>

                {editing === space.id ? (
                  <input
                    autoFocus
                    className="field h-[24px] min-w-0 flex-1 text-sm"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void window.browser.editSpace(space.id, { name })
                        setEditing(null)
                      }
                      if (event.key === 'Escape') setEditing(null)
                    }}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    style={{ color: space.active ? 'var(--ink)' : 'var(--text-dim)' }}
                    title={t('Двойной клик — переименовать')}
                    onClick={() => {
                      void window.browser.switchSpace(space.id)
                      onClose()
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setName(space.name)
                      setEditing(space.id)
                    }}
                  >
                    {space.name || t('Группа {n}', { n: space.id })}
                  </button>
                )}

                <span className="shrink-0 text-2xs tabular-nums text-faint">{space.count}</span>
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] hover:bg-[var(--line)]"
                  style={{ color: space.pinned ? 'var(--accent)' : 'var(--text-faint)' }}
                  title={space.pinned ? t('Открепить от полосы') : t('Закрепить в полосе')}
                  onClick={() => void window.browser.editSpace(space.id, { pinned: !space.pinned })}
                >
                  <Pin width={12} height={12} />
                </button>
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-faint hover:bg-[var(--line)] hover:text-ink disabled:opacity-25"
                  title={t('Закрыть группу вкладок')}
                  disabled={spaces.length < 2}
                  onClick={() => void window.browser.closeSpace(space.id)}
                >
                  <Cross width={11} height={11} />
                </button>
              </div>
            ))}
            {painting !== null && (
              <div className="flex flex-wrap items-center gap-1 px-2 pb-1 pt-0.5">
                {SPACE_COLOURS.map((colour) => (
                  <button
                    key={colour}
                    className="h-4 w-4 rounded-pill"
                    style={{ background: colour, outline: '1px solid var(--line)' }}
                    title={colour}
                    onClick={() => {
                      void window.browser.editSpace(painting, { colour })
                      setPainting(null)
                    }}
                  />
                ))}
                <button
                  className="rounded-pill px-1.5 text-2xs text-faint hover:text-ink"
                  onClick={() => {
                    void window.browser.editSpace(painting, { colour: '' })
                    setPainting(null)
                  }}
                >
                  {t('по умолчанию')}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 overflow-y-auto px-1.5 pb-1">
          {loose.map((tab) => row(tab))}

          {groups.map((group) => {
            const inside = grouped.get(group.id) ?? []
            return (
              <div key={group.id} className="mt-1">
                <button
                  className="flex h-7 w-full items-center gap-2 rounded-[8px] px-2 text-left hover:bg-[var(--surface-hover)]"
                  onClick={() => void window.browser.toggleGroup(group.id)}
                  title={group.collapsed ? t('Развернуть группу') : t('Свернуть группу')}
                >
                  <span className="shrink-0 text-faint">
                    {group.collapsed ? (
                      <ChevronRight width={12} height={12} />
                    ) : (
                      <ChevronDown width={12} height={12} />
                    )}
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-pill"
                    style={{ background: group.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {group.name || t('Группа')}
                  </span>
                  <span className="shrink-0 text-2xs text-faint">{inside.length}</span>
                </button>
                {!group.collapsed && (
                  <div className="pl-3">{inside.map((tab) => row(tab, group.color))}</div>
                )}
              </div>
            )
          })}
        </div>

        <div className="shrink-0 border-t px-1.5 py-1" style={{ borderColor: 'var(--line)' }}>
          {/* Two different things, and they were one word before: a run of tabs
              inside this strip, or a strip of its own. */}
          <button
            className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-sm hover:bg-[var(--surface-hover)]"
            disabled={!active}
            onClick={() => {
              if (active) void window.browser.groupTab(active.id)
              onClose()
            }}
          >
            <span className="text-dim">
              <Plus width={13} height={13} />
            </span>
            {t('Сгруппировать эту вкладку')}
          </button>
          <button
            className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-sm hover:bg-[var(--surface-hover)]"
            onClick={() => {
              void window.browser.newSpace()
              onClose()
            }}
          >
            <span className="text-dim">
              <Tabs width={13} height={13} />
            </span>
            {t('Новая группа вкладок')}
          </button>
        </div>
      </div>
    </>
  )
}
