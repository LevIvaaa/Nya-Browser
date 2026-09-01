import type { Profile, Settings, TabState, UpdateState } from '../../../shared/types'
import {
  ArrowLeft,
  ArrowRight,
  Cross,
  Download,
  Gear,
  Home,
  Lock,
  More,
  Plus,
  Reload,
  Search,
  Shield,
  Star,
  StarFilled,
  Unlock,
  UpdateArrow
} from './Icons'
import WindowControls from './WindowControls'
import { Avatar, Tooltip, cx } from './ui'

interface Props {
  tab: TabState | undefined
  settings: Settings
  profile: Profile | null
  maximized: boolean
  bookmarked: boolean
  downloadCount: number
  /** null until something about a new version is worth a button */
  update: UpdateState | null
  view: string
  onOpenAddress: () => void
  onToggleView: (view: 'settings' | 'downloads' | 'menu' | 'profiles' | 'update') => void
}

export default function Toolbar({
  tab,
  settings,
  profile,
  maximized,
  bookmarked,
  downloadCount,
  update,
  view,
  onOpenAddress,
  onToggleView
}: Props) {
  const loading = tab?.loading ?? false
  const blocked = tab?.blocked ?? 0
  const secure = tab?.secure ?? true
  const hasContent = tab?.hasContent ?? false
  const canBookmark = Boolean(tab?.url && /^https?:/i.test(tab.url))
  const zoomed = (tab?.zoom ?? 0) !== settings.defaultZoom
  const height = settings.compact ? 40 : 44

  const downloadingUpdate = update?.stage === 'downloading'
  const updateBadge =
    update?.stage === 'available' || downloadingUpdate || update?.stage === 'ready'
  const updateLabel = downloadingUpdate
    ? `Загружаем обновление — ${update?.percent}%`
    : update?.stage === 'ready'
      ? 'Обновление готово к установке'
      : 'Доступно обновление'

  return (
    <div className="drag flex items-center gap-1 pl-2 pr-0" style={{ height }}>
      <div className="no-drag flex items-center gap-0.5">
        <Tooltip label="Назад · Alt+←">
          <button className="icon-btn" disabled={!tab?.canGoBack} onClick={() => window.browser.back()}>
            <ArrowLeft />
          </button>
        </Tooltip>
        <Tooltip label="Вперёд · Alt+→">
          <button className="icon-btn" disabled={!tab?.canGoForward} onClick={() => window.browser.forward()}>
            <ArrowRight />
          </button>
        </Tooltip>
        <Tooltip label={loading ? 'Остановить · Esc' : 'Обновить · Ctrl+R'}>
          <button
            className="icon-btn"
            disabled={!hasContent}
            onClick={() => (loading ? window.browser.stop() : window.browser.reload())}
          >
            {loading ? <Cross /> : <Reload />}
          </button>
        </Tooltip>
        <Tooltip label="Стартовая страница">
          <button className="icon-btn" onClick={() => window.browser.home()}>
            <Home />
          </button>
        </Tooltip>
      </div>

      {/* address field */}
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <button
          onClick={onOpenAddress}
          className="no-drag group relative flex h-[32px] w-full max-w-[760px] items-center gap-2 overflow-hidden rounded-[11px] border px-3 text-left"
          style={{
            background: 'var(--field-idle)',
            borderColor: 'transparent',
            transition: 'background var(--t-fast) var(--ease-out), border-color var(--t-fast) linear'
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'var(--field)'
            event.currentTarget.style.borderColor = 'var(--line)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'var(--field-idle)'
            event.currentTarget.style.borderColor = 'transparent'
          }}
        >
          {hasContent ? (
            secure ? (
              <Lock width={13} height={13} className="shrink-0" style={{ color: 'var(--good)' }} />
            ) : (
              <Unlock width={13} height={13} className="shrink-0" style={{ color: 'var(--warn)' }} />
            )
          ) : (
            <Search width={14} height={14} className="shrink-0 text-faint" />
          )}

          <span className="min-w-0 flex-1 truncate text-sm">
            {tab?.displayUrl ? (
              <>
                <span className="text-ink">{tab.origin}</span>
                <span className="text-faint">{tab.displayUrl.slice(tab.origin.length)}</span>
              </>
            ) : (
              <span className="text-faint">Поиск или адрес сайта</span>
            )}
          </span>

          {zoomed && (
            <span className="shrink-0 rounded-pill px-1.5 py-[1px] text-2xs font-semibold text-dim" style={{ background: 'var(--field)' }}>
              {Math.round(1.2 ** (tab?.zoom ?? 0) * 100)}%
            </span>
          )}

          {blocked > 0 && (
            <span
              className="animate-pop flex shrink-0 items-center gap-1 rounded-pill px-1.5 py-[1px] text-2xs font-semibold"
              title={`Заблокировано на этой странице: ${blocked}`}
              style={{ background: 'color-mix(in srgb, var(--good) 16%, transparent)', color: 'var(--good)' }}
            >
              <Shield width={10} height={10} />
              {blocked}
            </span>
          )}

          {loading && (
            <span
              className="absolute bottom-0 left-0 h-[2px] rounded-pill"
              style={{
                width: `${Math.round((tab?.progress ?? 0) * 100)}%`,
                background: 'var(--accent)',
                transition: 'width var(--t-slow) var(--ease-out)'
              }}
            />
          )}
        </button>
      </div>

      {/* actions */}
      <div className="no-drag flex items-center gap-0.5 pr-1">
        <Tooltip label={bookmarked ? 'Убрать из закладок · Ctrl+D' : 'В закладки · Ctrl+D'}>
          <button
            className="icon-btn"
            disabled={!canBookmark}
            onClick={() => window.browser.toggleBookmark()}
            style={bookmarked ? { color: 'var(--accent)' } : undefined}
          >
            {bookmarked ? <StarFilled /> : <Star />}
          </button>
        </Tooltip>

        {updateBadge && (
          <Tooltip label={updateLabel}>
            <button
              className="icon-btn relative"
              onClick={() => onToggleView('update')}
              style={
                view === 'update'
                  ? { background: 'var(--surface-hover)', color: 'var(--text)' }
                  : { color: 'var(--accent)' }
              }
            >
              <UpdateArrow />
              {/* The hidden download keeps reporting from here: the ring is
                  the same progress the card was showing. */}
              {downloadingUpdate && (
                <svg className="absolute inset-0" width={30} height={30} viewBox="0 0 30 30">
                  <circle
                    cx="15"
                    cy="15"
                    r="12.5"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 12.5}
                    strokeDashoffset={2 * Math.PI * 12.5 * (1 - (update?.percent ?? 0) / 100)}
                    transform="rotate(-90 15 15)"
                    style={{ transition: 'stroke-dashoffset var(--t-slow) var(--ease-out)' }}
                  />
                </svg>
              )}
              {update?.stage === 'ready' && (
                <span
                  className="animate-pulse-soft absolute right-1 top-1 h-[6px] w-[6px] rounded-pill"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          </Tooltip>
        )}

        <Tooltip label="Загрузки · Ctrl+J">
          <button
            className="icon-btn relative"
            onClick={() => onToggleView('downloads')}
            style={view === 'downloads' ? { background: 'var(--surface-hover)', color: 'var(--text)' } : undefined}
          >
            <Download />
            {downloadCount > 0 && (
              <span
                className="animate-pulse-soft absolute right-1 top-1 h-[6px] w-[6px] rounded-pill"
                style={{ background: 'var(--accent)' }}
              />
            )}
          </button>
        </Tooltip>

        <Tooltip label="Новая вкладка · Ctrl+T">
          <button className="icon-btn" onClick={() => window.browser.newTab()}>
            <Plus />
          </button>
        </Tooltip>

        {profile && (
          <Tooltip label={`Профиль: ${profile.name}`}>
            <button
              className="icon-btn"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onToggleView('profiles')}
              style={view === 'profiles' ? { background: 'var(--surface-hover)' } : undefined}
            >
              <Avatar avatar={profile.avatar} color={profile.color} size={22} />
            </button>
          </Tooltip>
        )}

        <Tooltip label="Настройки · Ctrl+,">
          <button
            className="icon-btn"
            onClick={() => onToggleView('settings')}
            style={view === 'settings' ? { background: 'var(--surface-hover)', color: 'var(--text)' } : undefined}
          >
            <Gear />
          </button>
        </Tooltip>

        <Tooltip label="Меню">
          <button
            className={cx('icon-btn')}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onToggleView('menu')}
            style={view === 'menu' ? { background: 'var(--surface-hover)', color: 'var(--text)' } : undefined}
          >
            <More />
          </button>
        </Tooltip>
      </div>

      <WindowControls maximized={maximized} />
    </div>
  )
}
