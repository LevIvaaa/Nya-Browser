import type { Bookmark } from '../../../preload/index'
import { Folder, Star } from './Icons'

/** Compact bar with pinned bookmarks, shown under the tabs when enabled. */
export default function BookmarksBar({ items, onManage }: { items: Bookmark[]; onManage: () => void }) {
  if (items.length === 0) return null
  return (
    <div className="drag flex items-center gap-1 overflow-hidden px-2.5 pb-1.5">
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => window.browser.navigate(item.url)}
            onAuxClick={(event) => event.button === 1 && void window.browser.newTab(item.url, true)}
            onMouseEnter={() => void window.browser.preconnect(item.url)}
            title={item.url}
            className="animate-fade flex h-[26px] shrink-0 items-center gap-1.5 rounded-[9px] px-2 text-sm text-dim hover:text-ink"
            style={{ transition: 'background var(--t-fast) linear, color var(--t-fast) linear' }}
            onMouseOver={(event) => (event.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseOut={(event) => (event.currentTarget.style.background = 'transparent')}
          >
            {item.folder ? <Folder width={12} height={12} /> : <Star width={12} height={12} />}
            <span className="max-w-[150px] truncate">{item.title}</span>
          </button>
        ))}
      </div>
      <button
        className="no-drag shrink-0 rounded-pill px-2 py-0.5 text-2xs text-faint hover:text-ink"
        onClick={onManage}
        style={{ transition: 'color var(--t-fast) linear' }}
      >
        Все закладки
      </button>
    </div>
  )
}
