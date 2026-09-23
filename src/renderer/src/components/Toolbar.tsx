import type {
  ExtensionAction,
  Profile,
  Settings,
  TabState,
  UpdateState,
  WebAppCandidate
} from '../../../shared/types'
import { currentLanguage, t } from '../i18n'
import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Cross,
  Grid,
  Home,
  Incognito,
  Lock,
  More,
  Reload,
  Scroll,
  Search,
  Star,
  StarFilled,
  Check,
  Copy,
  Translate,
  Unlock,
  Install,
  UpdateArrow
} from './Icons'
import WindowControls from './WindowControls'
import { Avatar, Tooltip, cx } from './ui'
import { MediaButton } from './MediaPanel'

interface Props {
  tab: TabState | undefined
  settings: Settings
  profile: Profile | null
  maximized: boolean
  bookmarked: boolean
  downloadCount: number
  /** null until something about a new version is worth a button */
  update: UpdateState | null
  /** set when this window is one installed app rather than the browser */
  appMode: { id: string; name: string; themeColor: string } | null
  /** set when this page says it is an app that can be installed */
  appCandidate: WebAppCandidate | null
  onInstallApp: () => void
  /** this window keeps nothing; the badge says so */
  incognito: boolean
  view: string
  onOpenAddress: () => void
  onToggleView: (view: 'settings' | 'downloads' | 'menu' | 'profiles' | 'update') => void
}

/**
 * The extensions' own buttons.
 *
 * Chromium draws these; this browser draws its own toolbar, so it draws these
 * too — the picture from the extension's manifest, and its page underneath
 * when it is pressed. An extension without a button of its own is not here,
 * which is the same rule Chrome uses.
 */
function ExtensionButtons() {
  const [actions, setActions] = useState<ExtensionAction[]>([])

  useEffect(() => {
    void window.browser.extensionActions().then(setActions)
    return window.browser.onExtensions(setActions)
  }, [])

  if (actions.length === 0) return null

  return (
    <>
      {actions.map((action) => (
        <Tooltip key={action.id} label={action.title || action.name}>
          <button
            className="icon-btn shrink-0"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              void window.browser.openExtension(action.id, Math.round(box.left + box.width / 2))
            }}
          >
            {action.icon ? (
              <img
                src={action.icon}
                alt=""
                width={16}
                height={16}
                draggable={false}
                style={{ borderRadius: 3 }}
              />
            ) : (
              <Grid width={15} height={15} />
            )}
          </button>
        </Tooltip>
      ))}
    </>
  )
}

/**
 * The offer to translate, and the sign that it was taken.
 *
 * Translating a page takes a second or two, and a button that does nothing
 * visible in that second reads as a button that did not work. So it lights up
 * the moment it is pressed, keeps its colour while the page is translated, and
 * says so in its own background rather than only in its outline.
 */
function TranslateButton({ translated }: { translated: boolean }) {
  const [working, setWorking] = useState(false)

  // Whatever happened, it has happened by the time the page says so.
  useEffect(() => setWorking(false), [translated])

  const press = () => {
    setWorking(true)
    // A page that refuses to translate must not leave the button spinning.
    window.setTimeout(() => setWorking(false), 6000)
    void window.browser.translatePage()
  }

  const lit = translated || working

  return (
    <span
      role="button"
      tabIndex={0}
      title={translated ? t('Показать оригинал') : t('Перевести страницу')}
      aria-label={translated ? t('Показать оригинал') : t('Перевести страницу')}
      aria-pressed={translated}
      className={cx(
        'no-drag animate-pop flex shrink-0 items-center rounded-[7px] p-1',
        working && 'animate-pulse-soft'
      )}
      style={{
        color: lit ? 'var(--accent)' : undefined,
        background: lit ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : undefined,
        transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
      }}
      onClick={(event) => {
        event.stopPropagation()
        press()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.stopPropagation()
        event.preventDefault()
        press()
      }}
    >
      <Translate width={14} height={14} />
    </span>
  )
}

