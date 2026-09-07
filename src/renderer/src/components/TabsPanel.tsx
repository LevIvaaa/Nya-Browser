import { t } from '../i18n'
import type { TabGroup, TabState } from '../../../shared/types'
import { ChevronDown, ChevronRight, Cross, Globe, Plus } from './Icons'

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
  x,
  onClose
}: {
  tabs: TabState[]
  groups: TabGroup[]
  /** the left edge of the button that opened this */
  x: number
  onClose: () => void
}) {
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
      className="group flex h-9 w-full items-center gap-2 rounded-[9px] px-2 hover:bg-[var(--surface-hover)]"
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
        <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2.5">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {loose.map((tab) => row(tab))}

          {groups.map((group) => {
            const inside = grouped.get(group.id) ?? []
            return (
              <div key={group.id} className="mt-1">
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-[9px] px-2 text-left hover:bg-[var(--surface-hover)]"
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

        <div className="shrink-0 border-t px-1.5 py-1.5" style={{ borderColor: 'var(--line)' }}>
          <button
            className="flex h-9 w-full items-center gap-2 rounded-[9px] px-2 text-left text-sm hover:bg-[var(--surface-hover)]"
            disabled={!active}
            onClick={() => {
              if (active) void window.browser.groupTab(active.id)
              onClose()
            }}
          >
            <span className="text-dim">
              <Plus width={13} height={13} />
            </span>
            {t('Новая группа вкладок')}
          </button>
        </div>
      </div>
    </>
  )
}
