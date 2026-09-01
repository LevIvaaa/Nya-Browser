import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBrowser } from './state/useBrowser'
import Wallpaper from './components/Wallpaper'
import Toolbar from './components/Toolbar'
import BookmarksBar from './components/BookmarksBar'
import Toasts from './components/Toasts'
import { AutofillBar, FindBar, PermissionBar, SavePasswordBar } from './components/Bars'
import { TabRail, TabStrip } from './components/Tabs'
import StartPage from './pages/StartPage'
import SettingsPage from './pages/SettingsPage'
import HistoryPage from './pages/HistoryPage'
import DownloadsPage from './pages/DownloadsPage'
import BookmarksPage from './pages/BookmarksPage'
import PasswordsPage from './pages/PasswordsPage'
import ErrorPage from './pages/ErrorPage'
import type { UpdateState } from '../../shared/types'

type View = 'page' | 'settings' | 'history' | 'downloads' | 'bookmarks' | 'passwords'
type Overlay = 'menu' | 'profiles' | 'update' | null

export default function App() {
  const state = useBrowser()
  const {
    tabs, active, settings, engines, engine, profiles, profile, bookmarks, bookmarked,
    downloads, activeDownloads, closed, stats, win, permission, autofill, savePassword,
    edge, toasts, patch, refreshBookmarks, setPermission, setAutofill, setSavePassword
  } = state

  // Which page is on screen is a property of the active tab, not of the
  // window: opening a new tab next to the settings leaves the settings where
  // they were, and coming back finds them still open.
  const view: View = (active?.internal ?? 'page') as View
  const [overlay, setOverlay] = useState<Overlay>(null)
  // Only for the toolbar button; the card itself lives in the overlay.
  const [update, setUpdate] = useState<UpdateState | null>(null)
  // Which part of the settings page to open at, when asked for one.
  const [section, setSection] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    void window.browser.updateState().then(setUpdate)
    return window.browser.onUpdate(setUpdate)
  }, [])

  const contentRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ------------------------------------------------------------ appearance */
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)

    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--radius', `${settings.radius}px`)
    root.style.setProperty('--speed', String(settings.reduceMotion ? 0.001 : settings.animationSpeed))
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
    root.style.setProperty('--panel', String(settings.glass / 100))
    // Blurring what cannot be seen through costs frames for nothing.
    root.dataset.glass = settings.glass >= 100 ? 'off' : 'on'

    return () => media.removeEventListener('change', apply)
  }, [settings])

  /* ------------------------------------------------------------- UI state */
  const hasError = Boolean(active?.error)
  const showStart = view === 'page' && !hasError && (active ? !active.hasContent : true)
  const showPage = view === 'page' && !showStart && !hasError
  // Menus and the palette are drawn by the separate overlay view stacked above
  // the page, so they no longer force the page to be hidden.
  const overlayVisible = !showPage
  const chromeHidden = Boolean(
    settings?.tabAutoHide && !revealed && !findOpen && showPage && !overlay
  )

  /* ------------------------------------------------ report content bounds */
  const report = useCallback(() => {
    const element = contentRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    void window.browser.setLayout({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: !overlayVisible
    })
  }, [overlayVisible])

  useLayoutEffect(() => {
    report()
    const element = contentRef.current
    const observer = new ResizeObserver(report)
    if (element) observer.observe(element)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [report])

  useLayoutEffect(report, [
    chromeHidden,
    view,
    findOpen,
    Boolean(permission),
    Boolean(savePassword),
    Boolean(autofill),
    settings?.tabPosition,
    settings?.railWidth,
    settings?.compact,
    bookmarks.length,
    report
  ])

  /* ------------------------------------------------ close menus on tab swap */
  const activeId = active?.id
  useEffect(() => {
    void window.browser.setOverlay(null)
    setFindOpen(false)
  }, [activeId])

  /* ------------------------------------------------------------ shortcuts */
  const openPalette = useCallback(() => {
    void window.browser.setOverlay('palette')
  }, [])

  // Asking for a page the active tab already shows closes it, the way a
  // toolbar button that is already lit should.
  const toggleView = useCallback(
    (next: View) => {
      void window.browser.setOverlay(null)
      if (next === 'page') return
      if (active?.internal === next) void window.browser.closeTab(active.id)
      else void window.browser.openChromePage(next)
    },
    [active?.internal, active?.id]
  )

  // The overlay owns menu state; mirror it so toolbar buttons stay highlighted.
  useEffect(() => window.browser.onOverlay((mode) => setOverlay(mode === 'menu' || mode === 'profiles' ? mode : null)), [])

  // A page can be asked to open at a particular section, as in
  // "settings#profiles"; the tab itself is opened by the main process.
  useEffect(
    () =>
      window.browser.onPageSection((page) => {
        const [, part] = page.split('#')
        setSection(part ?? '')
      }),
    []
  )

  useEffect(() => {
    return window.browser.onShortcut((action) => {
      // A page asking for a window arrives as "new-window:<url>".
      if (action.startsWith('new-window:')) {
        void window.browser.newWindow().then(() => window.browser.newTab(action.slice(11)))
        return
      }
      switch (action) {
        case 'focus-address':
          openPalette()
          break
        case 'new-window':
          void window.browser.newWindow()
          break
        case 'new-private-window':
          void window.browser.newWindow(true)
          break
        case 'settings':
          toggleView('settings')
          break
        case 'history':
          toggleView('history')
          break
        case 'downloads':
          toggleView('downloads')
          break
        case 'bookmarks':
          toggleView('bookmarks')
          break
        case 'profiles':
          void window.browser.setOverlay(overlay === 'profiles' ? null : 'profiles')
          break
        case 'clear-data':
          void window.browser.clearBrowsingData()
          break
        case 'toggle-tabs':
          if (settings) patch({ tabAutoHide: !settings.tabAutoHide })
          break
        case 'find':
          if (active?.hasContent) setFindOpen(true)
          break
      }
    })
  }, [openPalette, toggleView, settings, patch, active?.hasContent])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (overlay) void window.browser.setOverlay(null)
      else if (findOpen) setFindOpen(false)
      else if (view !== 'page' && active) void window.browser.closeTab(active.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay, findOpen, view, active])

  /* ------------------------------------------------------------ auto-hide */
  const reveal = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setRevealed(true)
  }, [])
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setRevealed(false), 420)
  }, [])

  useEffect(() => {
    if (edge) reveal()
    else scheduleHide()
  }, [edge, reveal, scheduleHide])

  useEffect(() => {
    if (!settings?.tabAutoHide) setRevealed(false)
  }, [settings?.tabAutoHide])

  if (!settings) {
    return <div className="h-full w-full" style={{ background: 'var(--bg)' }} />
  }

  const vertical = settings.tabPosition !== 'top'
  const pinnedBookmarks = bookmarks.filter((item) => item.pinned)

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      {overlayVisible && (
        <Wallpaper
          background={settings.background}
          accent={settings.accent}
          reduceMotion={settings.reduceMotion}
          browsing={showPage}
        />
      )}

      <div
        className="relative z-20 flex min-h-0 flex-1 flex-col"
        onMouseLeave={settings.tabAutoHide ? scheduleHide : undefined}
        onMouseEnter={settings.tabAutoHide ? reveal : undefined}
      >
        {!chromeHidden && (
          <header className="glass animate-slide-down relative z-30 shrink-0 overflow-visible" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="relative">
              <Toolbar
                tab={active}
                settings={settings}
                profile={profile}
                maximized={win.maximized}
                bookmarked={bookmarked}
                downloadCount={activeDownloads}
                incognito={win.incognito}
                update={update}
                view={overlay ?? view}
                onOpenAddress={openPalette}
                onToggleView={(target) => {
                  if (target === 'menu' || target === 'profiles' || target === 'update') {
                    void window.browser.setOverlay(overlay === target ? null : target)
                  } else {
                    toggleView(target as View)
                  }
                }}
              />
            </div>

            {!vertical && <TabStrip tabs={tabs} settings={settings} />}
            {pinnedBookmarks.length > 0 && (
              <BookmarksBar items={pinnedBookmarks} onManage={() => toggleView('bookmarks')} />
            )}
            {permission && (
              <PermissionBar
                request={permission}
                onAnswer={(allow) => {
                  void window.browser.answerPermission(permission.id, allow)
                  setPermission(null)
                }}
              />
            )}
            {savePassword && (
              <SavePasswordBar
                offer={savePassword}
                onAnswer={(save) => {
                  void window.browser.vaultConfirmSave(save)
                  setSavePassword(null)
                }}
              />
            )}
            {autofill && (
              <AutofillBar
                offer={autofill}
                onClose={() => setAutofill(null)}
                onUnlock={() => {
                  setAutofill(null)
                  void window.browser.openChromePage('passwords')
                }}
              />
            )}
            {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
          </header>
        )}

        <div className="flex min-h-0 flex-1">
          {vertical && settings.tabPosition === 'left' && !chromeHidden && (
            <div className="animate-slide-right">
              <TabRail tabs={tabs} settings={settings} side="left" />
            </div>
          )}

          <div ref={contentRef} className="relative min-w-0 flex-1 overflow-hidden">
            {showStart && (
              <StartPage
                settings={settings}
                engine={engine}
                stats={stats}
                closed={closed}
                profileName={profile?.name ?? ''}
                incognito={win.incognito}
                onOpenAddress={openPalette}
                onPatch={patch}
              />
            )}
            {hasError && active?.error && view === 'page' && <ErrorPage error={active.error} />}

            {/* One mounted page per internal tab, hidden rather than unmounted:
                coming back to the settings finds the same section and the same
                scroll position, which is the point of them being tabs. */}
            {tabs
              .filter((tab) => tab.internal)
              .map((tab) => (
                <div
                  key={tab.id}
                  className="absolute inset-0"
                  hidden={tab.id !== active?.id}
                >
                  {tab.internal === 'settings' && (
                    <SettingsPage
                      settings={settings}
                      engines={engines}
                      stats={stats}
                      profiles={profiles}
                      onPatch={patch}
                      onReset={() => void window.browser.resetSettings()}
                      onClose={() => void window.browser.closeTab(tab.id)}
                      onOpenPasswords={() => void window.browser.openChromePage('passwords')}
                      section={section}
                    />
                  )}
                  {tab.internal === 'history' && <HistoryPage />}
                  {tab.internal === 'downloads' && <DownloadsPage items={downloads} />}
                  {tab.internal === 'bookmarks' && (
                    <BookmarksPage items={bookmarks} onRefresh={refreshBookmarks} />
                  )}
                  {tab.internal === 'passwords' && <PasswordsPage />}
                </div>
              ))}
          </div>

          {vertical && settings.tabPosition === 'right' && !chromeHidden && (
            <div className="animate-slide-left">
              <TabRail tabs={tabs} settings={settings} side="right" />
            </div>
          )}
        </div>
      </div>

      <Toasts items={toasts} />
    </div>
  )
}