export default function Toolbar({
  tab,
  settings,
  profile,
  maximized,
  bookmarked,
  downloadCount,
  update,
  appMode,
  appCandidate,
  onInstallApp,
  incognito,
  view,
  onOpenAddress,
  onToggleView
}: Props) {
  const loading = tab?.loading ?? false
  const secure = tab?.secure ?? true

  /**
   * Адрес целиком — по щелчку прямо в строке.
   *
   * Строка показывает сайт и путь: так её читают. Но иногда адрес нужен весь
   * — скопировать, или посмотреть, куда на самом деле ведёт ссылка, за
   * которой пришли. Раньше за этим шли в поле ввода, где адрес уже можно
   * задеть и испортить; здесь он просто разворачивается на месте.
   */
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState(false)
  // Другая страница — другой адрес: развёрнутым остаётся только тот, который
  // развернули.
  useEffect(() => {
    setFull(false)
    setCopied(false)
  }, [tab?.url])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timer)
  }, [copied])

  // Проценты и знаки из адреса читать невозможно, а кириллица в пути — самое
  // частое, что в них прячется. Копируется при этом исходный адрес: он
  // вставляется куда угодно без сюрпризов.
  let fullUrl = tab?.url ?? ''
  try {
    fullUrl = decodeURI(fullUrl)
  } catch {
    /* адрес с битой последовательностью — показываем как есть */
  }
  const hasContent = tab?.hasContent ?? false
  const canBookmark = Boolean(tab?.url && /^https?:/i.test(tab.url))
  const zoomed = (tab?.zoom ?? 0) !== settings.defaultZoom
  // A page in a language that is not the browser's own. Pages that keep their
  // language to themselves say nothing here, and are left alone.
  const mine = currentLanguage().split('-')[0]
  const foreign = Boolean(tab?.language && tab.language !== mine)
  const height = settings.compact ? 40 : 44

  const downloadingUpdate = update?.stage === 'downloading'
  const updateBadge =
    update?.stage === 'available' ||
    downloadingUpdate ||
    update?.stage === 'installing' ||
    update?.stage === 'ready'
  const updateLabel = downloadingUpdate
    ? t('Загружаем обновление — {p}%', { p: update?.percent ?? 0 })
    : update?.stage === 'installing'
      ? t('Устанавливаем обновление')
      : update?.stage === 'ready'
        ? t('Обновление готово к установке')
        : t('Доступно обновление')

  return (
    <div className="drag flex items-center gap-1 pl-2 pr-0" style={{ height }}>
      <div className="no-drag flex items-center gap-0.5">
        <Tooltip label={t('Назад · Alt+←')}>
          <button className="icon-btn" disabled={!tab?.canGoBack} onClick={() => window.browser.back()}>
            <ArrowLeft />
          </button>
        </Tooltip>
        <Tooltip label={t('Вперёд · Alt+→')}>
          <button className="icon-btn" disabled={!tab?.canGoForward} onClick={() => window.browser.forward()}>
            <ArrowRight />
          </button>
        </Tooltip>
        <Tooltip label={loading ? t('Остановить · Esc') : t('Обновить · Ctrl+R')}>
          <button
            className="icon-btn"
            disabled={!hasContent}
            onClick={() => (loading ? window.browser.stop() : window.browser.reload())}
          >
            {loading ? <Cross /> : <Reload />}
          </button>
        </Tooltip>
        {!appMode && (
          <Tooltip label={t('Стартовая страница')}>
            <button className="icon-btn" onClick={() => window.browser.home()}>
              <Home />
            </button>
          </Tooltip>
        )}
      </div>

      {/* address field — in an app window it is a nameplate, not a place to
          type: there is one page here and it is the app. */}
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <button
          disabled={appMode !== null}
          onClick={appMode ? undefined : onOpenAddress}
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
            <span
              role="button"
              tabIndex={0}
              title={t('Настройки сайта')}
              className="no-drag -ml-1 flex shrink-0 items-center rounded-[7px] px-1 py-1 hover:bg-[var(--line)]"
              onClick={(event) => {
                event.stopPropagation()
                void window.browser.setOverlay('site')
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                event.preventDefault()
                void window.browser.setOverlay('site')
              }}
            >
              {secure ? (
                <Lock width={13} height={13} style={{ color: 'var(--good)' }} />
              ) : (
                <Unlock width={13} height={13} style={{ color: 'var(--warn)' }} />
              )}
            </span>
          ) : (
            <Search width={14} height={14} className="shrink-0 text-faint" />
          )}

          <span className="min-w-0 flex-1 truncate text-sm">
            {appMode ? (
              <>
                <span className="text-ink">{appMode.name}</span>
                <span className="text-faint"> · {tab?.origin}</span>
              </>
            ) : tab?.displayUrl ? (
              /* Щелчок по самому адресу разворачивает его; щелчок мимо —
                 по-прежнему открывает поле ввода, как и вся строка. */
              <span
                role="button"
                tabIndex={0}
                key={full ? 'full' : 'short'}
                title={full ? tab.url : t('Показать адрес целиком')}
                className="animate-pop no-drag rounded-[5px]"
                onClick={(event) => {
                  if (full) return
                  event.stopPropagation()
                  setFull(true)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.stopPropagation()
                  event.preventDefault()
                  setFull(true)
                }}
              >
                {full ? (
                  <span className="text-ink">{fullUrl}</span>
                ) : (
                  <>
                    <span className="text-ink">{tab.origin}</span>
                    <span className="text-faint">{tab.displayUrl.slice(tab.origin.length)}</span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-faint">{t('Поиск или адрес сайта')}</span>
            )}
          </span>

          {/* Развёрнутый адрес чаще всего разворачивают, чтобы скопировать.
              Выделять его мышью в строке, которая сама кнопка, — мучение. */}
          {full && tab?.url && (
            <span
              role="button"
              tabIndex={0}
              title={t('Копировать адрес')}
              aria-label={t('Копировать адрес')}
              className="animate-pop no-drag flex shrink-0 items-center rounded-[7px] p-1 hover:bg-[var(--line)]"
              style={{ color: copied ? 'var(--good)' : undefined }}
              onClick={(event) => {
                event.stopPropagation()
                void navigator.clipboard.writeText(tab.url)
                setCopied(true)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                event.preventDefault()
                void navigator.clipboard.writeText(tab.url)
                setCopied(true)
              }}
            >
              {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
            </span>
          )}

          {zoomed && (
            <span className="shrink-0 rounded-pill px-1.5 py-[1px] text-2xs font-semibold text-dim" style={{ background: 'var(--field)' }}>
              {Math.round(1.2 ** (tab?.zoom ?? 0) * 100)}%
            </span>
          )}

          {/* Everything you can do to the page itself: translate it, resize it,
              search it, keep it. The menu further right is about the browser,
              and mixing the two made one list nobody could scan. */}
          {canBookmark && (
            <span
              role="button"
              tabIndex={0}
              title={t('Действия со страницей')}
              aria-label={t('Действия со страницей')}
              className="no-drag flex shrink-0 items-center rounded-[7px] p-1 hover:bg-[var(--line)]"
              onClick={(event) => {
                event.stopPropagation()
                const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                void window.browser.setOverlay(`page-menu:${Math.round(box.right)}`)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                event.preventDefault()
                const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                void window.browser.setOverlay(`page-menu:${Math.round(box.right)}`)
              }}
            >
              <More width={14} height={14} />
            </span>
          )}

          {/* A page written in a language that is not yours offers itself for
              translation where you are already looking, rather than waiting to
              be found in a menu. It stays while the translation is up, because
              that is also how you get the original back. */}
          {canBookmark && (foreign || tab?.translated) && (
            <TranslateButton translated={tab?.translated === true} />
          )}

          {/* And while a page is being read rather than looked at, the way out
              of that is in the same place — to the right of the translation,
              when both are there. */}
          {canBookmark && tab?.reading && (
            <span
              role="button"
              tabIndex={0}
              title={t('Выйти из режима чтения')}
              aria-label={t('Выйти из режима чтения')}
              className="no-drag animate-pop flex shrink-0 items-center rounded-[7px] p-1 hover:bg-[var(--line)]"
              style={{ color: 'var(--accent)' }}
              onClick={(event) => {
                event.stopPropagation()
                void window.browser.toggleReader()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                event.preventDefault()
                void window.browser.toggleReader()
              }}
            >
              <Scroll width={14} height={14} />
            </span>
          )}

          {/* What was blocked here is counted under the lock on the left, with
              the rest of what this site is allowed to do. This end of the field
              is for the one thing a reader does to a page they like. */}
          {canBookmark && (
            <span
              role="button"
              tabIndex={0}
              title={bookmarked ? t('Убрать из закладок · Ctrl+D') : t('В закладки · Ctrl+D')}
              className="no-drag flex shrink-0 items-center rounded-[7px] p-1 hover:bg-[var(--line)]"
              style={bookmarked ? { color: 'var(--accent)' } : undefined}
              onClick={(event) => {
                event.stopPropagation()
                void window.browser.toggleBookmark()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                event.preventDefault()
                void window.browser.toggleBookmark()
              }}
            >
              {bookmarked ? <StarFilled width={14} height={14} /> : <Star width={14} height={14} />}
            </span>
          )}

          {/* A site that says it is an app. Chromium's own install prompt is
              part of Chrome and not of the engine, so this is the offer. */}
          {appCandidate && (
            <span
              role="button"
              tabIndex={0}
              title={t('Установить {name} как приложение', { name: appCandidate.name })}
              className="no-drag animate-pop flex shrink-0 items-center rounded-[7px] p-1 hover:bg-[var(--line)]"
              style={{ color: 'var(--accent)' }}
              onClick={(event) => {
                event.stopPropagation()
                onInstallApp()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                event.preventDefault()
                onInstallApp()
              }}
            >
              <Install width={14} height={14} />
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
      {incognito && (
        <Tooltip label={t('Приватное окно · история, кэш и cookie исчезнут вместе с ним')}>
          <span
            className="mr-1 flex h-[26px] shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-2xs font-semibold"
            style={{ background: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--accent)' }}
          >
            <Incognito width={14} height={14} />
            {t('Приватно')}
          </span>
        </Tooltip>
      )}

      {/* Only what has nowhere else to live: a new version worth telling
          someone about, the profile, and the menu. Bookmarks, downloads, a new
          tab and the settings all sit in that menu already, and the row of
          duplicates was just noise beside the address. */}
      <div className="no-drag flex items-center gap-0.5 pr-1">
        {/* Only while something is playing, and then it is the answer to the
            question everyone asks a browser with thirty tabs open. */}
        <ExtensionButtons />

        <MediaButton onOpen={(x) => void window.browser.setOverlay(`media:${x}`)} />

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

        {!appMode && profile && (
          <Tooltip label={t('Профиль: {name}', { name: profile.name })}>
            <button
              className="icon-btn halo-host"
              data-open={view === 'profiles' ? 'true' : undefined}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onToggleView('profiles')}
            >
              <Avatar avatar={profile.avatar} crop={profile.crop} color={profile.color} size={22} halo />
            </button>
          </Tooltip>
        )}

        <Tooltip label={downloadCount > 0 ? t('Меню · идёт загрузка') : t('Меню')}>
          <button
            className={cx('icon-btn relative')}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onToggleView('menu')}
            style={view === 'menu' ? { background: 'var(--surface-hover)', color: 'var(--text)' } : undefined}
          >
            <More />
            {/* Downloads moved into this menu, so the sign that one is running
                moved with them — otherwise it would happen out of sight. */}
            {downloadCount > 0 && (
              <span
                className="animate-pulse-soft absolute right-1 top-1 h-[6px] w-[6px] rounded-pill"
                style={{ background: 'var(--accent)' }}
              />
            )}
          </button>
        </Tooltip>
      </div>

      <WindowControls maximized={maximized} />
    </div>
  )
}
