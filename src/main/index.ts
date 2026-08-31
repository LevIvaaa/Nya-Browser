import { app, ipcMain, Menu, nativeTheme, session, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { BrowserWindow } from './browser'
import { settings } from './settings'
import { history } from './history'
import { bookmarks } from './bookmarks'
import { profiles, AVATAR_CHOICES, COLOR_CHOICES } from './profiles'
import { vault } from './vault'
import { downloads } from './downloads'
import { initLog, log } from './log'
import { flushAll, installExitHooks } from './store'
import { registerProtocols, registerSchemes } from './protocol'
import { BLOCKLIST_SIZE, clearBrowsingData, hardenApp, hardenSession, resetStats, stats } from './security'
import { detectSources, importBookmarks, importPasswordsCsv } from './import'
import { engine, filterStatus, loadFilters } from './filters'
import { addExtension, listExtensions, removeExtension, revealExtension } from './extensions'
import { check as checkUpdates, initUpdates, installNow, onUpdateState, updateState } from './updates'
import { initWidevine, needsRestart, widevineState } from './widevine'
import {
  defaultBrowserState,
  registerAsBrowser,
  requestDefaultBrowser,
  unregisterAsBrowser,
  urlFromArgv
} from './windows-integration'
import { SEARCH_ENGINES } from '../shared/search'
import type { AppInfo, Settings } from '../shared/types'

/* ------------------------------------------------------------------------- */
/* Startup switches — read before app.whenReady() and fixed for the session.  */
/* ------------------------------------------------------------------------- */
function applyStartupSwitches() {
  const s = settings.get()

  if (!s.hardwareAcceleration) {
    app.disableHardwareAcceleration()
  } else {
    app.commandLine.appendSwitch('enable-gpu-rasterization')
    app.commandLine.appendSwitch('enable-zero-copy')
    app.commandLine.appendSwitch('ignore-gpu-blocklist')
    app.commandLine.appendSwitch('enable-accelerated-2d-canvas')
    app.commandLine.appendSwitch('enable-accelerated-video-decode')
  }

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

let browser: BrowserWindow | null = null

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
  applyStartupSwitches()
  installExitHooks()

  app.on('second-instance', (_event, argv) => {
    if (!browser) return
    if (browser.win.isMinimized()) browser.win.restore()
    browser.win.focus()
    const url = urlFromArgv(argv)
    if (url) browser.newTab(url)
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.nya.browser')

    initLog()
    // Deliberately not awaited. The CDM is a ~10 MB download from Google's
    // component server on first use, and waiting for it would leave the window
    // unpainted for as long as that takes. The cost is that a DRM page opened in
    // the first seconds may need a reload, which the settings page mentions.
    void initWidevine()
    registerProtocols()
    hardenApp(app)
    hardenSession(session.defaultSession)
    nativeTheme.themeSource = settings.get().theme
    // Served from the on-disk cache when it is fresh, so this is normally
    // instant and offline; only a stale list actually hits the network.
    if (settings.get().filterLists) void loadFilters()

    browser = new BrowserWindow()
    registerIpc(browser)
    buildMenu(browser)

    browser.chrome.webContents.once('did-finish-load', () => {
      const b = browser!
      log('chrome ready, profile', profiles.active.name)
      b.sendWindowState()
      b.sendProfiles()
      b.applySettings()
      // A cold start from "open link in Nya Browser" must land on that link
      // rather than on whatever the restored session had open.
      const launchUrl = urlFromArgv(process.argv)
      const restored = b.restoreSession()
      if (launchUrl) b.newTab(launchUrl)
      else if (!restored) b.newTab()
    })

    // Re-assert the shell registration on every launch: a portable build the
    // user moved would otherwise leave a dead association behind.
    void registerAsBrowser()

    initUpdates()
    onUpdateState((state) => browser?.sendUpdateState(state))

    app.on('activate', () => {
      if (!browser || browser.win.isDestroyed()) {
        browser = new BrowserWindow()
        registerIpc(browser)
        buildMenu(browser)
        browser.chrome.webContents.once('did-finish-load', () => browser!.newTab())
      }
    })
  })
}

/* ------------------------------------------------------------------------- */
/* IPC                                                                        */
/* ------------------------------------------------------------------------- */
let ipcRegistered = false

function registerIpc(initial: BrowserWindow) {
  if (ipcRegistered) return
  ipcRegistered = true
  const current = () => browser ?? initial

  const str = (value: unknown, max = 4096) => (typeof value === 'string' ? value.slice(0, max) : '')
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const flag = (value: unknown) => value === true

  /* ---- tabs ---- */
  ipcMain.handle('tab:new', (_e, url?: unknown, background?: unknown) =>
    current().newTab(str(url), flag(background))
  )
  ipcMain.handle('tab:close', (_e, id: unknown) => current().closeTab(num(id)))
  ipcMain.handle('tab:close-others', (_e, id: unknown) => current().closeOthers(num(id)))
  ipcMain.handle('tab:close-right', (_e, id: unknown) => current().closeToRight(num(id)))
  ipcMain.handle('tab:switch', (_e, id: unknown) => current().switchTab(num(id)))
  ipcMain.handle('tab:move', (_e, id: unknown, index: unknown) => current().moveTab(num(id), num(index)))
  ipcMain.handle('tab:duplicate', (_e, id: unknown) => current().duplicateTab(num(id)))
  ipcMain.handle('tab:mute', (_e, id: unknown) => current().toggleMute(num(id)))
  ipcMain.handle('tab:sleep', (_e, id: unknown) => current().sleepTab(num(id)))
  ipcMain.handle('tab:reload', (_e, id: unknown) => current().reloadTab(num(id)))
  ipcMain.handle('tab:menu', (_e, id: unknown) => current().showTabMenu(num(id)))
  ipcMain.handle('tab:reopen', () => current().reopenClosed())
  ipcMain.handle('tab:closed-list', () => current().recentlyClosed())
  ipcMain.handle('tab:navigate', (_e, url: unknown, id?: unknown) =>
    current().navigate(str(url), id === undefined ? undefined : num(id))
  )

  /* ---- navigation ---- */
  ipcMain.handle('nav:back', () => current().goBack())
  ipcMain.handle('nav:forward', () => current().goForward())
  ipcMain.handle('nav:reload', (_e, hard?: unknown) => current().reload(flag(hard)))
  ipcMain.handle('nav:stop', () => current().stop())
  ipcMain.handle('nav:home', () => current().goHome())
  ipcMain.handle('nav:zoom', (_e, delta: unknown) => current().setZoom(delta === 'reset' ? 'reset' : num(delta)))
  ipcMain.handle('nav:http-fallback', () => current().continueOverHttp())
  ipcMain.handle('nav:print', () => current().print())

  /* ---- find ---- */
  ipcMain.handle('find:query', (_e, text: unknown, forward?: unknown) =>
    current().find(str(text, 256), forward !== false)
  )
  ipcMain.handle('find:stop', () => current().stopFind())

  /* ---- window ---- */
  ipcMain.handle('win:minimize', () => current().win.minimize())
  ipcMain.handle('win:maximize', () => {
    const win = current().win
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('win:close', () => current().win.close())
  ipcMain.handle('win:fullscreen', () => {
    const win = current().win
    win.setFullScreen(!win.isFullScreen())
  })

  /* ---- overlay layer (menus, popovers, command palette) ---- */
  ipcMain.handle('ui:overlay', (_e, mode: unknown) =>
    current().setOverlayMode(typeof mode === 'string' && mode ? mode.slice(0, 32) : null)
  )
  ipcMain.handle('ui:page', (_e, page: unknown) => current().openChromePage(str(page, 32)))

  /* ---- chrome layout ---- */
  ipcMain.handle('ui:layout', (_e, rect: unknown) => {
    const r = rect as { x: number; y: number; width: number; height: number; visible: boolean }
    if (!r || typeof r !== 'object') return
    current().setLayout({
      x: num(r.x),
      y: num(r.y),
      width: num(r.width),
      height: num(r.height),
      visible: r.visible !== false
    })
  })

  /* ---- settings ---- */
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:engines', () => SEARCH_ENGINES)
  ipcMain.handle('settings:set', (_e, patch: unknown) => {
    const next = settings.patch((patch ?? {}) as Partial<Settings>)
    nativeTheme.themeSource = next.theme
    current().applySettings()
    if (next.filterLists && !engine.ready) void loadFilters()
    return next
  })
  ipcMain.handle('settings:reset', () => {
    const next = settings.reset()
    nativeTheme.themeSource = next.theme
    current().applySettings()
    return next
  })
  ipcMain.handle('settings:export', () => JSON.stringify(settings.get(), null, 2))
  ipcMain.handle('settings:import', (_e, json: unknown) => {
    try {
      const parsed = JSON.parse(str(json, 200_000))
      const next = settings.patch(parsed as Partial<Settings>)
      nativeTheme.themeSource = next.theme
      current().applySettings()
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('settings:wallpaper', () => current().importWallpaper())
  ipcMain.handle('settings:open-data', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('settings:download-dir', async () => {
    const dir = await downloads.chooseFolder()
    if (dir) {
      settings.patch({ downloadDir: dir })
      current().applySettings()
    }
    return dir
  })

  /* ---- profiles ---- */
  ipcMain.handle('profiles:list', () => profiles.state)
  ipcMain.handle('profiles:choices', () => ({ avatars: AVATAR_CHOICES, colors: COLOR_CHOICES }))
  ipcMain.handle('profiles:create', (_e, name: unknown) => {
    const profile = profiles.create(str(name, 40) || 'Профиль')
    current().sendProfiles()
    return profile
  })
  ipcMain.handle('profiles:update', (_e, id: unknown, patch: unknown) => {
    const state = profiles.update(str(id, 64), (patch ?? {}) as Record<string, string>)
    current().sendProfiles()
    return state
  })
  ipcMain.handle('profiles:remove', (_e, id: unknown) => {
    const state = profiles.remove(str(id, 64))
    current().sendProfiles()
    return state
  })
  ipcMain.handle('profiles:switch', (_e, id: unknown) => {
    current().switchProfile(str(id, 64))
    return profiles.state
  })

  /* ---- bookmarks ---- */
  ipcMain.handle('bookmarks:list', () => bookmarks.all())
  ipcMain.handle('bookmarks:folders', () => bookmarks.folders())
  ipcMain.handle('bookmarks:add', (_e, input: unknown) => {
    const data = (input ?? {}) as { title?: string; url?: string; folder?: string; pinned?: boolean }
    const result = bookmarks.add({
      title: str(data.title, 300),
      url: str(data.url, 2048),
      folder: str(data.folder, 60),
      pinned: flag(data.pinned)
    })
    return result
  })
  ipcMain.handle('bookmarks:update', (_e, id: unknown, patch: unknown) =>
    bookmarks.update(str(id, 64), (patch ?? {}) as Record<string, never>)
  )
  ipcMain.handle('bookmarks:remove', (_e, id: unknown) => bookmarks.remove(str(id, 64)))
  ipcMain.handle('bookmarks:toggle-current', () => current().bookmarkCurrent())

  /* ---- history ---- */
  ipcMain.handle('history:all', () => history.all())
  ipcMain.handle('history:recent', (_e, limit?: unknown) => history.recent(num(limit) || 60))
  ipcMain.handle('history:remove', (_e, url: unknown) => history.remove(str(url, 2048)))
  ipcMain.handle('history:clear', () => history.clear())

  /* ---- passwords ---- */
  ipcMain.handle('vault:state', () => ({
    mode: vault.mode,
    locked: vault.locked,
    count: vault.count,
    osEncryption: vault.encryptionAvailable
  }))
  ipcMain.handle('vault:list', () => vault.list())
  ipcMain.handle('vault:unlock', (_e, password: unknown) => vault.unlock(str(password, 400)))
  ipcMain.handle('vault:lock', () => vault.lock())
  ipcMain.handle('vault:save', (_e, input: unknown) => {
    const data = (input ?? {}) as { origin?: string; username?: string; password?: string; note?: string }
    return vault.save(str(data.origin, 200), str(data.username, 200), str(data.password, 400), str(data.note, 200))
  })
  ipcMain.handle('vault:reveal', (_e, id: unknown) => vault.reveal(str(id, 64)))
  ipcMain.handle('vault:remove', (_e, id: unknown) => vault.remove(str(id, 64)))
  ipcMain.handle('vault:generate', (_e, length?: unknown) => vault.generate(num(length) || 20))
  ipcMain.handle('vault:set-master', (_e, currentPass: unknown, next: unknown) =>
    vault.setMasterPassword(currentPass === null ? null : str(currentPass, 400), str(next, 400))
  )
  ipcMain.handle('vault:drop-master', (_e, currentPass: unknown) =>
    vault.removeMasterPassword(str(currentPass, 400))
  )
  ipcMain.handle('vault:fill', (_e, id: unknown) => current().fillCredential(str(id, 64)))
  ipcMain.handle('vault:confirm-save', (_e, save: unknown) => current().confirmSavePassword(flag(save)))
  ipcMain.handle('vault:cipher-sample', () => vault.cipherSample())

  /* ---- downloads ---- */
  ipcMain.handle('downloads:list', () => downloads.list())
  ipcMain.handle('downloads:pause', (_e, id: unknown) => downloads.pause(str(id, 64)))
  ipcMain.handle('downloads:cancel', (_e, id: unknown) => downloads.cancel(str(id, 64)))
  ipcMain.handle('downloads:open', (_e, id: unknown) => downloads.open(str(id, 64)))
  ipcMain.handle('downloads:reveal', (_e, id: unknown) => downloads.reveal(str(id, 64)))
  ipcMain.handle('downloads:remove', (_e, id: unknown) => downloads.remove(str(id, 64)))
  ipcMain.handle('downloads:clear', () => downloads.clearFinished())

  /* ---- permissions ---- */
  ipcMain.handle('permission:answer', (_e, id: unknown, allow: unknown) =>
    current().answerPermission(str(id, 64), flag(allow))
  )

  /* ---- suggestions & misc ---- */
  ipcMain.handle('suggest:query', (_e, query: unknown) => current().suggestions(str(query, 512)))
  ipcMain.handle('suggest:preconnect', (_e, query: unknown) => current().preconnect(str(query, 512)))
  ipcMain.handle('privacy:stats', () => ({ ...stats }))
  ipcMain.handle('privacy:reset-stats', () => resetStats())
  ipcMain.handle('privacy:clear', () => current().clearData())
  ipcMain.handle('privacy:clear-all-profiles', async () => {
    for (const profile of profiles.state.profiles) {
      await clearBrowsingData(session.fromPartition(profiles.partition(profile.id)))
    }
  })
  /* ---- updates ---- */
  ipcMain.handle('drm:state', () => ({ ...widevineState(), needsRestart: needsRestart() }))
  ipcMain.handle('updates:state', () => updateState())
  ipcMain.handle('updates:check', () => checkUpdates())
  ipcMain.handle('updates:install', () => installNow())

  /* ---- extensions ---- */
  ipcMain.handle('ext:list', () => listExtensions())
  ipcMain.handle('ext:add', () => addExtension())
  ipcMain.handle('ext:remove', (_e, path: unknown) => removeExtension(str(path, 600)))
  ipcMain.handle('ext:reveal', (_e, path: unknown) => revealExtension(str(path, 600)))

  /* ---- filter lists ---- */
  ipcMain.handle('filters:status', () => filterStatus())
  ipcMain.handle('filters:refresh', () => loadFilters(true))

  /* ---- import from another browser ---- */
  ipcMain.handle('import:sources', () => detectSources())
  ipcMain.handle('import:bookmarks', (_e, id: unknown) => {
    const result = importBookmarks(str(id, 512))
    if (result.added > 0) current().sendBookmarks()
    return result
  })
  ipcMain.handle('import:passwords', () => importPasswordsCsv())

  ipcMain.handle('app:default-browser', () => defaultBrowserState())
  ipcMain.handle('app:make-default', () => requestDefaultBrowser())
  ipcMain.handle('app:drop-default', async () => {
    await unregisterAsBrowser()
    return defaultBrowserState()
  })
  ipcMain.handle('dev:tools', () => current().openDevTools())
  ipcMain.handle('shell:open', (_e, url: unknown) => current().openExternal(str(url)))
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
    sandboxed: app.commandLine.hasSwitch('enable-sandbox') || true
  }))

  /* ---- autofill: page → main (send/on, not invoke) ---- */
  ipcMain.on('autofill:form', (event, payload: unknown) => {
    const data = (payload ?? {}) as { host?: string }
    current().handleAutofillForm(event.sender.id, str(data.host, 200))
  })
  ipcMain.on('autofill:submitted', (_event, payload: unknown) => {
    const data = (payload ?? {}) as { host?: string; username?: string; password?: string }
    current().handleAutofillSubmitted(str(data.host, 200), str(data.username, 200), str(data.password, 400))
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
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit', label: 'Выход' }]
    },
    {
      label: 'Файл',
      submenu: [
        { label: 'Новая вкладка', accelerator: 'Cmd+T', click: () => b.newTab() },
        { label: 'Закрыть вкладку', accelerator: 'Cmd+W', click: () => b.closeTab(b.activeId) },
        { label: 'Вернуть вкладку', accelerator: 'Cmd+Shift+T', click: () => b.reopenClosed() }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Адресная строка', accelerator: 'Cmd+L', click: () => b.sendShortcut('focus-address') },
        { label: 'Настройки', accelerator: 'Cmd+,', click: () => b.sendShortcut('settings') },
        { type: 'separator' },
        { label: 'Обновить', accelerator: 'Cmd+R', click: () => b.reload() },
        { label: 'Инструменты разработчика', accelerator: 'F12', click: () => b.openDevTools() }
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
