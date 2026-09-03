import { app, dialog, ipcMain, Menu, nativeTheme, session, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { BrowserWindow } from './browser'
import { settings } from './settings'
import { history } from './history'
import { bookmarks } from './bookmarks'
import { profiles, AVATAR_CHOICES, AVATAR_PICTURE_EXTENSIONS, COLOR_CHOICES } from './profiles'
import { vault } from './vault'
import { downloads } from './downloads'
import { initLog, log } from './log'
import { flushAll, installExitHooks } from './store'
import { registerProtocols, registerSchemes } from './protocol'
import { BLOCKLIST_SIZE, blockedLog, clearBrowsingData, hardenApp, hardenSession, resetStats, stats } from './security'
import { detectSources, importBookmarks, importPasswordsCsv } from './import'
import { engine, filterStatus, hideCss, loadFilters } from './filters'
import { addExtension, listExtensions, removeExtension, revealExtension } from './extensions'
import { favicons } from './favicons'
import { currentWeather, searchPlaces } from './weather'
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

// Every open window. IPC is registered once and answers whichever window the
// message came from, so a second window is not a special case anywhere.
const windows = new Set<BrowserWindow>()
let browser: BrowserWindow | null = null

/** Opens another window, wired the same way as the first. */
function openWindow(incognito = false): BrowserWindow {
  const win = new BrowserWindow(incognito)
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
  applyStartupSwitches()
  installExitHooks()

  app.on('second-instance', (_event, argv) => {
    if (!browser) return
    if (browser.win.isMinimized()) browser.win.restore()
    browser.win.focus()
    const url = urlFromArgv(argv)
    if (url) browser.newTab(url)
  })

  app.whenReady().then(async () => {
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
    // Awaited on purpose, and cheap: loadFilters resolves as soon as the
    // engine is armed from the on-disk cache and refreshes stale lists in the
    // background. This is what makes the first request of the first tab
    // already go through the full blocker instead of slipping past it.
    if (settings.get().filterLists) await loadFilters()

    // Pages ask for their anti-flicker CSS synchronously at document-start, so
    // the answer must never block: whatever the engine knows right now, or
    // nothing. Registered before the first window exists.
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

    const first = openWindow()
    registerIpc()
    buildMenu(first)

    first.chrome.webContents.once('did-finish-load', () => {
      const b = first
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

    app.on('activate', () => {
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
  ipcMain.handle('tab:menu', (event, id: unknown) => current(event).showTabMenu(num(id)))
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
  ipcMain.handle('nav:print', (event) => current(event).print())

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

  /** Same for the profile list: renaming one must not leave a window behind. */
  const profilesEverywhere = () => {
    for (const win of windows) win.sendProfiles()
  }

  /* ---- settings ---- */
  ipcMain.handle('settings:get', (event) => settings.get())
  ipcMain.handle('settings:engines', (event) => SEARCH_ENGINES)
  ipcMain.handle('settings:set', (event, patch: unknown) => {
    const next = settings.patch((patch ?? {}) as Partial<Settings>)
    nativeTheme.themeSource = next.theme
    applyEverywhere()
    if (next.filterLists && !engine.ready) void loadFilters()
    return next
  })
  ipcMain.handle('settings:reset', (event) => {
    const next = settings.reset()
    nativeTheme.themeSource = next.theme
    applyEverywhere()
    return next
  })
  ipcMain.handle('settings:export', (event) => JSON.stringify(settings.get(), null, 2))
  ipcMain.handle('settings:import', (event, json: unknown) => {
    try {
      const parsed = JSON.parse(str(json, 200_000))
      const next = settings.patch(parsed as Partial<Settings>)
      nativeTheme.themeSource = next.theme
      applyEverywhere()
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('settings:wallpaper', (event) => current(event).importWallpaper())
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
    const profile = profiles.create(str(name, 40) || 'Профиль')
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
  ipcMain.handle('weather:current', (_event, lat: unknown, lon: unknown) => {
    const latitude = Number(lat)
    const longitude = Number(lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return currentWeather(latitude, longitude)
  })

  ipcMain.handle('profiles:pick-avatar', async (event, id: unknown) => {
    const win = current(event)
    const picked = await dialog.showOpenDialog(win.win, {
      title: 'Выберите картинку для аватара',
      properties: ['openFile'],
      filters: [{ name: 'Картинки', extensions: AVATAR_PICTURE_EXTENSIONS }]
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
  ipcMain.handle('history:recent', (event, limit?: unknown) => history.recent(num(limit) || 60))
  ipcMain.handle('history:remove', (event, url: unknown) => history.remove(str(url, 2048)))
  ipcMain.handle('history:clear', (event) => history.clear())

  /* ---- passwords ---- */
  ipcMain.handle('vault:state', (event) => ({
    mode: vault.mode,
    locked: vault.locked,
    count: vault.count,
    osEncryption: vault.encryptionAvailable
  }))
  ipcMain.handle('vault:list', (event) => vault.list())
  ipcMain.handle('vault:unlock', (event, password: unknown) => vault.unlock(str(password, 400)))
  ipcMain.handle('vault:lock', (event) => vault.lock())
  ipcMain.handle('vault:save', (event, input: unknown) => {
    const data = (input ?? {}) as { origin?: string; username?: string; password?: string; note?: string }
    return vault.save(str(data.origin, 200), str(data.username, 200), str(data.password, 400), str(data.note, 200))
  })
  ipcMain.handle('vault:reveal', (event, id: unknown) => vault.reveal(str(id, 64)))
  ipcMain.handle('vault:remove', (event, id: unknown) => vault.remove(str(id, 64)))
  ipcMain.handle('vault:generate', (event, length?: unknown) => vault.generate(num(length) || 20))
  ipcMain.handle('vault:set-master', (event, currentPass: unknown, next: unknown) =>
    vault.setMasterPassword(currentPass === null ? null : str(currentPass, 400), str(next, 400))
  )
  ipcMain.handle('vault:drop-master', (event, currentPass: unknown) =>
    vault.removeMasterPassword(str(currentPass, 400))
  )
  ipcMain.handle('vault:fill', (event, id: unknown) => current(event).fillCredential(str(id, 64)))
  ipcMain.handle('vault:confirm-save', (event, save: unknown) => current(event).confirmSavePassword(flag(save)))
  ipcMain.handle('vault:cipher-sample', (event) => vault.cipherSample())

  /* ---- downloads ---- */
  ipcMain.handle('downloads:list', (event) => downloads.list())
  ipcMain.handle('downloads:pause', (event, id: unknown) => downloads.pause(str(id, 64)))
  ipcMain.handle('downloads:cancel', (event, id: unknown) => downloads.cancel(str(id, 64)))
  ipcMain.handle('downloads:open', (event, id: unknown) => downloads.open(str(id, 64)))
  ipcMain.handle('downloads:reveal', (event, id: unknown) => downloads.reveal(str(id, 64)))
  ipcMain.handle('downloads:remove', (event, id: unknown) => downloads.remove(str(id, 64)))
  ipcMain.handle('downloads:clear', (event) => downloads.clearFinished())

  /* ---- permissions ---- */
  ipcMain.handle('permission:answer', (event, id: unknown, allow: unknown) =>
    current(event).answerPermission(str(id, 64), flag(allow))
  )

  /* ---- suggestions & misc ---- */
  ipcMain.handle('suggest:query', (event, query: unknown) => current(event).suggestions(str(query, 512)))
  ipcMain.handle('suggest:preconnect', (event, query: unknown) => current(event).preconnect(str(query, 512)))
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
  ipcMain.handle('updates:download', (event) => downloadUpdate())
  ipcMain.handle('updates:install', (event) => installNow())

  /* ---- extensions ---- */
  ipcMain.handle('ext:list', (event) => listExtensions())
  ipcMain.handle('ext:add', (event) => addExtension())
  ipcMain.handle('ext:remove', (event, path: unknown) => removeExtension(str(path, 600)))
  ipcMain.handle('ext:reveal', (event, path: unknown) => revealExtension(str(path, 600)))

  /* ---- filter lists ---- */
  ipcMain.handle('filters:status', (event) => filterStatus())
  ipcMain.handle('filters:refresh', (event) => loadFilters(true))

  /* ---- import from another browser ---- */
  ipcMain.handle('import:sources', (event) => detectSources())
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
    current(event).handleAutofillForm(event.sender.id, str(data.host, 200))
  })
  ipcMain.on('autofill:submitted', (event, payload: unknown) => {
    const data = (payload ?? {}) as { host?: string; username?: string; password?: string }
    current(event as unknown as Electron.IpcMainInvokeEvent).handleAutofillSubmitted(str(data.host, 200), str(data.username, 200), str(data.password, 400))
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
