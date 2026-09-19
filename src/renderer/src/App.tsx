import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBrowser } from './state/useBrowser'
import { useLook } from './look'
import { AddressWarning } from './components/Shield'
import type { Warning } from '../../shared/phishing'

/** The host of an origin, the way the site rules are keyed. */
const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www./, '')
  } catch {
    return ''
  }
}
import Wallpaper from './components/Wallpaper'
import Toolbar from './components/Toolbar'
import BookmarksBar from './components/BookmarksBar'
import Toasts from './components/Toasts'
import DownloadPlate from './components/DownloadPlate'
import CrashCard from './components/CrashCard'
import Welcome from './components/Welcome'
import { applyLanguage, onLanguageChange } from './i18n'
import { FindBar, PermissionBar } from './components/Bars'
import { TabRail, TabStrip } from './components/Tabs'
import StartPage from './pages/StartPage'
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'))
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'))
const PasswordsPage = lazy(() => import('./pages/PasswordsPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
import ErrorPage from './pages/ErrorPage'
import type { UpdateState } from '../../shared/types'
import SplitDivider from './components/SplitDivider'

type View = 'page' | 'settings' | 'history' | 'downloads' | 'bookmarks' | 'passwords' | 'tasks'
type Overlay = 'menu' | 'profiles' | 'update' | null

export default function App() {
  const state = useBrowser()
  const {
    tabs, groups, spaces, appCandidate, active, settings, engines, engine, profiles, profile, bookmarks, bookmarked,
    downloads, activeDownloads, closed, stats, win, permission,
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
  // The vault question, asked once when the browser starts and only when the
  // setting says the vault should stay shut until it is answered.
  /*
   * Opening the vault is asked for where it is needed — under the login box
   * whose password is in it, drawn by the overlay — and not once more at
   * every start of the browser, where the answer buys nothing until a
   * password is actually wanted.
   */
  // Language: load the dictionary the settings name, and re-render the whole
  // tree when it lands or changes. t() reads the active dictionary at render
  // time, so one state bump repaints every label.
  const [, setLangVersion] = useState(0)
  useEffect(() => onLanguageChange(() => setLangVersion((v) => v + 1)), [])
  useEffect(() => {
    if (settings) void applyLanguage(settings.language)
  }, [settings?.language])
  const [revealed, setRevealed] = useState(false)
  /** what is wrong with the address in front of us, and whether it was waved away */
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [dismissed, setDismissed] = useState(false)

  /*
   * Asked once per address.
   *
   * The check is local and cheap, but it reads the history, so it is not
   * something to do on every repaint. The address changing is exactly when the
   * answer can change, and it is also when a warning waved away stops applying.
   */
  useEffect(() => {
    setDismissed(false)
    if (!active?.url || !/^https?:/i.test(active.url)) {
      setWarnings([])
      return
    }
    void window.browser.addressWarnings().then(setWarnings)
  }, [active?.url])

  useEffect(() => {
    void window.browser.updateState().then(setUpdate)
    return window.browser.onUpdate(setUpdate)
  }, [])

  const contentRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ------------------------------------------------------------ appearance */
  // A window can wear the colour of the profile it belongs to, which is the
  // fastest way to tell two of them apart on one screen.
  useLook(settings, settings?.accentFromProfile ? profile?.color : undefined)

  /* ------------------------------------------------------------- UI state */
  const hasError = Boolean(active?.error)
  const showStart = view === 'page' && !hasError && (active ? !active.hasContent : true)
  const showPage = view === 'page' && !showStart && !hasError
  // Menus and the palette are drawn by the separate overlay view stacked above
  // the page, so they no longer force the page to be hidden.
  // Nothing has been chosen yet, so nothing has been written: the flag is
  // false on a fresh profile and stays false until the flow finishes or is
  // skipped, which is the only thing that turns it on.
  const welcome = settings != null && !settings.onboarded
  const overlayVisible = !showPage || welcome
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

  // An installed app is one page in a window of its own. A tab strip with a
  // single tab in it, and a rail beside it, would be furniture.
  const appWindow = win.app !== null
  const vertical = !appWindow && settings.tabPosition !== 'top'
  const pinnedBookmarks = bookmarks.filter((item) => item.pinned)

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Between two pages shown side by side, and nowhere else. It is drawn
          here, at the root, because the gap it lives in is measured from the
          window and not from anything inside this layout. */}
      <SplitDivider />

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
                appMode={win.app}
                appCandidate={appCandidate}
                onInstallApp={() => void window.browser.setOverlay('install-app')}
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

            {!vertical && !appWindow && (
              <TabStrip tabs={tabs} groups={groups} spaces={spaces} settings={settings} />
            )}
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
            {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
          </header>
        )}

        <div className="flex min-h-0 flex-1">
          {vertical && settings.tabPosition === 'left' && !chromeHidden && (
            <div className="animate-slide-right">
              <TabRail tabs={tabs} groups={groups} spaces={spaces} settings={settings} side="left" />
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
                  // Hidden is display:none, and an animation on something that
                  // was display:none starts over when it is shown — so this is
                  // an entrance every time the tab is come back to, without
                  // remounting the page and losing where it was scrolled to.
                  className="animate-fade-up absolute inset-0"
                  hidden={tab.id !== active?.id}
                >
                  {/* Each of these arrives as its own chunk the first time it
                      is opened; the fallback is a beat of empty page, which is
                      what the tab looks like anyway before it paints. */}
                  <Suspense fallback={null}>
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
                  {tab.internal === 'tasks' && <TasksPage />}
                  </Suspense>
                </div>
              ))}
          </div>

          {vertical && settings.tabPosition === 'right' && !chromeHidden && (
            <div className="animate-slide-left">
              <TabRail tabs={tabs} groups={groups} spaces={spaces} settings={settings} side="right" />
            </div>
          )}
        </div>
      </div>

      {/* What is wrong with this address, worked out on this machine from the
          address itself and from where this profile goes. It sits in the
          corner with the other notices; the page is read around it. */}
      {warnings.length > 0 && !dismissed && (
        <AddressWarning
          warnings={warnings}
          onLeave={() => {
            setWarnings([])
            void window.browser.back()
          }}
          onTrust={() => {
            setWarnings([])
            if (active?.origin) void window.browser.setSite(hostOf(active.origin), { trusted: true }, false)
          }}
          onClose={() => setDismissed(true)}
        />
      )}

      {/* Only ever shown when the last run did not finish, and only once. */}
      <CrashCard />

      <DownloadPlate items={downloads} onOpenList={() => toggleView('downloads')} />

      <Toasts items={toasts} />


      {welcome && (
        <Welcome
          settings={settings}
          engines={engines}
          profile={profile}
          maximized={win.maximized}
          onPatch={patch}
          onDone={() => patch({ onboarded: true })}
        />
      )}
    </div>
  )
}
