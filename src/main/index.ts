import { t } from './i18n'
import { app, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, session, shell, type MenuItemConstructorOptions } from 'electron'
import { basename, join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { execFile, execFileSync } from 'child_process'
import { BrowserWindow, setDetach } from './browser'
import { DOH_TEMPLATES, settings } from './settings'
import { desk } from './desk'
import { mergePdfs } from './pdfmerge'
import { habits } from './habits'
import { rates } from './rates'
import { history } from './history'
import { bookmarks } from './bookmarks'
import { profiles, AVATAR_CHOICES, AVATAR_PICTURE_EXTENSIONS, COLOR_CHOICES } from './profiles'
import { vault } from './vault'
import { downloads } from './downloads'
import { usage } from './usage'
import { drafts } from './drafts'
import { pageText } from './pagetext'
import { playback } from './playback'
import { applyBackup, makeBackup, readBackup } from './backup'
import { initLog, log } from './log'
import { readerToPdf } from './readerpdf'
import { safeStart } from './startup'
import {
  checkNetwork,
  clearFailures,
  closeHealth,
  dismissCrash,
  lastCrash,
  openHealth,
  pageFailures
} from './health'
import { flushAll, installExitHooks } from './store'
import { registerProtocols, registerSchemes } from './protocol'
import { helloAvailable, helloVerify } from './hello'
import { apps, appIdFromArgv, appRemoveFromArgv } from './apps'
import { sites } from './sites'
import { blockedDays, BLOCKLIST_SIZE, blockedLog, clearBrowsingData, hardenApp, hardenSession, resetStats, stats } from './security'
import { detectSources, importBookmarks, importHistory, importPasswordsCsv } from './import'
import { translateBatch } from './translate'
import { filterRefresh, engine, filterStatus, hideCss, loadFilters } from './filters'
import {
  addExtension,
  listExtensions,
  removeExtension,
  revealExtension
} from './extensions'
import { favicons } from './favicons'
import { currentWeather, guessPlace, searchPlaces } from './weather'
import { applyMainLanguage } from './i18n'
import { isKnownLanguage } from '../shared/i18n'
import {
  check as checkUpdates,
  download as downloadUpdate,
  initUpdates,
  installNow,
  onUpdateState,
  updateState
} from './updates'
import { initWidevine, needsRestart, widevineState } from './widevine'
import {
  defaultBrowserState,
  registerAsBrowser,
  requestDefaultBrowser,
  unregisterAsBrowser,
  urlFromArgv
} from './integration'
import { SEARCH_ENGINES } from '../shared/search'
import type {
  Todo,
  Note, AppInfo, PrintOptions, Settings, SiteRules, ThemeMode } from '../shared/types'

/* ------------------------------------------------------------------------- */
/* Startup switches — read before app.whenReady() and fixed for the session.  */
/* ------------------------------------------------------------------------- */
const LANGUAGE_HANDOFF_KEY = 'HKCU\\Software\\Nya Browser'

/**
 * The registry value the installer and the browser hand the language through.
 * `raw` is what is there verbatim (null when nothing is); `picked` is what it
 * means for the setting: a known code, '' for the explicit "system", null when
 * there is nothing usable.
 */
function readLanguageHandoff(): { raw: string | null; picked: string | null } {
  try {
    const out = execFileSync('reg', ['query', LANGUAGE_HANDOFF_KEY, '/v', 'language'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const match = /language\s+REG_SZ\s+(\S+)/.exec(out)
    if (!match) return { raw: null, picked: null }
    const raw = match[1]
    if (raw === 'system') return { raw, picked: '' }
    return { raw, picked: isKnownLanguage(raw) ? raw : null }
  } catch {
    return { raw: null, picked: null }
  }
}

/**
 * The theme the installer was left in. It is written when the browser is
 * installed and read here, so the first window opens looking like the
 * installer the person was just looking at rather than in the other theme.
 */
function readThemeHandoff(): ThemeMode | null {
  try {
    const out = execFileSync('reg', ['query', LANGUAGE_HANDOFF_KEY, '/v', 'theme'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const match = /theme\s+REG_SZ\s+(\S+)/.exec(out)
    const raw = match?.[1]
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
  } catch {
    return null
  }
}

/** And back the other way, so the uninstaller matches the browser. */
function writeThemeHandoff(theme: ThemeMode) {
  if (process.platform !== 'win32') return
  execFile(
    'reg',
    ['add', LANGUAGE_HANDOFF_KEY, '/v', 'theme', '/t', 'REG_SZ', '/d', theme, '/f'],
    () => {
      /* the registry is a courtesy to the installer, never a failure */
    }
  )
}

/** Mirrors the browser's language for the installer; '' travels as "system". */
function writeLanguageHandoff(code: string) {
  if (process.platform !== 'win32') return
  execFile(
    'reg',
    ['add', LANGUAGE_HANDOFF_KEY, '/v', 'language', '/t', 'REG_SZ', '/d', code || 'system', '/f'],
    () => {
      /* the registry is a courtesy to the installer, never a failure */
    }
  )
}

/**
 * Whether the browser starts itself at login and waits out of sight.
 *
 * The flag is what tells the next run to stay hidden; the setting is only ever
 * read here, at start and whenever it is changed. Linux is left out: there the
 * autostart convention is a .desktop file the package owns, and writing one
 * from inside the running app is not ours to do.
 */
function applyQuickStart() {
  if (process.platform === 'linux') return
  try {
    app.setLoginItemSettings({ openAtLogin: settings.get().fastStart, args: ['--quick-start'] })
  } catch (error) {
    log('quick start', String(error))
  }
}

function applyStartupSwitches() {
  const s = settings.get()

  if (safeStart) {
    // One switch, and the rest of the file reads it rather than the setting.
    app.disableHardwareAcceleration()
  } else if (!s.hardwareAcceleration) {
    app.disableHardwareAcceleration()
  } else {
    app.commandLine.appendSwitch('enable-gpu-rasterization')
    app.commandLine.appendSwitch('enable-zero-copy')
    app.commandLine.appendSwitch('ignore-gpu-blocklist')
    app.commandLine.appendSwitch('enable-accelerated-2d-canvas')
    app.commandLine.appendSwitch('enable-accelerated-video-decode')
  }

  // navigator.language and Chromium's own UI strings follow this; it is read
  // once at startup, so a language change fully lands after a restart (the
  // Accept-Language header switches immediately, without one).
  if (s.language) app.commandLine.appendSwitch('lang', s.language)

  // Dev builds expose CDP so tests can drive the browser; never in releases.
  if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9222')

  app.commandLine.appendSwitch('disk-cache-size', String(s.cacheSizeMb * 1024 * 1024))

  const enable = [
    'ParallelDownloading',
    'BackForwardCache',
    'BackForwardCacheMemoryControls',
    'PrefetchPrivacyChanges',
    'ReduceAcceptLanguage',
    'CanvasOopRasterization',
    'ThrottleUnimportantFrameTimers',
    'EstablishGpuChannelAsync',
    'UseSurfaceLayerForVideo'
  ]
  if (s.smoothScrolling) enable.push('SmoothScrolling')
  app.commandLine.appendSwitch('enable-features', enable.join(','))

  app.commandLine.appendSwitch(
    'disable-features',
    [
      'InterestCohort', // no Topics/FLoC participation
      'PrivacySandboxSettings4',
      'AttributionReportingCrossAppWeb',
      'FledgeBiddingAndAuctionServer',
      'TrustTokens',
      'MediaRouter',
      'HardwareMediaKeyHandling',
      'AutofillServerCommunication', // никакие данные форм не уходят в Google
      'OptimizationHints',
      'CalculateNativeWinOcclusion' // keeps the UI painting when partly covered
    ].join(',')
  )
  app.commandLine.appendSwitch('force-color-profile', 'srgb')

  const webrtc =
    s.webrtcPolicy === 'proxy_only'
      ? 'disable_non_proxied_udp'
      : s.webrtcPolicy === 'default'
        ? 'default'
        : 'default_public_interface_only'
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', webrtc)
}

// Every open window. IPC is registered once and answers whichever window the
// message came from, so a second window is not a special case anywhere.
const windows = new Set<BrowserWindow>()
let browser: BrowserWindow | null = null

/**
   * A tab leaving one window for a new one of its own.
   *
   * The page is opened again in the new window rather than carried across as a
   * live view: see takeTab. The window is placed a little down and to the
   * right of the one it came from, the way every window manager does it.
   */
function detachTab(from: BrowserWindow, id: number) {
  const taken = from.takeTab(id)
  if (!taken) return
  const win = openWindow(from.incognito)
  win.chrome.webContents.once('did-finish-load', () => win.adoptTab(taken))
}

setDetach((from, id) => detachTab(from, id))

/** Opens another window, wired the same way as the first. */
function openWindow(incognito = false, appId?: string | null): BrowserWindow {
  const win = new BrowserWindow(incognito, (appId && apps.get(appId)) || null)
  // An app window is the app: it opens what the shortcut pointed at, once its
  // chrome is there to hold it, and nothing else.
  if (win.appMode) {
    const startUrl = win.appMode.startUrl
    win.chrome.webContents.once('did-finish-load', () => win.newTab(startUrl))
  }
  windows.add(win)
  win.win.on('closed', () => {
    windows.delete(win)
    if (browser === win) browser = windows.values().next().value ?? null
  })
  win.win.on('focus', () => {
    browser = win
  })
  browser = win
  return win
}

/* ------------------------------------------------------------------------- */
/* Single instance                                                            */
/* ------------------------------------------------------------------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('Nya Browser')
  registerSchemes()

  // Every renderer starts sandboxed unless it explicitly opts out.
  app.enableSandbox()

  profiles.load()
  settings.load(profiles.dir())
  // The installer and the browser share one registry value for the language.
  // The installer writes what its pill picked; the browser applies anything
  // that differs from its own setting — a reinstall with a new pick has to
  // land even when settings.json already exists — and then mirrors its
  // language back, so the next installer opens its pill on the language the
  // browser really speaks and the uninstaller can talk in it too.
  if (process.platform === 'win32') {
    const handoff = readLanguageHandoff()
    if (handoff.picked !== null && handoff.picked !== settings.get().language) {
      settings.patch({ language: handoff.picked })
    }
    const mirror = settings.get().language || 'system'
    if (handoff.raw !== mirror) writeLanguageHandoff(mirror)

    // The same trade for the theme: take what the installer left, then put
    // back what the browser is actually set to. Without the second half a
    // theme chosen in the settings would be overruled at every start by the
    // one picked during the install.
    const theme = readThemeHandoff()
    if (theme !== null && theme !== settings.get().theme) settings.patch({ theme })
    const themeNow = settings.get().theme
    if (theme !== themeNow) writeThemeHandoff(themeNow)
  }
  applyStartupSwitches()
  installExitHooks()

  /** The launcher's own menu entries, and the flags they pass. */
  const wantsWindow = (argv: readonly string[]) =>
    argv.includes('--new-window') ? 'normal' : argv.includes('--new-private-window') ? 'private' : null

  app.on('second-instance', (_event, argv) => {
    // Windows asking us to uninstall one of the installed apps while the
    // browser happens to be running.
    const removeId = appRemoveFromArgv(argv)
    if (removeId) {
      for (const win of [...windows]) if (win.appMode?.id === removeId) win.win.close()
      apps.remove(removeId)
      return
    }
    // A shortcut for an installed app: raise the window it already has, or
    // open one. It is a separate window, not a tab in this one.
    const appId = appIdFromArgv(argv)
    if (appId && apps.has(appId)) {
      const open = [...windows].find((win) => win.appMode?.id === appId)
      if (open) {
        if (open.win.isMinimized()) open.win.restore()
        open.win.focus()
      } else {
        openWindow(false, appId)
      }
      return
    }
    // "New window" from the launcher means a window, not another tab in the
    // one that happens to be open.
    const wanted = wantsWindow(argv)
    if (wanted) {
      openWindow(wanted === 'private')
      return
    }
    if (!browser) return
    // A window quick start built at login has never been shown; this is the
    // moment it was waiting for.
    browser.reveal()
    if (browser.win.isMinimized()) browser.win.restore()
    browser.win.focus()
    const url = urlFromArgv(argv)
    if (url) browser.newTab(url)
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.nya.browser')

    initLog()
    // Before anything else that could itself go wrong: whether the last run
    // ended properly is a question only the file left behind can answer.
    openHealth(app.getVersion())
    if (safeStart) log('safe start: extensions, GPU, filters and session restore are off')
    // Installed apps belong to the machine, not to a profile: a shortcut on the
    // desktop cannot know which profile was last used, and should not care.
    apps.load(app.getPath('userData'))

    // Uninstalling from Windows' own list of installed apps runs us with the
    // app's id and nothing else to do. No window opens.
    const removeApp = appRemoveFromArgv(process.argv)
    if (removeApp) {
      apps.remove(removeApp)
      flushAll()
      app.quit()
      return
    }
    // Deliberately not awaited. The CDM is a ~10 MB download from Google's
    // component server on first use, and waiting for it would leave the window
    // unpainted for as long as that takes. The cost is that a DRM page opened in
    // the first seconds may need a reload, which the settings page mentions.
    void initWidevine()
    registerProtocols()
    applyDnsProvider()
    hardenApp(app)
    hardenSession(session.defaultSession)
    nativeTheme.themeSource = settings.get().theme
    // A bin nobody empties is a place passwords live forever. Anything that has
    // waited out its thirty days goes now, before the first window opens.
    vault.emptyBin()
    // Awaited on purpose, and cheap: loadFilters resolves as soon as the
    // engine is armed from the on-disk cache and refreshes stale lists in the
    // background. This is what makes the first request of the first tab
    // already go through the full blocker instead of slipping past it.
    if (settings.get().filterLists && !safeStart) await loadFilters()

    // Pages ask for their anti-flicker CSS synchronously at document-start, so
    // the answer must never block: whatever the engine knows right now, or
    // nothing. Registered before the first window exists.
    // Whether the blocker is on at all, for the one page that needs to do its
    // own blocking from the inside.
    ipcMain.on('autoplay:blocked', (event) => {
      event.returnValue = settings.get().blockAutoplay === true
    })
    ipcMain.on('ads:on', (event) => {
      try {
        event.returnValue = settings.get().blockAds === true
      } catch {
        event.returnValue = false
      }
    })
    ipcMain.on('cosmetic:boot', (event, host: unknown) => {
      try {
        const s = settings.get()
        if (!s.filterLists || !s.cosmeticFiltering || !engine.ready) {
          event.returnValue = ''
          return
        }
        const hostname = String(host ?? '').slice(0, 253).toLowerCase()
        event.returnValue = hostname ? hideCss(engine.cosmeticSelectors(hostname, [], [])) : ''
      } catch {
        event.returnValue = ''
      }
    })

    // Editing keys a page left unhandled (see preload/content.ts). Only the
    // six editing commands, and only on the sender itself.
    ipcMain.on('edit:command', (event, command: unknown) => {
      const wc = event.sender
      switch (command) {
        case 'copy': return wc.copy()
        case 'cut': return wc.cut()
        case 'paste': return wc.paste()
        case 'selectAll': return wc.selectAll()
        case 'undo': return wc.undo()
        case 'redo': return wc.redo()
      }
    })

    await applyMainLanguage(settings.get().language)

    const launchApp = appIdFromArgv(process.argv)
    const first = openWindow(wantsWindow(process.argv) === 'private', launchApp)
    registerIpc()
    buildMenu(first)

    first.chrome.webContents.once('did-finish-load', () => {
      const b = first
      log('chrome ready, profile', profiles.active.name)
      b.sendWindowState()
      b.sendProfiles()
      b.applySettings()
      // An app window opens its app and nothing else — no restored session, no
      // link from the command line, which was meant for the browser. The tab
      // itself is opened by openWindow.
      if (b.appMode) return
      // A cold start from "open link in Nya Browser" must land on that link
      // rather than on whatever the restored session had open.
      const launchUrl = urlFromArgv(process.argv)
      // Safe start opens one empty tab: restoring forty pages is itself one of
      // the things that could be making the browser unusable, and the session
      // is left on disk untouched so the next ordinary start brings it back.
      const restored = !safeStart && b.restoreSession()
      if (launchUrl) b.newTab(launchUrl)
      else if (!restored) b.newTab()
    })

    // Re-assert the shell registration on every launch: a portable build the
    // user moved would otherwise leave a dead association behind.
    void registerAsBrowser()

    initUpdates()

    // The card shows itself at the two moments that need an answer: when a
    // version is found (download it?) and when it has arrived (install it?).
    // Once each per version, so a check every six hours cannot become a
    // recurring interruption.
    let announced = ''
    onUpdateState((state) => {
      browser?.sendUpdateState(state)
      const moment = `${state.available}:${state.stage}`
      if ((state.stage === 'available' || state.stage === 'ready') && announced !== moment) {
        announced = moment
        browser?.setOverlayMode('update')
      }
    })

    applyQuickStart()

    app.on('activate', () => {
      browser?.reveal()
      if (windows.size === 0) {
        const win = openWindow()
        buildMenu(win)
        win.chrome.webContents.once('did-finish-load', () => win.newTab())
      }
    })
  })
}

/* ------------------------------------------------------------------------- */
/* IPC                                                                        */
/* ------------------------------------------------------------------------- */
let ipcRegistered = false

function registerIpc() {
  if (ipcRegistered) return
  ipcRegistered = true

  // The window that sent the message, falling back to the focused one: menu
  // clicks and shortcuts both arrive from a window's own views.
  const current = (event?: Electron.IpcMainInvokeEvent) => {
    if (event) {
      for (const win of windows) if (win.owns(event.sender)) return win
    }
    return browser ?? windows.values().next().value!
  }

  /**
   * A 16×16 transparent square. Chromium's startDrag refuses an empty image,
   * and a file whose type has no icon registered would otherwise not be
   * draggable at all.
   */
  const BLANK_ICON =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC'

  const str = (value: unknown, max = 4096) => (typeof value === 'string' ? value.slice(0, max) : '')
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const flag = (value: unknown) => value === true

  /* ---- tabs ---- */
  ipcMain.handle('tab:new', (event, url?: unknown, background?: unknown) =>
    current(event).newTab(str(url), flag(background))
  )
  ipcMain.handle('tab:close', (event, id: unknown) => current(event).closeTab(num(id)))
  ipcMain.handle('tab:close-others', (event, id: unknown) => current(event).closeOthers(num(id)))
  ipcMain.handle('tab:close-right', (event, id: unknown) => current(event).closeToRight(num(id)))
  ipcMain.handle('tab:switch', (event, id: unknown) => current(event).switchTab(num(id)))
  ipcMain.handle('tab:move', (event, id: unknown, index: unknown) => current(event).moveTab(num(id), num(index)))
  ipcMain.handle('tab:duplicate', (event, id: unknown) => current(event).duplicateTab(num(id)))
  ipcMain.handle('tab:mute', (event, id: unknown) => current(event).toggleMute(num(id)))
  ipcMain.handle('tab:sleep', (event, id: unknown) => current(event).sleepTab(num(id)))
  ipcMain.handle('tab:reload', (event, id: unknown) => current(event).reloadTab(num(id)))
  ipcMain.handle('state:snapshot', (event) => current(event).snapshot())
  ipcMain.handle('tab:menu', (event, id: unknown) => current(event).showTabMenu(num(id)))
  ipcMain.handle('tab:pin', (event, id: unknown, pinned?: unknown) =>
    current(event).pinTab(num(id), pinned === undefined ? undefined : flag(pinned))
  )
  /* ---- big groups: a whole strip of tabs at a time ---- */
  ipcMain.handle('space:new', (event, name?: unknown) =>
    current(event).newSpace(name === undefined ? undefined : str(name, 40))
  )
  ipcMain.handle('space:switch', (event, id: unknown) => current(event).switchSpace(num(id)))
  ipcMain.handle('space:edit', (event, id: unknown, patch: unknown) => {
    const data = (patch ?? {}) as { name?: unknown; colour?: unknown; pinned?: unknown }
    current(event).editSpace(num(id), {
      name: data.name === undefined ? undefined : str(data.name, 40),
      colour: data.colour === undefined ? undefined : str(data.colour, 9),
      pinned: data.pinned === undefined ? undefined : flag(data.pinned)
    })
  })
  ipcMain.handle('space:move', (event, id: unknown, toIndex: unknown) =>
    current(event).moveSpace(num(id), num(toIndex))
  )
  ipcMain.handle('space:close', (event, id: unknown) => current(event).closeSpace(num(id)))

  ipcMain.handle('tab:group-new', (event, id: unknown, name?: unknown) =>
    current(event).createGroup(num(id), name === undefined ? undefined : str(name, 40))
  )
  ipcMain.handle('tab:group-add', (event, id: unknown, groupId: unknown) =>
    current(event).addToGroup(num(id), num(groupId))
  )
  ipcMain.handle('tab:group-remove', (event, id: unknown) => current(event).removeFromGroup(num(id)))
  ipcMain.handle('group:move', (event, id: unknown, to: unknown) =>
    current(event).moveGroup(num(id), num(to))
  )
  ipcMain.handle('group:pin', (event, id: unknown) => current(event).pinGroup(num(id)))
  ipcMain.handle('group:drop', (event, tabId: unknown, groupId: unknown) =>
    current(event).dropOnGroup(num(tabId), num(groupId))
  )
  ipcMain.handle('group:rename', (event, groupId: unknown, name: unknown) =>
    current(event).renameGroup(num(groupId), str(name, 40))
  )
  ipcMain.handle('group:colour', (event, groupId: unknown, colour: unknown) =>
    current(event).setGroupColour(num(groupId), str(colour, 16))
  )
  ipcMain.handle('group:toggle', (event, groupId: unknown, collapsed?: unknown) =>
    current(event).toggleGroup(num(groupId), collapsed === undefined ? undefined : flag(collapsed))
  )
  ipcMain.handle('group:ungroup', (event, groupId: unknown) => current(event).ungroup(num(groupId)))
  ipcMain.handle('group:close', (event, groupId: unknown) => current(event).closeGroup(num(groupId)))
  ipcMain.handle('group:menu', (event, groupId: unknown) => current(event).showGroupMenu(num(groupId)))
  ipcMain.handle('apps:candidate', (event) => current(event).installable())
  ipcMain.handle('apps:install', (event) => current(event).installApp())
  ipcMain.handle('apps:list', () => apps.list())
  ipcMain.handle('apps:remove', (event, id: unknown) => {
    apps.remove(str(id, 40))
    return apps.list()
  })
  ipcMain.handle('group:icon', (event, groupId: unknown, icon: unknown) => {
    current(event).setGroupIcon(num(groupId), str(icon, 16))
  })
  ipcMain.handle('apps:open', (event, id: unknown) => {
    const wanted = str(id, 40)
    if (!apps.has(wanted)) return false
    const open = [...windows].find((win) => win.appMode?.id === wanted)
    if (open) open.win.focus()
    else openWindow(false, wanted)
    return true
  })
  ipcMain.handle('site:info', (event) => current(event).siteInfo())
  ipcMain.handle('site:set', (event, host: unknown, patch: unknown, reload?: unknown) =>
    current(event).setSiteRules(str(host, 260), (patch ?? {}) as Partial<SiteRules>, flag(reload))
  )
  ipcMain.handle('site:clear', (event, host: unknown) => current(event).clearSiteRules(str(host, 260)))
  ipcMain.handle('site:list', () => sites.all())
  ipcMain.handle('tab:reopen', (event) => current(event).reopenClosed())
  ipcMain.handle('tab:closed-list', (event) => current(event).recentlyClosed())
  ipcMain.handle('tab:navigate', (event, url: unknown, id?: unknown) =>
    current(event).navigate(str(url), id === undefined ? undefined : num(id))
  )

  /* ---- navigation ---- */
  ipcMain.handle('nav:back', (event) => current(event).goBack())
  ipcMain.handle('nav:forward', (event) => current(event).goForward())
  ipcMain.handle('nav:reload', (event, hard?: unknown) => current(event).reload(flag(hard)))
  ipcMain.handle('nav:stop', (event) => current(event).stop())
  ipcMain.handle('nav:home', (event) => current(event).goHome())
  ipcMain.handle('nav:zoom', (event, delta: unknown) => current(event).setZoom(delta === 'reset' ? 'reset' : num(delta)))
  ipcMain.handle('nav:http-fallback', (event) => current(event).continueOverHttp())
  ipcMain.handle('nav:proceed-certificate', (event) => current(event).proceedPastCertificate())
  ipcMain.handle('nav:printers', (event) => current(event).printers())
  /** Whatever the print sheet sent, back in a shape the browser can trust. */
  const printOptions = (raw: unknown): PrintOptions => {
    const input = (raw ?? {}) as Partial<PrintOptions>
    const papers = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'] as const
    const margins = ['default', 'none', 'narrow'] as const
    return {
      landscape: flag(input.landscape),
      paper: papers.includes(input.paper as (typeof papers)[number])
        ? (input.paper as PrintOptions['paper'])
        : 'A4',
      margins: margins.includes(input.margins as (typeof margins)[number])
        ? (input.margins as PrintOptions['margins'])
        : 'default',
      scale: Math.max(25, Math.min(200, num(input.scale) || 100)),
      background: flag(input.background),
      headers: flag(input.headers),
      pages: str(input.pages, 100),
      copies: Math.max(1, Math.min(50, num(input.copies) || 1)),
      colour: flag(input.colour),
      duplex: flag(input.duplex)
    }
  }
  ipcMain.handle('nav:print-to', (event, name: unknown, options: unknown) =>
    current(event).printTo(str(name, 200), printOptions(options))
  )
  ipcMain.handle('nav:print-preview', (event, options: unknown) =>
    current(event).printPreview(printOptions(options))
  )
  ipcMain.handle('nav:print-pdf', (event, options: unknown) =>
    current(event).printPdf(printOptions(options))
  )
  ipcMain.handle('nav:zoom-percent', (event, percent: unknown) =>
    current(event).setZoomPercent(num(percent))
  )
  ipcMain.handle('nav:save-page', (event) => current(event).savePage())
  ipcMain.handle('ui:action', (event, action: unknown) => current(event).requestUiAction(str(action, 32)))
  ipcMain.handle('nav:reader', (event) => current(event).toggleReader())
  ipcMain.on('page:language', (event, code: unknown) => {
    current(event).handleLanguage(event.sender.id, str(code, 12).toLowerCase())
  })
  ipcMain.on('media:state', (event, payload: unknown) => {
    const data = payload as Record<string, unknown> | null
    // Every frame of a page may have something to say; they are kept apart,
    // because the film and the advert on top of it are not the same track.
    const frame = event.senderFrame?.routingId ?? 0
    current(event).handleMediaState(
      event.sender.id,
      frame,
      data
        ? {
            title: str(data.title, 200),
            artist: str(data.artist, 200),
            art: /^https?:|^data:image\//.test(String(data.art ?? '')) ? String(data.art).slice(0, 2000) : '',
            playing: data.playing === true,
            muted: data.muted === true,
            volume: Math.max(0, Math.min(1, num(data.volume))),
            position: num(data.position),
            duration: num(data.duration),
            video: data.video === true,
            seekable: data.seekable === true,
            rate: Math.max(0, Math.min(4, num(data.rate))),
            next: data.next === true,
            prev: data.prev === true,
            pip: data.pip === true
          }
        : null
    )
  })
  ipcMain.handle('media:list', (event) => current(event).playingNow())
  ipcMain.handle('tab:split', (event, id: unknown) =>
    current(event).splitWith(id === null || id === undefined ? null : num(id))
  )
  ipcMain.handle('ext:actions', (event) => current(event).extensionActions())
  ipcMain.handle('ext:open', (event, id: unknown, x: unknown) =>
    current(event).openExtension(str(id, 64), num(x))
  )
  ipcMain.handle('ext:close', (event) => current(event).closeExtension())
  /* What an extension's own page is allowed to ask about this window. */
  ipcMain.handle('ext:tabs', (event) => current(event).extensionTabs())
  ipcMain.handle('ext:tab-create', (event, url: unknown, active: unknown) =>
    current(event).extensionTabCreate(str(url, 2000), flag(active))
  )
  ipcMain.handle('ext:tab-update', (event, id: unknown, patch: unknown) => {
    const data = (patch ?? {}) as { url?: unknown; active?: unknown; muted?: unknown }
    return current(event).extensionTabUpdate(num(id), {
      url: str(data.url, 2000),
      active: data.active === true,
      muted: typeof data.muted === 'boolean' ? data.muted : null
    })
  })
  ipcMain.handle('ext:tab-remove', (event, ids: unknown) =>
    current(event).extensionTabRemove((Array.isArray(ids) ? ids : []).map((one) => num(one)))
  )
  ipcMain.handle('ext:tab-reload', (event, id: unknown) => current(event).extensionTabReload(num(id)))
  ipcMain.handle('tab:split-state', (event) => current(event).splitNow())
  ipcMain.handle('tab:split-ratio', (event, ratio: unknown) =>
    current(event).setSplitRatio(num(ratio))
  )
  ipcMain.handle('media:command', (event, tabId: unknown, what: unknown, to: unknown) => {
    const allowed = [
      'toggle', 'play', 'pause', 'mute', 'seek', 'skip', 'volume', 'rate', 'next', 'prev', 'pip'
    ] as const
    const command = allowed.find((name) => name === what)
    if (!command) return false
    return current(event).mediaCommand(num(tabId), command, to === undefined ? undefined : num(to))
  })
  ipcMain.handle('shot:keep', (event, data: unknown) =>
    current(event).keepDataUrl(String(data ?? '').slice(0, 40_000_000))
  )
  ipcMain.handle('shot:copy', (event, data: unknown) =>
    current(event).copyDataUrl(String(data ?? '').slice(0, 40_000_000))
  )
  ipcMain.handle('shortcuts:capture', (event, on: unknown) => {
    current(event).setCapturingShortcut(on === true)
  })
  ipcMain.handle('nav:capture', (event, kind: unknown) =>
    current(event).capture(kind === 'full' ? 'full' : kind === 'area' ? 'area' : 'view')
  )
  ipcMain.on('capture:area-done', (event, payload: unknown) => {
    const r = (payload ?? {}) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    void current(event).captureArea(event.sender.id, {
      x: num(r.x),
      y: num(r.y),
      width: num(r.width),
      height: num(r.height)
    })
  })
  ipcMain.on('page:scroll', (event, y: unknown) => {
    const top = Number(y)
    if (Number.isFinite(top) && top >= 0) current(event).noteScroll(event.sender.id, top)
  })
  ipcMain.on('reader:state', (event, payload: unknown) => {
    const data = (payload ?? {}) as { on?: unknown; nothing?: unknown }
    current(event).handleReaderState(event.sender.id, {
      on: data.on === true,
      nothing: data.nothing === true
    })
  })
  ipcMain.handle('nav:translate', (event) => current(event).translatePage())

  /* ---- translation: the page asks, the main process fetches ---- */
  ipcMain.handle('translate:batch', async (_event, items: unknown, to: unknown) => {
    const list = Array.isArray(items) ? items : []
    // A page cannot make this into a firehose: a bounded number of bounded
    // strings, and nothing at all if it sends something else.
    const texts = list.slice(0, 200).map((item) => str(item, 5000))
    // 'auto' means "the language this browser is wearing": the page side asks
    // for one word without knowing what that is.
    const wanted = str(to, 8)
    const target = !wanted || wanted === 'auto' ? (settings.get().language || app.getLocale()).slice(0, 2) : wanted
    return translateBatch(texts, target)
  })
  ipcMain.on('translate:done', (event, payload: unknown) => {
    const data = (payload ?? {}) as { count?: unknown }
    const count = typeof data.count === 'number' ? data.count : 0
    current(event).translationDone(event.sender.id, count)
  })
  ipcMain.on('translate:progress', () => {})
  ipcMain.handle('nav:add-to-home', (event) => current(event).addToHome())

  /* ---- find ---- */
  ipcMain.handle('find:query', (event, text: unknown, forward?: unknown) =>
    current(event).find(str(text, 256), forward !== false)
  )
  ipcMain.handle('find:stop', (event) => current(event).stopFind())

  /* ---- window ---- */
  ipcMain.handle('win:minimize', (event) => current(event).win.minimize())
  ipcMain.handle('win:maximize', (event) => {
    const win = current(event).win
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('win:close', (event) => current(event).win.close())
  ipcMain.handle('win:fullscreen', (event) => {
    const win = current(event).win
    win.setFullScreen(!win.isFullScreen())
  })

  /* ---- overlay layer (menus, popovers, command palette) ---- */
  ipcMain.handle('ui:overlay', (event, mode: unknown) =>
    current(event).setOverlayMode(typeof mode === 'string' && mode ? mode.slice(0, 32) : null)
  )
  ipcMain.handle('ui:page', (event, page: unknown) => current(event).openChromePage(str(page, 32)))

  /* ---- chrome layout ---- */
  ipcMain.handle('ui:layout', (event, rect: unknown) => {
    const r = rect as { x: number; y: number; width: number; height: number; visible: boolean }
    if (!r || typeof r !== 'object') return
    current(event).setLayout({
      x: num(r.x),
      y: num(r.y),
      width: num(r.width),
      height: num(r.height),
      visible: r.visible !== false
    })
  })

  /**
   * Settings belong to the profile, not to the window that changed them. A
   * window told nothing keeps its old copy, and the next thing it saves —
   * a favourite added on its start page, say — writes that stale copy back
   * over the change.
   */
  const applyEverywhere = () => {
    for (const win of windows) win.applySettings()
  }
  // Settings are also changed from inside the browser — a tile added from the
  // page menu, a theme handed over by the installer — and those changes have
  // to reach the windows too. Without this a new tile turned up on the home
  // page only when something else happened to broadcast.
  settings.onChange(() => applyEverywhere())

  /** Same for the profile list: renaming one must not leave a window behind. */
  const profilesEverywhere = () => {
    for (const win of windows) win.sendProfiles()
  }

  /* ---- settings ---- */
  ipcMain.handle('settings:get', (event) => settings.get())
  ipcMain.handle('settings:engines', (event) => SEARCH_ENGINES)
  ipcMain.handle('settings:set', async (event, patch: unknown) => {
    const before = settings.get().language
    const dns = settings.get()
    const next = settings.patch((patch ?? {}) as Partial<Settings>)
    nativeTheme.themeSource = next.theme
    // The installer is told too, so the theme picked here is what the next
    // install screen and the uninstaller are drawn in — and so the value left
    // behind at install time cannot overrule this at the next start.
    writeThemeHandoff(next.theme)
    // The resolver is process-wide and takes effect on the next lookup, so a
    // change here is felt without a restart.
    if (
      next.dnsProvider !== dns.dnsProvider ||
      next.dohCustom !== dns.dohCustom ||
      next.dohFallback !== dns.dohFallback
    ) {
      applyDnsProvider()
    }
    if (next.language !== before) {
      // The main process speaks the new language from the next menu on, and
      // sites hear about it through Accept-Language right away.
      await applyMainLanguage(next.language)
      for (const win of windows) {
        win.applyAcceptLanguage()
        win.retitleInternalTabs()
      }
      const anyWin = [...windows][0]
      if (anyWin) buildMenu(anyWin)
      writeLanguageHandoff(next.language)
    }
    applyEverywhere()
    applyQuickStart()
    if (next.filterLists && !engine.ready) void loadFilters()
    return next
  })
  ipcMain.handle('settings:reset', (event) => {
    const next = settings.reset()
    nativeTheme.themeSource = next.theme
    writeThemeHandoff(next.theme)
    applyEverywhere()
    return next
  })
  ipcMain.handle('settings:export', (event) => JSON.stringify(settings.get(), null, 2))
  ipcMain.handle('settings:import', (event, json: unknown) => {
    try {
      const parsed = JSON.parse(str(json, 200_000))
      const next = settings.patch(parsed as Partial<Settings>)
      nativeTheme.themeSource = next.theme
      writeThemeHandoff(next.theme)
      applyEverywhere()
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('settings:wallpaper', (event) => current(event).importWallpaper())
  ipcMain.handle('settings:wallpapers', (event) => current(event).wallpapers())
  ipcMain.handle('settings:open-data', (event) => shell.openPath(app.getPath('userData')))
  ipcMain.handle('settings:download-dir', async (event) => {
    const dir = await downloads.chooseFolder()
    if (dir) {
      settings.patch({ downloadDir: dir })
      applyEverywhere()
    }
    return dir
  })

  /* ---- profiles ---- */
  ipcMain.handle('profiles:list', (event) => profiles.state)
  ipcMain.handle('profiles:choices', (event) => ({ avatars: AVATAR_CHOICES, colors: COLOR_CHOICES }))
  ipcMain.handle('profiles:create', (event, name: unknown) => {
    const profile = profiles.create(str(name, 40) || t('Профиль'))
    profilesEverywhere()
    return profile
  })
  ipcMain.handle('profiles:update', (event, id: unknown, patch: unknown) => {
    const state = profiles.update(str(id, 64), (patch ?? {}) as Record<string, string>)
    profilesEverywhere()
    return state
  })
  /* ---- weather ---- */
  ipcMain.handle('weather:search', (_event, query: unknown) => searchPlaces(str(query, 80)))
  ipcMain.handle('weather:guess', () => guessPlace())
  ipcMain.handle('weather:current', (_event, lat: unknown, lon: unknown) => {
    const latitude = Number(lat)
    const longitude = Number(lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return currentWeather(latitude, longitude)
  })

  ipcMain.handle('profiles:pick-avatar', async (event, id: unknown) => {
    const win = current(event)
    const picked = await dialog.showOpenDialog(win.win, {
      title: t('Выберите картинку для аватара'),
      properties: ['openFile'],
      filters: [{ name: t('Картинки'), extensions: AVATAR_PICTURE_EXTENSIONS }]
    })
    if (picked.canceled || !picked.filePaths[0]) return profiles.state
    let state = profiles.state
    try {
      state = profiles.setAvatarFile(str(id, 64), picked.filePaths[0])
    } catch (error) {
      log('profiles: could not use that picture', String(error))
    }
    profilesEverywhere()
    return state
  })
  ipcMain.handle('profiles:clear-avatar', (event, id: unknown, emoji: unknown) => {
    const state = profiles.clearAvatarFile(str(id, 64), str(emoji, 8) || '🐱')
    profilesEverywhere()
    return state
  })
  ipcMain.handle('profiles:remove', (event, id: unknown) => {
    const state = profiles.remove(str(id, 64))
    profilesEverywhere()
    return state
  })
  ipcMain.handle('profiles:switch', (event, id: unknown) => {
    current(event).switchProfile(str(id, 64))
    return profiles.state
  })

  /* ---- bookmarks ---- */
  ipcMain.handle('bookmarks:list', (event) => bookmarks.all())
  ipcMain.handle('bookmarks:folders', (event) => bookmarks.folders())
  ipcMain.handle('bookmarks:add', (event, input: unknown) => {
    const data = (input ?? {}) as { title?: string; url?: string; folder?: string; pinned?: boolean }
    const result = bookmarks.add({
      title: str(data.title, 300),
      url: str(data.url, 2048),
      folder: str(data.folder, 60),
      pinned: flag(data.pinned)
    })
    return result
  })
  ipcMain.handle('bookmarks:update', (event, id: unknown, patch: unknown) =>
    bookmarks.update(str(id, 64), (patch ?? {}) as Record<string, never>)
  )
  ipcMain.handle('bookmarks:remove', (event, id: unknown) => bookmarks.remove(str(id, 64)))
  ipcMain.handle('bookmarks:toggle-current', (event) => current(event).bookmarkCurrent())

  /* ---- history ---- */
  ipcMain.handle('history:all', (event) => history.all())

  /* ---- what is watching, what is known, what was guarded ---- */

  /** Who was watching the page in front of you, by the host they went to. */
  /** What the last refresh of the filter lists actually changed. */
  ipcMain.handle('filters:refresh-summary', () => filterRefresh())
  /*
   * What this page is guarded against, answered on the spot.
   *
   * Every other message in this browser is asynchronous, and this one cannot
   * be: the page asks at document start, before its own scripts have run, and
   * a canvas patched after the fingerprinting script has read it is a canvas
   * patched for nothing. A trusted site gets no guards, which is what trusting
   * it means.
   */
  /*
   * A table, saved as a spreadsheet.
   *
   * The page hands over the CSV it built from its own table; the browser asks
   * where to put it. Nothing about the page is trusted beyond the text: it is
   * written as UTF-8 with a byte-order mark, because without one Excel opens
   * a Russian table as mojibake and always has.
   */
  ipcMain.on('table:csv', async (event, payload: unknown) => {
    const one = (payload ?? {}) as { name?: unknown; csv?: unknown }
    const csv = String(one.csv ?? '').slice(0, 5_000_000)
    if (!csv) return
    const name = str(one.name, 80).replace(/[^w .-]+/g, '_').slice(0, 60) || 'table'
    const where = await dialog.showSaveDialog({
      title: t('Сохранить таблицу'),
      defaultPath: join(app.getPath('downloads'), `${name}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (where.canceled || !where.filePath) return
    try {
      writeFileSync(where.filePath, '﻿' + csv, 'utf8')
    } catch (error) {
      log('table:csv', String(error))
    }
  })

  /** A block of code, copied whole rather than selected by hand. */
  ipcMain.on('code:copy', (_event, text: unknown) => {
    const body = String(text ?? '').slice(0, 1_000_000)
    if (body) clipboard.writeText(body)
  })

  /**
   * A picture on the clipboard with its transparency intact.
   *
   * The page reads it into a canvas and hands back PNG bytes; Chromium's own
   * copy flattens the alpha onto white, which is why a logo pasted into a dark
   * document arrives in a white box.
   */
  ipcMain.on('image:copy-done', (_event, dataUrl: unknown) => {
    const url = String(dataUrl ?? '')
    if (!url.startsWith('data:image/png;base64,')) return
    const picture = nativeImage.createFromDataURL(url)
    if (!picture.isEmpty()) clipboard.writeImage(picture)
  })

  /* ---- printing and documents ---- */

  /** Only what is selected, as paper or as a file. */
  ipcMain.handle('nav:print-selection', (event, options: unknown, deviceName: unknown) =>
    current(event).printSelection((options ?? {}) as PrintOptions, str(deviceName, 120))
  )
  /** How this site was printed last time, if it was. */
  ipcMain.handle('print:profile', (event, host: unknown) => current(event).printProfile(str(host, 200)))
  ipcMain.handle('print:remember', (event, host: unknown, options: unknown) =>
    current(event).rememberPrintProfile(str(host, 200), (options ?? {}) as PrintOptions)
  )

  /**
   * Several documents into one.
   *
   * The files are chosen here rather than handed over by the page: a renderer
   * that could name paths to read would be a renderer that could read the
   * machine.
   */
  ipcMain.handle('pdf:merge', async (event) => {
    const picked = await dialog.showOpenDialog({
      title: t('Выберите документы для склейки'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (picked.canceled || picked.filePaths.length < 2) return null
    const made = await mergePdfs(null, picked.filePaths)
    if (made) current(event).newTab(pathToFileURL(made).href)
    return made
  })

  ipcMain.on('shield:ask', (event) => {
    const s = settings.get()
    let host = ''
    try {
      host = new URL(event.senderFrame?.url ?? '').hostname.replace(/^www./, '')
    } catch {
      /* about:blank and friends get the ordinary answer */
    }
    const trusted = host ? sites.get(host).trusted === true : false
    event.returnValue = {
      fingerprint: s.fingerprintGuard && !trusted,
      clipboard: s.clipboardGuard && !trusted
    }
  })

  /** A page that was refused the clipboard, worth one line in the log. */
  ipcMain.on('shield:clipboard-refused', (_event, host: unknown) =>
    log('clipboard refused for', str(host, 200))
  )
  /** A password box about to travel in the clear, worth one line too. */
  ipcMain.on('shield:insecure-form', (_event, url: unknown) =>
    log('insecure form on', str(url, 300))
  )

  ipcMain.handle('shield:watchers', (event) => current(event).watchers())
  /** What this site can work out about the machine. */
  ipcMain.handle('shield:knows', (event) => current(event).siteKnows())
  /** A month of protection, as something a person can act on. */
  ipcMain.handle('shield:report', (event) => current(event).protectionReport())
  /** What is wrong with the address in front of you, worked out on this machine. */
  ipcMain.handle('shield:warnings', (event) => current(event).addressWarnings())
  /** Opens one address in a jar of its own. */
  ipcMain.handle('shield:container', (event, url: unknown, container: unknown) =>
    current(event).openInContainer(str(url, 2048), str(container, 32))
  )
  /** Opens one address in another profile, in a window of its own. */
  /*
   * One link, opened as somebody else.
   *
   * A window per profile is what a profile is, so this switches profiles the
   * ordinary way and then opens the address in the window that comes back.
   * Nothing is shared across: different cookies, different logins, different
   * history — which is the entire point of doing it rather than opening a tab.
   */
  ipcMain.handle('shield:other-profile', (event, url: unknown, profileId: unknown) => {
    const where = str(url, 2048)
    const id = str(profileId, 64)
    if (!/^https?:/i.test(where) || !profiles.state.profiles.some((one) => one.id === id)) return false
    // The window does the switching, because it owns the session the tabs sit
    // in; once it has, the address opens in it.
    const win = current(event)
    win.switchProfile(id)
    win.newTab(where)
    profilesEverywhere()
    return true
  })

  /* ---- what the start page keeps of its own ---- */

  ipcMain.handle('desk:all', (event) => desk.all())
  ipcMain.handle('desk:note', (event, note: unknown) => desk.setNote((note ?? {}) as Note))
  ipcMain.handle('desk:note-remove', (event, id: unknown) => desk.removeNote(str(id, 24)))
  ipcMain.handle('desk:todo', (event, todo: unknown) => desk.setTodo((todo ?? {}) as Todo))
  ipcMain.handle('desk:todo-remove', (event, id: unknown) => desk.removeTodo(str(id, 24)))
  ipcMain.handle('desk:clear-done', (event) => desk.clearDone())

  /** What this profile usually opens around now — hosts and counts, no more. */
  ipcMain.handle('habits:now', (event) => habits.atThisHour())

  /** A fortnight of blocking, for the chart. */
  ipcMain.handle('security:days', (event) => blockedDays())

  /**
   * Exchange rates. Nothing goes out unless the widget is on: the check is
   * here rather than in the renderer, so a page that asks anyway gets nothing.
   */
  ipcMain.handle('rates:get', async (event) => {
    const page = settings.get().startPage
    if (!page.rates) return null
    return rates(page.ratesBase, page.ratesTo)
  })
  ipcMain.handle('history:recent', (event, limit?: unknown) => history.recent(num(limit) || 60))
  ipcMain.handle('history:remove', (event, url: unknown) => history.remove(str(url, 2048)))
  ipcMain.handle('history:clear', (event) => {
    history.clear()
    pageText.clear()
    // What you open at which hour is made of the same visits, so it goes too.
    habits.clear()
  })

  /* ---- passwords ---- */
  ipcMain.handle('vault:state', (event) => ({
    mode: vault.mode,
    locked: vault.locked,
    count: vault.count,
    osEncryption: vault.encryptionAvailable,
    hello: vault.helloEnabled
  }))
  ipcMain.handle('vault:hello-available', () => helloAvailable())
  /**
   * The prompt itself. Verifying and unlocking are one call: a renderer that
   * could ask for the key after someone else's verification would be no gate
   * at all.
   */
  ipcMain.handle('vault:hello-unlock', async (event) => {
    if (!vault.locked) return true
    if (!(await helloVerify(t('Разблокировать пароли Nya Browser')))) return false
    // Hello proves who is at the keyboard; what opens the vault after that is
    // whichever key this vault has. A master-password vault has none unless
    // Hello was turned on for it, and then there is nothing to open.
    const opened = vault.unlockWithHelloKey() || (vault.mode === 'os' && vault.unlock(''))
    if (opened) current(event).reofferAutofill()
    return opened
  })
  ipcMain.handle('vault:hello-enable', async (event, on: unknown) => {
    if (!flag(on)) {
      vault.disableHello()
      settings.patch({ passwordsHello: false })
      return true
    }
    // Turning it on needs the vault open — this puts aside what is already
    // there rather than going looking for it.
    if (vault.locked) return false
    if (!(await helloVerify(t('Включить вход по Windows Hello')))) return false
    if (!vault.enableHello()) return false
    settings.patch({ passwordsHello: true })
    return true
  })
  ipcMain.handle('vault:list', (event) => vault.list())
  ipcMain.handle('vault:unlock', (event, password: unknown) => {
    const opened = vault.unlock(str(password, 400))
    // The click that asked for this was on a login box: put the offer back.
    if (opened) current(event).reofferAutofill()
    return opened
  })
  ipcMain.handle('vault:dismiss-notice', (event) => current(event).dismissVaultNotice())
  ipcMain.handle('autofill:search', (event) => current(event).openOfferSearch())
  ipcMain.handle('autofill:close', (event) => current(event).closeOfferNow())
  ipcMain.handle('autofill:new-password', (event, password: unknown) =>
    current(event).fillNewPassword(str(password, 200))
  )
  ipcMain.handle('vault:lock', (event) => vault.lock())
  ipcMain.handle('vault:save', (event, input: unknown) => {
    const data = (input ?? {}) as { origin?: string; username?: string; password?: string; note?: string }
    return vault.save(str(data.origin, 200), str(data.username, 200), str(data.password, 400), str(data.note, 200))
  })
  ipcMain.handle('vault:reveal', (event, id: unknown) => vault.reveal(str(id, 64)))
  // Copying happens here rather than in the page. navigator.clipboard needs the
  // window to hold focus and the click's activation to still be alive, and
  // after a round trip to fetch the password neither is guaranteed — which is
  // why the copy button did nothing. This way the password is never handed to
  // the interface at all: it goes from the vault to the clipboard.
  ipcMain.handle('vault:copy', (event, id: unknown) => {
    const value = vault.reveal(str(id, 64))
    if (!value) return false
    clipboard.writeText(value)
    return true
  })
  /**
   * What is on the clipboard, for the one place that needs it: "paste and go".
   *
   * Reading the clipboard is a real capability, so it is reachable only from
   * the browser's own interface and only in answer to a press — never from a
   * page, which has its own permission for this and does not get it here.
   */
  ipcMain.handle('clipboard:read', () => clipboard.readText().slice(0, 4000))
  ipcMain.handle('clipboard:write', (event, text: unknown) => {
    clipboard.writeText(str(text, 4000))
    return true
  })
  ipcMain.handle('vault:remove', (event, id: unknown) => vault.remove(str(id, 64)))

  /* ---- cards and addresses, kept by the same key as the passwords ---- */
  ipcMain.handle('vault:binned', () => vault.binned())
  ipcMain.handle('vault:restore', (event, id: unknown) => vault.restore(str(id, 64)))
  ipcMain.handle('vault:empty-bin', () => vault.emptyBin(true))
  ipcMain.handle('vault:audit', () => vault.audit())
  ipcMain.handle('vault:stolen', () => vault.stolen())
  ipcMain.handle('vault:set-code', (event, id: unknown, secret: unknown) =>
    vault.setCode(str(id, 64), str(secret, 400))
  )
  ipcMain.handle('vault:code', (event, id: unknown) => vault.code(str(id, 64)))
  ipcMain.handle('vault:set-note', (event, id: unknown, text: unknown) =>
    vault.setNote(str(id, 64), str(text, 4000))
  )
  ipcMain.handle('vault:search', (event, query: unknown) => vault.search(str(query, 100)))
  /**
   * A file kept with an entry. It comes in through a dialog and goes out
   * through one — the vault never reads or writes a path the page chose.
   */
  ipcMain.handle('vault:attach', async (event, id: unknown) => {
    const where = await dialog.showOpenDialog({
      title: t('Вложение'),
      properties: ['openFile']
    })
    if (where.canceled || !where.filePaths[0]) return false
    try {
      const bytes = readFileSync(where.filePaths[0])
      if (bytes.byteLength > 512 * 1024) return false
      const name = basename(where.filePaths[0])
      return vault.attach(str(id, 64), name, `data:application/octet-stream;base64,${bytes.toString('base64')}`)
    } catch {
      return false
    }
  })
  ipcMain.handle('vault:save-attachment', async (event, id: unknown) => {
    const entry = vault.list().find((e) => e.id === str(id, 64))
    const data = vault.attachment(str(id, 64))
    if (!entry?.file || !data) return false
    const where = await dialog.showSaveDialog({
      title: t('Вложение'),
      defaultPath: join(app.getPath('downloads'), entry.file.name)
    })
    if (where.canceled || !where.filePath) return false
    try {
      writeFileSync(where.filePath, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'))
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('vault:detach', (event, id: unknown) => vault.detach(str(id, 64)))
  ipcMain.handle('vault:fill-code', (event, id: unknown) => current(event).fillCode(str(id, 64)))
  ipcMain.handle('vault:fill-found', (event, id: unknown) =>
    current(event).fillCredential(str(id, 64), true)
  )
  /**
   * The vault, as text, into a file the person picks — and back. This is the
   * one door out, so it is a dialog every time and never a silent write.
   */
  ipcMain.handle('vault:export-csv', async () => {
    const text = vault.exportCsv()
    if (text === null) return false
    const where = await dialog.showSaveDialog({
      title: t('Пароли в CSV'),
      defaultPath: join(app.getPath('downloads'), 'nya-passwords.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (where.canceled || !where.filePath) return false
    try {
      writeFileSync(where.filePath, text, 'utf8')
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('vault:import-csv', async () => {
    const picked = await dialog.showOpenDialog({
      title: t('Пароли в CSV'),
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return 0
    try {
      return vault.importCsv(readFileSync(picked.filePaths[0], 'utf8'))
    } catch {
      return 0
    }
  })
  ipcMain.handle('vault:cards', () => vault.cards())
  ipcMain.handle('vault:save-card', (event, input: unknown) => {
    const data = (input ?? {}) as {
      id?: string
      label?: string
      number?: string
      holder?: string
      month?: number
      year?: number
    }
    return vault.saveCard({
      id: data.id ? str(data.id, 64) : undefined,
      label: str(data.label, 60),
      number: str(data.number, 40),
      holder: str(data.holder, 100),
      month: num(data.month),
      year: num(data.year)
    })
  })
  // The number goes to the clipboard from here for the same reason a
  // password does: after a round trip the window no longer holds the click.
  ipcMain.handle('vault:copy-card', (event, id: unknown) => {
    const value = vault.revealCard(str(id, 64))
    if (!value) return false
    clipboard.writeText(value)
    return true
  })
  ipcMain.handle('vault:reveal-card', (event, id: unknown) => vault.revealCard(str(id, 64)))
  ipcMain.handle('vault:remove-card', (event, id: unknown) => vault.removeCard(str(id, 64)))

  ipcMain.handle('vault:addresses', () => vault.addresses())
  ipcMain.handle('vault:save-address', (event, input: unknown) => {
    const data = (input ?? {}) as { id?: string; label?: string; fields?: Record<string, unknown> }
    const f = data.fields ?? {}
    return vault.saveAddress({
      id: data.id ? str(data.id, 64) : undefined,
      label: str(data.label, 60),
      fields: {
        name: str(f.name, 120),
        phone: str(f.phone, 40),
        email: str(f.email, 120),
        country: str(f.country, 80),
        region: str(f.region, 80),
        city: str(f.city, 80),
        street: str(f.street, 200),
        house: str(f.house, 40),
        flat: str(f.flat, 40),
        postcode: str(f.postcode, 20)
      }
    })
  })
  ipcMain.handle('vault:reveal-address', (event, id: unknown) => vault.revealAddress(str(id, 64)))
  ipcMain.handle('vault:remove-address', (event, id: unknown) => vault.removeAddress(str(id, 64)))
  /**
   * A card into a page, with Windows Hello in front of it.
   *
   * This is the one fill that is asked about every single time. A password
   * filled by mistake can be changed; a card number is money, and the prompt
   * costs a second. Where Hello is not set up there is nothing to ask, and the
   * card fills as before.
   */
  ipcMain.handle('vault:fill-card', async (event, id: unknown) => {
    const window = current(event)
    if (settings.get().cardHello && (await helloAvailable())) {
      if (!(await helloVerify(t('Подставить данные карты')))) return false
    }
    return window.fillCard(str(id, 64))
  })
  ipcMain.handle('vault:fill-address', (event, id: unknown) =>
    current(event).fillAddress(str(id, 64))
  )
  ipcMain.handle('vault:generate', (event, length?: unknown) => vault.generate(num(length) || 20))
  ipcMain.handle('vault:set-master', (event, currentPass: unknown, next: unknown) =>
    vault.setMasterPassword(currentPass === null ? null : str(currentPass, 400), str(next, 400))
  )
  ipcMain.handle('vault:drop-master', (event, currentPass: unknown) =>
    vault.removeMasterPassword(str(currentPass, 400))
  )
  ipcMain.handle('vault:fill', (event, id: unknown) => current(event).fillCredential(str(id, 64)))
  ipcMain.handle(
    'vault:confirm-save',
    (event, save: unknown, username: unknown, password: unknown) =>
      current(event).confirmSavePassword(
        flag(save),
        username === undefined ? undefined : str(username, 200),
        password === undefined ? undefined : str(password, 400)
      )
  )
  ipcMain.handle('vault:cipher-sample', (event) => vault.cipherSample())

  /* ---- downloads ---- */
  /**
   * The bytes of a picture, for reading a QR code out of it. A page cannot
   * read a picture from another site — its canvas is tainted — and the browser
   * is not bound by that, so it fetches and hands the bytes back.
   */
  ipcMain.handle('qr:bytes', async (event, src: unknown) => {
    const url = String(src ?? '')
    if (!/^https?:/i.test(url)) return null
    try {
      const response = await net.fetch(url)
      if (!response.ok) return null
      const type = response.headers.get('content-type') ?? ''
      if (!/^image\//i.test(type)) return null
      const buffer = await response.arrayBuffer()
      // Anything bigger than eight megabytes is not a QR code.
      return buffer.byteLength <= 8_000_000 ? buffer : null
    } catch {
      return null
    }
  })
  ipcMain.on('qr:open', (event, text: unknown) => {
    const raw = String(text ?? '').slice(0, 2048)
    const url = /^https?:\/\//i.test(raw) ? raw : /^www\./i.test(raw) ? `https://${raw}` : ''
    if (url) current(event).newTab(url)
  })
  ipcMain.on('qr:copy', (event, text: unknown) => {
    clipboard.writeText(String(text ?? '').slice(0, 4096))
  })
  ipcMain.on('qr:none', (event) => {
    current(event).toast(t('Ничего не найдено'))
  })
  /**
   * The whole profile, sealed with a password of the person's choosing, into a
   * file they pick. Nothing leaves the machine unless they carry it.
   */
  /*
   * A small text file, saved where somebody says.
   *
   * Used by the appearance export, which is plain JSON somebody may want to
   * read, edit or send to another machine. The name is a suggestion only —
   * the dialog is what decides where it goes, so nothing here can write
   * outside what the person picked.
   */
  ipcMain.handle('file:save-text', async (_event, name: unknown, text: unknown) => {
    const suggested = String(name ?? 'nya.json').replace(/[^w.-]/g, '').slice(0, 80) || 'nya.json'
    const body = String(text ?? '').slice(0, 2_000_000)
    const where = await dialog.showSaveDialog({
      title: t('Сохранить файл'),
      defaultPath: join(app.getPath('downloads'), suggested),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (where.canceled || !where.filePath) return false
    try {
      writeFileSync(where.filePath, body, 'utf8')
      return true
    } catch {
      return false
    }
  })

  /** One text file, read back. Nothing is done with it here. */
  ipcMain.handle('file:open-text', async () => {
    const picked = await dialog.showOpenDialog({
      title: t('Открыть файл'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return ''
    try {
      return readFileSync(picked.filePaths[0], 'utf8').slice(0, 2_000_000)
    } catch {
      return ''
    }
  })

  ipcMain.handle('backup:make', async (event, password: unknown) => {
    const made = makeBackup(String(password ?? ''))
    if (!made) return null
    const stamp = new Date().toISOString().slice(0, 10)
    const where = await dialog.showSaveDialog({
      title: t('Сохранить копию'),
      defaultPath: join(app.getPath('downloads'), `nya-${stamp}.nyabackup`),
      filters: [{ name: 'Nya', extensions: ['nyabackup'] }]
    })
    if (where.canceled || !where.filePath) return null
    try {
      writeFileSync(where.filePath, JSON.stringify(made.file), 'utf8')
    } catch {
      return null
    }
    return made.counts
  })
  ipcMain.handle('backup:restore', async (event, password: unknown) => {
    const picked = await dialog.showOpenDialog({
      title: t('Восстановить из копии'),
      properties: ['openFile'],
      filters: [{ name: 'Nya', extensions: ['nyabackup', 'json'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(picked.filePaths[0], 'utf8'))
    } catch {
      return null
    }
    const body = readBackup(parsed, String(password ?? ''))
    if (!body) return null
    const counts = applyBackup(body)
    for (const win of windows) win.applySettings()
    return counts
  })
  ipcMain.handle('usage:summary', () => usage.summary())
  /**
   * What a page is holding in its form right now, and what it was holding
   * last time. Nothing here is asked for by the page: the browser offers it
   * back, once, and the page has to be told to take it.
   */
  ipcMain.on('draft:keep', (event, payload: unknown) => {
    const data = (payload ?? {}) as { url?: unknown; fields?: unknown }
    const fields = (data.fields ?? {}) as Record<string, unknown>
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value) clean[key] = value
    }
    drafts.keep(str(data.url, 2000), clean)
  })
  ipcMain.on('page:gesture', (event) => downloads.noteGesture(event.sender.id))
  // A page only ever offers an address; whether it is worth fetching is
  // decided by the window, which knows about the setting, private mode and
  // the battery.
  ipcMain.on('page:prefetch', (event, url: unknown) => {
    current(event).prefetch(str(url, 2000))
  })
  ipcMain.on('page:prefetch-next', (event, url: unknown) => {
    if (settings.get().prefetchNext) current(event).prefetch(str(url, 2000), true)
  })
  /* ---- media: 1.6 ---- */
  ipcMain.on('media:position', (event, payload: unknown) => {
    const data = (payload ?? {}) as { url?: unknown; at?: unknown; of?: unknown }
    playback.keep(str(data.url, 2000), num(data.at), num(data.of))
  })
  ipcMain.on('media:forget', (event, payload: unknown) => {
    const data = (payload ?? {}) as { url?: unknown }
    playback.drop(str(data.url, 2000))
  })
  ipcMain.on('media:ask-position', (event, payload: unknown) => {
    const data = (payload ?? {}) as { url?: unknown }
    const at = playback.find(str(data.url, 2000))
    if (at > 0) event.sender.send('media:resume-at', at)
  })
  ipcMain.on('media:ended', (event, payload: unknown) => {
    const data = (payload ?? {}) as { url?: unknown }
    playback.drop(str(data.url, 2000))
    current(event).playNextInQueue(event.sender.id)
  })
  ipcMain.on('media:frame', (event, payload: unknown) => {
    const data = (payload ?? {}) as { data?: unknown }
    current(event).keepFrame(str(data.data, 12_000_000))
  })
  ipcMain.on('media:chapters', (event, payload: unknown) => {
    const data = (payload ?? {}) as { list?: unknown }
    const rows = Array.isArray(data.list) ? data.list : []
    current(event).showChapters(
      rows.slice(0, 200).map((row) => {
        const one = (row ?? {}) as { at?: unknown; title?: unknown }
        return { at: num(one.at), title: str(one.title, 120) }
      })
    )
  })
  ipcMain.handle('media:player', (event, what: unknown, to: unknown) =>
    current(event).playerCommand(
      str(what, 20) as 'panel' | 'replay' | 'frame-now' | 'subtitles' | 'chapters',
      num(to)
    )
  )
  ipcMain.handle('media:sleep', (event, minutes: unknown) => current(event).setSleepTimer(num(minutes)))
  ipcMain.handle('media:queue', (event, on: unknown) => current(event).setQueue(flag(on)))
  ipcMain.on('page:text', (event, payload: unknown) => {
    const data = (payload ?? {}) as { url?: unknown; title?: unknown; text?: unknown }
    pageText.keep(str(data.url, 2000), str(data.title, 300), str(data.text, 8000))
  })
  ipcMain.handle('history:search-text', (event, query: unknown) => pageText.find(str(query, 200)))
  ipcMain.handle('translate:compare', (event, on: unknown) =>
    current(event).compareTranslation(flag(on))
  )
  /** How the reading sheet was left, kept for the next article. */
  ipcMain.on('reader:look', (event, patch: unknown) => {
    const next = (patch ?? {}) as Partial<Settings['reader']>
    settings.patch({ reader: { ...settings.get().reader, ...next } })
  })
  /**
   * The article as a file.
   *
   * Printing the page prints the site: its header, its banners, its footer.
   * This prints what the sheet is showing — the same words in the same shape,
   * on paper the size of paper — out of a window nobody sees.
   */
  ipcMain.on('reader:pdf', (event, payload: unknown) => {
    const data = (payload ?? {}) as { title?: unknown; byline?: unknown; url?: unknown; html?: unknown }
    void readerToPdf({
      title: str(data.title, 300),
      byline: str(data.byline, 300),
      url: str(data.url, 2000),
      html: typeof data.html === 'string' ? data.html.slice(0, 4_000_000) : ''
    })
  })
  /**
   * A stroke drawn with the right button held. The page reports the shape; the
   * meaning lives here, where the commands are.
   */
  ipcMain.on('gesture:done', (event, path: unknown) => {
    const shape = str(path, 8)
    const command: Record<string, string> = {
      L: 'back',
      R: 'forward',
      D: 'new-tab',
      U: 'reload',
      DR: 'close-tab',
      UL: 'reopen-tab'
    }
    const id = command[shape]
    if (id) current(event).runCommand(id)
  })
  ipcMain.handle('page:harvest', (event) => current(event).harvestFiles())
  /* ---- tabs: 1.4 ---- */
  ipcMain.handle('tab:detach', (event, id: unknown) => detachTab(current(event), num(id)))
  ipcMain.handle('tab:unread', (event, id: unknown, on: unknown) =>
    current(event).markUnread(num(id), flag(on))
  )
  ipcMain.handle('tab:costs', (event) => current(event).tabCosts())
  ipcMain.handle('tab:group-many', (event, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
    current(event).groupTabs(list)
  })
  ipcMain.handle('tab:shortcut', (event, id: unknown) => current(event).tabShortcut(num(id)))
  ipcMain.handle('tab:history', (event, id: unknown) => current(event).tabHistory(num(id)))
  ipcMain.handle('tab:go', (event, id: unknown, offset: unknown) =>
    current(event).goToOffset(num(id), num(offset))
  )
  ipcMain.handle('tab:preview', (event, id: unknown) => current(event).tabPreview(num(id)))
  ipcMain.handle('tab:recent', (event, back: unknown) => current(event).recentTab(flag(back)))
  ipcMain.handle('window:on-top', (event, on: unknown) => current(event).setAlwaysOnTop(flag(on)))
  /**
   * A tab dropped on another window. The window it came from is found by the
   * id it reported when the drag started — a renderer cannot name a window it
   * does not own.
   */
  ipcMain.handle('tab:move-window', (event, fromId: unknown, id: unknown) => {
    const to = current(event)
    const from = [...windows].find((win) => win.windowId === num(fromId))
    if (!from || from === to) return false
    const taken = from.takeTab(num(id))
    if (!taken) return false
    to.adoptTab(taken)
    return true
  })
  ipcMain.handle('window:id', (event) => current(event).windowId)
  ipcMain.on('page:files', (event, payload: unknown) => {
    const data = (payload ?? {}) as { files?: unknown }
    const rows = Array.isArray(data.files) ? data.files : []
    const files = rows
      .map((row) => (row ?? {}) as { url?: unknown; name?: unknown; kind?: unknown })
      .filter((row) => typeof row.url === 'string' && /^https?:\/\//i.test(row.url))
      .slice(0, 300)
      .map((row) => ({
        url: str(row.url, 4000),
        name: str(row.name, 300),
        kind: str(row.kind, 20)
      }))
    current(event).showFiles(event.sender.id, files)
  })
  ipcMain.handle('downloads:many', (event, urls: unknown) => {
    const list = Array.isArray(urls) ? urls : []
    current(event).downloadMany(list.filter((u): u is string => typeof u === 'string'))
  })
  ipcMain.on('draft:ask', (event, url: unknown) => {
    const fields = drafts.find(str(url, 2000))
    if (fields) event.sender.send('draft:have', { url: str(url, 2000), fields })
  })
  ipcMain.on('draft:drop', (event, url: unknown) => drafts.drop(str(url, 2000)))

  ipcMain.handle('usage:clear', () => {
    usage.clear()
  })
  ipcMain.handle('downloads:list', (event) => downloads.list())
  ipcMain.handle('downloads:pause', (event, id: unknown) => downloads.pause(str(id, 64)))
  ipcMain.handle('downloads:cancel', (event, id: unknown) => downloads.cancel(str(id, 64)))
  ipcMain.handle('downloads:open', (event, id: unknown) => downloads.open(str(id, 64)))
  ipcMain.handle('downloads:reveal', (event, id: unknown) => downloads.reveal(str(id, 64)))
  ipcMain.handle('downloads:remove', (event, id: unknown) => downloads.remove(str(id, 64)))
  ipcMain.handle('downloads:again', (event, id: unknown) => current(event).downloadAgain(str(id, 64)))
  ipcMain.handle('downloads:clear', (event) => downloads.clearFinished())
  ipcMain.handle('downloads:pause-all', (event, resume: unknown) => downloads.pauseAll(flag(resume)))
  ipcMain.handle('downloads:limit', (event, id: unknown, kbs: unknown) =>
    downloads.setLimit(str(id, 64), num(kbs))
  )
  ipcMain.handle('downloads:start-at', (event, id: unknown, at: unknown) =>
    downloads.setStart(str(id, 64), num(at))
  )
  ipcMain.handle('downloads:resume', (event, id: unknown) => downloads.resume(str(id, 64)))
  ipcMain.handle('downloads:allow', (event, id: unknown) => downloads.allow(str(id, 64)))
  /**
   * A finished file, handed to the system's drag. Only by id, and only when
   * the browser downloaded it: the renderer never names a path.
   */
  ipcMain.handle('downloads:drag', async (event, id: unknown) => {
    const path = downloads.pathOf(str(id, 64))
    if (!path) return
    let icon = await app.getFileIcon(path, { size: 'normal' }).catch(() => null)
    // startDrag refuses an empty image, and a file with no icon of its own is
    // still worth dragging.
    if (!icon || icon.isEmpty()) icon = nativeImage.createFromDataURL(BLANK_ICON)
    try {
      event.sender.startDrag({ file: path, icon })
    } catch {
      /* the drag was refused; nothing else to do about it */
    }
  })
  ipcMain.handle('downloads:url', (event, url: unknown) => current(event).downloadFrom(str(url, 4000)))
  /**
   * The button on a toast. Only ids the browser itself put there are acted on,
   * and each one names what it does.
   */
  ipcMain.handle('toast:action', (event, id: unknown) => {
    const value = str(id, 4000)
    if (value.startsWith('reveal:')) downloads.reveal(value.slice('reveal:'.length))
    else if (value.startsWith('reopen:')) current(event).reopenClosed(value.slice('reopen:'.length))
  })

  /* ---- permissions ---- */
  ipcMain.handle('permission:answer', (event, id: unknown, allow: unknown) =>
    current(event).answerPermission(str(id, 64), flag(allow))
  )

  /* ---- suggestions & misc ---- */
  ipcMain.handle('suggest:query', (event, query: unknown) => current(event).suggestions(str(query, 512)))
  ipcMain.handle('suggest:preconnect', (event, query: unknown) => current(event).preconnect(str(query, 512)))
  ipcMain.handle('suggest:forget', (event, url: unknown) => current(event).forgetSuggestion(str(url, 2000)))
  ipcMain.handle('suggest:forget-searches', (event) => current(event).forgetSearches())
  ipcMain.handle('privacy:stats', (event) => ({ ...stats }))
  ipcMain.handle('privacy:reset-stats', (event) => resetStats())
  ipcMain.handle('privacy:blocked-log', () => blockedLog())
  ipcMain.handle('privacy:clear', (event) => current(event).clearData())
  ipcMain.handle('privacy:clear-all-profiles', async () => {
    for (const profile of profiles.state.profiles) {
      await clearBrowsingData(session.fromPartition(profiles.partition(profile.id)))
    }
  })
  /* ---- updates ---- */
  ipcMain.handle('drm:state', (event) => ({ ...widevineState(), needsRestart: needsRestart() }))
  ipcMain.handle('updates:state', (event) => updateState())
  ipcMain.handle('updates:check', (event) => checkUpdates())
  ipcMain.handle('window:new', (_event, incognito: unknown) => {
    const win = openWindow(incognito === true)
    win.chrome.webContents.once('did-finish-load', () => win.newTab())
    return true
  })
  ipcMain.handle('favicons:all', (event) => favicons.all())
  // Asked for by name, for a tile just added or a saved password whose site
  // has not been opened here. Rides the profile's own session.
  ipcMain.handle('favicons:fetch', (event, host: unknown) =>
    favicons.fetchFor(str(host, 200), current(event).pageSession)
  )
  ipcMain.handle('updates:download', (event) => downloadUpdate())
  ipcMain.handle('updates:install', (event) => installNow())

  /* ---- extensions ---- */
  ipcMain.handle('ext:list', (event) => listExtensions())
  /** Whatever changed, every window's toolbar hears about it. */
  const tellExtensions = () => windows.forEach((win) => win.sendExtensions())
  ipcMain.handle('ext:add', async (event) => {
    const result = await addExtension()
    tellExtensions()
    return result
  })
  ipcMain.handle('ext:remove', (event, path: unknown) => {
    const gone = removeExtension(str(path, 600))
    tellExtensions()
    return gone
  })
  ipcMain.handle('ext:reveal', (event, path: unknown) => revealExtension(str(path, 600)))

  /* ---- health: why it will not open, and what died last time ---- */
  ipcMain.handle('health:safe-start', () => safeStart)
  ipcMain.handle('health:restart', (event, safe: unknown) => {
    // Relaunch carries the flag, or deliberately does not: the same button
    // gets both into safe start and back out of it.
    const args = process.argv.slice(1).filter((one) => one !== '--safe' && one !== '--safe-mode')
    app.relaunch({ args: safe === true ? [...args, '--safe'] : args })
    app.exit(0)
  })
  ipcMain.handle('tab:timer', (event, id: unknown, minutes: unknown) => {
    current(event).setTabTimer(num(id), num(minutes))
  })
  ipcMain.handle('health:failures', () => pageFailures())
  ipcMain.handle('health:clear-failures', () => {
    clearFailures()
  })
  ipcMain.handle('health:network', (event, host: unknown) => checkNetwork(str(host, 300)))
  ipcMain.handle('health:crash', () => lastCrash())
  ipcMain.handle('health:dismiss-crash', () => {
    dismissCrash()
  })

  /* ---- filter lists ---- */
  ipcMain.handle('filters:status', (event) => filterStatus())
  ipcMain.handle('filters:refresh', (event) => loadFilters(true))

  /* ---- import from another browser ---- */
  ipcMain.handle('import:sources', (event) => detectSources())
  ipcMain.handle('import:history', (event, id: unknown) => importHistory(str(id, 400)))
  ipcMain.handle('import:bookmarks', (event, id: unknown) => {
    const result = importBookmarks(str(id, 512))
    if (result.added > 0) current(event).sendBookmarks()
    return result
  })
  ipcMain.handle('import:passwords', (event) => importPasswordsCsv())

  ipcMain.handle('app:default-browser', (event) => defaultBrowserState())
  ipcMain.handle('app:make-default', (event) => requestDefaultBrowser())
  ipcMain.handle('app:drop-default', async () => {
    await unregisterAsBrowser()
    return defaultBrowserState()
  })
  ipcMain.handle('dev:tools', (event) => current(event).openDevTools())
  ipcMain.handle('shell:open', (event, url: unknown) => current(event).openExternal(str(url)))
  /**
   * What Chromium says about the graphics card, in the words it uses itself.
   * `basic` info is a promise, so the last answer is kept and refreshed in the
   * background: the About page should not wait on the GPU process to paint.
   */
  let gpuAdapter = { adapter: '', driver: '' }

  const gpuStatus = (): AppInfo['gpu'] => {
    const status = app.getGPUFeatureStatus() as unknown as Record<string, string>
    const of = (key: string) => String(status[key] ?? 'unknown')
    const compositing = of('gpu_compositing')
    return {
      ...gpuAdapter,
      compositing,
      rasterization: of('rasterization'),
      canvas: of('2d_canvas'),
      webgl: of('webgl'),
      // Chromium says "enabled" only when the card is really doing the work;
      // everything else means it is being drawn on the processor.
      software: !compositing.startsWith('enabled')
    }
  }
  const refreshGpu = () =>
    void app
      .getGPUInfo('basic')
      .then((info) => {
        const device = (info as { gpuDevice?: Array<Record<string, unknown>> }).gpuDevice?.[0] ?? {}
        gpuAdapter = {
          adapter: String(device.deviceString || device.vendorString || ''),
          driver: String(device.driverVersion || '')
        }
      })
      .catch(() => undefined)
  refreshGpu()

  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    profileDir: profiles.dir(),
    blocklistSize: BLOCKLIST_SIZE,
    sandboxed: app.commandLine.hasSwitch('enable-sandbox') || true,
    gpu: gpuStatus()
  }))

  /* ---- autofill: page → main (send/on, not invoke) ---- */
  ipcMain.on('autofill:form', (event, payload: unknown) => {
    const data = (payload ?? {}) as { host?: string }
    current(event).handleAutofillForm(event.sender.id, str(data.host, 200))
  })
  ipcMain.on('autofill:field', (event, payload: unknown) => {
    const data = (payload ?? {}) as {
      host?: string
      kind?: unknown
      postsTo?: unknown
      x?: unknown
      y?: unknown
      width?: unknown
      height?: unknown
    }
    const px = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    const kinds = ['card', 'address', 'code', 'new-password'] as const
    const kind = (kinds as readonly unknown[]).includes(data.kind)
      ? (data.kind as (typeof kinds)[number])
      : ('login' as const)
    current(event).handleAutofillField(
      event.sender.id,
      str(data.host, 200),
      kind,
      {
        x: px(data.x),
        y: px(data.y),
        width: px(data.width),
        height: px(data.height)
      },
      str(data.postsTo, 200)
    )
  })
  ipcMain.on('autofill:leave', (event) => {
    current(event).hideAutofill(event.sender.id)
  })
  ipcMain.on('autofill:submitted', (event, payload: unknown) => {
    const data = (payload ?? {}) as { host?: string; username?: string; password?: string }
    current(event as unknown as Electron.IpcMainInvokeEvent).handleAutofillSubmitted(str(data.host, 200), str(data.username, 200), str(data.password, 400))
  })
}

/**
 * Points Chromium's resolver at a DNS-over-HTTPS server, or leaves it to the
 * system.
 *
 * Everything else the browser does about privacy — blocking, HTTPS-only,
 * stripping tracking parameters — happens after the address has already been
 * asked for in the clear. This is that last request.
 *
 * `secureDnsMode` 'secure' refuses to fall back to the plain resolver, which is
 * the honest setting and also the one that breaks a captive portal; 'automatic'
 * tries the secure resolver first and lets the system answer when it cannot.
 */
export function applyDnsProvider() {
  const s = settings.get()
  const template =
    s.dnsProvider === 'custom'
      ? s.dohCustom
      : s.dnsProvider === 'system'
        ? ''
        : DOH_TEMPLATES[s.dnsProvider]

  if (!template) {
    app.configureHostResolver({ secureDnsMode: 'off', secureDnsServers: [] })
    return
  }
  app.configureHostResolver({
    secureDnsMode: s.dohFallback ? 'automatic' : 'secure',
    secureDnsServers: [template]
  })
}

/* ------------------------------------------------------------------------- */
/* Menu — macOS only; Windows/Linux shortcuts live in BrowserWindow.handleInput */
/* ------------------------------------------------------------------------- */
function buildMenu(b: BrowserWindow) {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Nya Browser',
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit', label: t('Выход') }]
    },
    {
      label: t('Файл'),
      submenu: [
        { label: t('Новая вкладка'), accelerator: 'Cmd+T', click: () => b.newTab() },
        { label: t('Закрыть вкладку'), accelerator: 'Cmd+W', click: () => b.closeTab(b.activeId) },
        { label: t('Вернуть вкладку'), accelerator: 'Cmd+Shift+T', click: () => b.reopenClosed() }
      ]
    },
    {
      label: t('Правка'),
      submenu: [
        { role: 'undo', label: t('Отменить') },
        { role: 'redo', label: t('Повторить') },
        { type: 'separator' },
        { role: 'cut', label: t('Вырезать') },
        { role: 'copy', label: t('Копировать') },
        { role: 'paste', label: t('Вставить') },
        { role: 'selectAll', label: t('Выделить всё') }
      ]
    },
    {
      label: t('Вид'),
      submenu: [
        { label: t('Адресная строка'), accelerator: 'Cmd+L', click: () => b.sendShortcut('focus-address') },
        { label: t('Настройки'), accelerator: 'Cmd+,', click: () => b.sendShortcut('settings') },
        { type: 'separator' },
        { label: t('Обновить'), accelerator: 'Cmd+R', click: () => b.reload() },
        { label: t('Инструменты разработчика'), accelerator: 'F12', click: () => b.openDevTools() }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ------------------------------------------------------------------------- */
/* Shutdown                                                                   */
/* ------------------------------------------------------------------------- */
let quitting = false

app.on('before-quit', async (event) => {
  browser?.dispose()
  // The marker goes on the way out, so the next run knows this one finished.
  closeHealth()
  flushAll()
  if (settings.get().clearOnExit && !quitting) {
    quitting = true
    event.preventDefault()
    log('clearing data on exit')
    await clearBrowsingData(session.fromPartition(profiles.partition()))
    history.clear()
    flushAll()
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  flushAll()
  if (process.platform !== 'darwin') app.quit()
})
