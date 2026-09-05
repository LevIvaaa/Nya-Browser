import {
  BaseWindow,
  WebContentsView,
  app,
  dialog,
  screen,
  session,
  shell,
  type Session,
  type WebContents
} from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { URL } from 'url'
import { settings } from './settings'
import { history } from './history'
import { bookmarks } from './bookmarks'
import { favicons } from './favicons'
import { vault } from './vault'
import { profiles } from './profiles'
import { downloads } from './downloads'
import { attachLog } from './log'
import { looksLikePdf, pdfSource, pdfViewerUrl } from './pdf'
import { WALLPAPER_EXTENSIONS, registerProtocols } from './protocol'
import { groupContextMenu, pageContextMenu, tabContextMenu, uiContextMenu } from './menus'
import { acceptLanguages, t } from './i18n'
import {
  allowHttpFallback,
  clearBrowsingData,
  documentHosts,
  hardenSession,
  isHttpsFallback,
  perTabBlocked,
  refreshCustomLists,
  resetStats,
  setPermissionPrompt,
  stats, isBlockedPopup } from './security'
import { engine, hideCss } from './filters'
import { loadExtensions, setExtensionSession } from './extensions'
import { normalizeInput } from '../shared/search'
import type {
  ContentLayout,
  InternalPage,
  PermissionRequest,
  Profile,
  Suggestion,
  TabGroup,
  TabState,
  UpdateState,
  WindowState
} from '../shared/types'

export const START_URL = 'nya://start'

/** A world of our own, so the survey cannot be observed or broken by the page. */
const COSMETIC_WORLD = 1000

/**
 * Collects the class names and ids the document actually uses. Capped, because
 * on a huge page walking every element is not free and the tail adds nothing.
 */
const SURVEY_SCRIPT = `(() => {
  const classes = new Set(), ids = new Set()
  const nodes = document.querySelectorAll('[class],[id]')
  const limit = Math.min(nodes.length, 20000)
  for (let i = 0; i < limit; i++) {
    const el = nodes[i]
    if (el.id) ids.add(el.id)
    const list = el.classList
    for (let j = 0; j < list.length; j++) classes.add(list[j])
  }
  return { classes: [...classes], ids: [...ids] }
})()`

/** Selectors already injected, per webContents, so a re-survey only adds new ones. */
const cosmeticSeen = new Map<number, Set<string>>()

const hostOfUrl = (raw: string): string => {
  try {
    return new URL(raw).hostname
  } catch {
    return ''
  }
}
const isDev = !app.isPackaged

interface PersistedTab {
  url: string
  title: string
  favicon: string | null
  pinned?: boolean
  groupId?: number | null
}

/**
 * The colours a group can wear. Kept short on purpose: a group is told apart
 * by its name and its place, and a palette of thirty is a palette of none.
 */
export const GROUP_COLOURS = [
  '#7c6cff',
  '#2fbf71',
  '#f5a524',
  '#e5484d',
  '#38bdf8',
  '#e879f9',
  '#94a3b8'
] as const

/* ========================================================================= */
/* Tab                                                                        */
/* ========================================================================= */
/** Title and tab icon for each of the browser's own pages. */
const INTERNAL_PAGES: Record<InternalPage, string> = {
  settings: 'Настройки',
  history: 'История',
  downloads: 'Загрузки',
  bookmarks: 'Закладки',
  passwords: 'Пароли'
}

class Tab {
  readonly id: number
  view: WebContentsView | null = null
  /** set for a tab that holds one of the browser's own pages */
  internal: InternalPage | null = null
  /** pinned tabs sit at the front of the strip, narrow and hard to lose */
  pinned = false
  /** the group this tab belongs to, if any */
  groupId: number | null = null
  title = t('Новая вкладка')
  url = START_URL
  favicon: string | null = null
  loading = false
  progress = 0
  hasContent = false
  upgraded = false
  /** the page asked for HTML fullscreen (a video, usually) */
  htmlFullscreen = false
  error: TabState['error'] = null
  lastActive = Date.now()
  private pendingUrl: string | null = null

  constructor(id: number, private readonly ses: Session) {
    this.id = id
  }

  get sleeping() {
    // Our own pages are drawn by the chrome renderer and never own a view, so
    // "no view" does not mean the tab was put to sleep.
    return this.internal === null && this.view === null && this.hasContent
  }

  get wc() {
    return this.view?.webContents ?? null
  }

  get muted() {
    const wc = this.wc
    return wc && !wc.isDestroyed() ? wc.isAudioMuted() : false
  }

  /** Creates the native view on demand: restored tabs cost nothing until used. */
  ensureView(wire: (tab: Tab) => void): boolean {
    // A settings tab has nothing to render in a web view, and giving it one
    // would put a blank page over the interface.
    if (this.internal) return false
    if (this.view) return false
    this.view = new WebContentsView({
      webPreferences: {
        session: this.ses,
        // No page-specific preload: the autofill script is registered on the
        // session instead, and the browser API is never exposed to pages.
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        // The session decides whether the checker actually runs; this only lets
        // Blink report misspellings so the context menu can offer fixes.
        spellcheck: true,
        // Chromium's built-in PDF viewer. Without it every PDF link downloads
        // instead of opening, which is unusable day to day.
        plugins: true,
        safeDialogs: true,
        safeDialogsMessage: t('Страница показывает диалоги слишком часто'),
        backgroundThrottling: true,
        autoplayPolicy: 'document-user-activation-required',
        v8CacheOptions: 'code',
        enableBlinkFeatures: '',
        navigateOnDragDrop: false
      }
    })
    this.view.setVisible(false)
    this.view.setBackgroundColor('#00000000')
    wire(this)
    if (this.pendingUrl) {
      const url = this.pendingUrl
      this.pendingUrl = null
      void this.view.webContents.loadURL(url)
    }
    return true
  }

  /**
   * `target` is what the view is actually sent to. It differs from `url` only
   * for the PDF viewer: the address stays what the reader asked for, so the
   * address bar, bookmarks, history and the restored session all carry the
   * document rather than the machinery that opens it. Callers that already know
   * a response is a PDF pass the viewer explicitly — the address alone cannot
   * always tell.
   */
  load(url: string, target = looksLikePdf(url) ? pdfViewerUrl(url) : url) {
    this.hasContent = true
    this.url = url
    this.error = null
    if (this.wc) void this.wc.loadURL(target)
    else this.pendingUrl = target
  }

  /** Frees the renderer process but keeps the tab in the strip. */
  sleep(parent: BaseWindow) {
    if (!this.view || !this.hasContent) return
    parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) {
      perTabBlocked.delete(this.view.webContents.id)
      documentHosts.delete(this.view.webContents.id)
      cosmeticSeen.delete(this.view.webContents.id)
      this.view.webContents.close()
    }
    this.view = null
    this.pendingUrl = this.url
    this.loading = false
    this.progress = 0
  }

  destroy(parent: BaseWindow) {
    if (!this.view) return
    parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) {
      perTabBlocked.delete(this.view.webContents.id)
      documentHosts.delete(this.view.webContents.id)
      cosmeticSeen.delete(this.view.webContents.id)
      this.view.webContents.close()
    }
    this.view = null
  }

  serialize(activeId: number): TabState {
    const wc = this.wc && !this.wc.isDestroyed() ? this.wc : null
    let origin = ''
    let secure = true
    try {
      const parsed = new URL(this.url)
      origin = parsed.hostname.replace(/^www\./, '')
      secure = parsed.protocol === 'https:' || parsed.protocol === 'nya:' || parsed.protocol === 'file:'
    } catch {
      origin = ''
    }
    return {
      id: this.id,
      internal: this.internal,
      pinned: this.pinned,
      groupId: this.groupId,
      title: this.title || origin || t('Новая вкладка'),
      // Our own pages leave the address bar empty: it is a place to type, and
      // "nya://settings" is not an address anyone needs to see or return to.
      url: this.url === START_URL || this.internal ? '' : this.url,
      displayUrl: this.url === START_URL || this.internal ? '' : prettyUrl(this.url),
      origin,
      favicon: this.favicon,
      loading: this.loading,
      progress: this.progress,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
      active: this.id === activeId,
      hasContent: this.hasContent,
      secure,
      upgraded: this.upgraded,
      blocked: wc ? perTabBlocked.get(wc.id) ?? 0 : 0,
      sleeping: this.sleeping,
      muted: this.muted,
      audible: wc ? wc.isCurrentlyAudible() : false,
      zoom: wc ? Math.round(wc.getZoomLevel() * 10) / 10 : 0,
      error: this.error
    }
  }
}

function prettyUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const path = url.pathname === '/' ? '' : url.pathname
    return decodeURI(url.hostname.replace(/^www\./, '') + path + url.search)
  } catch {
    return raw
  }
}

/* ========================================================================= */
/* Window                                                                     */
/* ========================================================================= */
export class BrowserWindow {
  win: BaseWindow
  chrome: WebContentsView
  /** Transparent layer above the page: menus, popovers and the command palette. */
  overlay: WebContentsView
  tabs: Tab[] = []
  activeId = -1

  private seq = 0
  private ses!: Session
  /** named runs of tabs; see reorderStrip for what keeps them runs */
  groups: TabGroup[] = []
  private groupSeq = 0
  private closedStack: PersistedTab[] = []
  private layoutRect: ContentLayout = { x: 0, y: 96, width: 0, height: 0, visible: true }
  private broadcastTimer: NodeJS.Timeout | null = null
  private sleepTimer: NodeJS.Timeout | null = null
  private edgeTimer: NodeJS.Timeout | null = null
  private edgeActive = false
  private confirmedClose = false
  private boundsFile = join(app.getPath('userData'), 'window.json')
  private offsetFromFirst = false
  private pendingPermissions = new Map<string, (allow: boolean) => void>()
  private preloadId: string | null = null
  private overlayMode: string | null = null

  /** How many windows are already up, so the next one is not stacked on them. */
  private static open = 0
  /** Numbers the throwaway sessions private windows run in. */
  private static privateSeq = 0

  /**
   * A private window keeps nothing: its session is in memory only, so cookies,
   * storage and the cache die with the window, and everything this browser
   * writes for itself — history, the icon cache, the saved session — skips it.
   */
  readonly incognito: boolean
  /** window was windowed when a page went HTML-fullscreen; restore on leave */
  private windowedBeforeHtmlFullscreen = false

  constructor(incognito = false) {
    this.incognito = incognito
    const saved = this.readBounds()
    const offset = BrowserWindow.open++ * 32
    this.offsetFromFirst = offset > 0
    if (offset && typeof saved.x === 'number' && typeof saved.y === 'number') {
      saved.x += offset
      saved.y += offset
    }

    // titleBarStyle is macOS-only on purpose: on Windows it makes
    // getContentBounds() disagree with the real window size, which painted a
    // bare strip of window background along the bottom edge.
    this.win = new BaseWindow({
      ...saved,
      minWidth: 720,
      minHeight: 480,
      frame: false,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 16 } }
        : {}),
      backgroundColor: '#0c0d12',
      roundedCorners: true,
      show: false,
      title: 'Nya Browser',
      icon: appIcon()
    })

    this.chrome = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        v8CacheOptions: 'code'
      }
    })
    this.win.contentView.addChildView(this.chrome)
    attachLog(this.chrome.webContents, 'chrome')

    // Popovers cannot be drawn by the chrome view: the page sits above it in a
    // native layer. They live in this overlay instead, which is stacked on top
    // of everything and stays invisible (and click-through) while unused.
    this.overlay = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        transparent: true,
        v8CacheOptions: 'code'
      }
    })
    this.overlay.setBackgroundColor('#00000000')
    this.overlay.setVisible(false)
    this.win.contentView.addChildView(this.overlay)
    attachLog(this.overlay.webContents, 'overlay')

    this.bindSession()

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (isDev && devUrl) {
      void this.chrome.webContents.loadURL(devUrl)
      void this.overlay.webContents.loadURL(`${devUrl}?overlay=1`)
    } else {
      const file = join(__dirname, '../renderer/index.html')
      void this.chrome.webContents.loadFile(file)
      void this.overlay.webContents.loadFile(file, { query: { overlay: '1' } })
    }

    // Right-click in the browser's own surfaces: the palette, the find bar,
    // the settings fields. Pages get the richer menu attached per tab.
    this.chrome.webContents.on('context-menu', (_e, params) => uiContextMenu(this.chrome.webContents, params))
    this.overlay.webContents.on('context-menu', (_e, params) => uiContextMenu(this.overlay.webContents, params))

    this.overlay.webContents.on('before-input-event', (event, input) => {
      if (this.handleInput(input, true, this.overlay.webContents)) event.preventDefault()
    })

    this.chrome.webContents.once('did-finish-load', () => {
      if (this.win.isDestroyed()) return
      this.win.show()
      this.win.focus()
      this.chrome.webContents.focus()
      // The focus event above can beat the renderer's first listener, and a
      // private window that does not know it is private is just a window.
      this.sendWindowState()
    })

    this.chrome.webContents.on('before-input-event', (event, input) => {
      if (this.handleInput(input, true, this.chrome.webContents)) event.preventDefault()
    })

    // The chrome UI must never navigate away from itself.
    this.chrome.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(devUrl ?? 'file://')) event.preventDefault()
    })
    this.chrome.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.newTab(url)
      return { action: 'deny' }
    })

    this.layout()
    const onWindowChange = () => {
      this.layout()
      this.sendWindowState()
      this.saveBounds()
    }
    this.win.on('resize', () => this.layout())
    this.win.on('resized', onWindowChange)
    this.win.on('moved', () => this.saveBounds())
    this.win.on('maximize', onWindowChange)
    this.win.on('unmaximize', onWindowChange)
    this.win.on('enter-full-screen', onWindowChange)
    this.win.on('leave-full-screen', () => {
      // F11 out while a video is fullscreen: the page must follow the window,
      // or its view would keep covering the toolbar of a windowed browser.
      const active = this.getActive()
      if (active?.htmlFullscreen) this.exitHtmlFullscreen(active)
      onWindowChange()
    })
    this.win.on('focus', () => {
      this.sendWindowState()
      this.focusView()
    })
    this.win.on('blur', () => this.sendWindowState())

    this.win.on('close', (event) => {
      if (this.shouldConfirmClose()) {
        const loaded = this.tabs.filter((t) => t.hasContent).length
        const choice = dialog.showMessageBoxSync(this.win, {
          type: 'question',
          buttons: [t('Закрыть все'), t('Отмена')],
          defaultId: 1,
          cancelId: 1,
          title: t('Закрыть Nya Browser'),
          message: t('Открыто вкладок: {n}', { n: loaded }),
          detail: t('Закрыть браузер вместе со всеми вкладками?')
        })
        if (choice === 1) {
          event.preventDefault()
          return
        }
        this.confirmedClose = true
      }
      this.persistSession()
      this.saveBounds()
      settings.flush()
      history.flush()
      bookmarks.flush()
      vault.flush()
      favicons.flush()
    })

    setPermissionPrompt((request) => this.askPermission(request))
    downloads.onChange((items) => this.send('state:downloads', items))

    this.startSleepLoop()
    this.startEdgeWatch()
  }

  /* ------------------------------------------------------------- profiles */
  /** Binds the window to the active profile's session and data stores. */
  private bindSession() {
    const dir = profiles.dir()
    settings.load(dir)
    history.load(dir)
    favicons.load(dir)
    history.setEnabled(settings.get().saveHistory)
    bookmarks.load(dir)
    // Held shut on purpose when the setting says to ask: the OS keychain would
    // otherwise open the vault before anyone had been asked anything.
    vault.load(dir, settings.get().passwordsAskOnStart)
    refreshCustomLists()

    // No "persist:" prefix means Chromium keeps it in memory and throws it
    // away with the window.
    this.ses = this.incognito
      ? session.fromPartition(`nya-private-${++BrowserWindow.privateSeq}`)
      : session.fromPartition(profiles.partition())
    registerProtocols(this.ses)
    this.applyAcceptLanguage()
    hardenSession(
      this.ses,
      (id) => {
        if (this.getActive()?.wc?.id === id) this.broadcast()
      },
      // A PDF at an address that does not end in .pdf: the response was refused
      // before it could commit as a blank page, so the tab goes to the viewer
      // with no dead entry left behind it in the history.
      (id, url) => {
        const tab = this.tabs.find((t) => t.wc?.id === id)
        if (!tab) return
        // Explicitly the viewer: the address says nothing about being a PDF, so
        // loading it again would only be refused again, forever.
        tab.load(url, pdfViewerUrl(url))
        this.broadcast()
      }
    )
    downloads.attach(this.ses)

    // Extensions belong to the profile, and Chromium keeps no registry of them,
    // so every launch and every profile switch loads them again. A private
    // window loads none: an extension sees every page, and the point here is
    // that nothing does.
    if (!this.incognito) {
      setExtensionSession(this.ses)
      void loadExtensions(this.ses)
    }

    // The autofill script lives on the session, so it applies to every page in
    // this profile and to none of the chrome UI.
    try {
      this.preloadId = this.ses.registerPreloadScript({
        id: `nya-autofill-${profiles.activeId}`,
        type: 'frame',
        filePath: join(__dirname, '../preload/content.js')
      })
    } catch {
      this.preloadId = null
    }
  }

  switchProfile(id: string) {
    if (id === profiles.activeId) return
    this.persistSession()
    settings.flush()
    history.flush()
    bookmarks.flush()
    vault.flush()

    for (const tab of [...this.tabs]) tab.destroy(this.win)
    this.tabs = []
    this.activeId = -1
    this.closedStack = []
    resetStats()

    profiles.setActive(id)
    this.bindSession()
    this.applySettings()
    this.sendProfiles()
    // The renderer caches these lists — hand it the new profile's data.
    this.send('state:bookmarks', bookmarks.all())
    this.send('state:downloads', downloads.list())
    this.send('state:closed', [])
    // The saved session belongs to the browser, not to every window of it: a
    // second window starts empty rather than cloning the first.
    if (this.incognito || this.offsetFromFirst || !this.restoreSession()) this.newTab()
    this.broadcast()
  }

  sendProfiles() {
    this.send('state:profiles', profiles.state)
  }

  currentProfile(): Profile {
    return profiles.active
  }

  /* ------------------------------------------------------- window bounds */
  private readBounds() {
    const fallback = { width: 1360, height: 880 }
    try {
      const raw = JSON.parse(readFileSync(this.boundsFile, 'utf8'))
      const area = screen.getPrimaryDisplay().workArea
      const width = Math.min(Math.max(720, raw.width ?? fallback.width), area.width)
      const height = Math.min(Math.max(480, raw.height ?? fallback.height), area.height)
      const onScreen = screen
        .getAllDisplays()
        .some((d) => raw.x >= d.bounds.x - 40 && raw.x < d.bounds.x + d.bounds.width)
      return onScreen && typeof raw.x === 'number'
        ? { x: raw.x, y: raw.y, width, height }
        : { width, height }
    } catch {
      return fallback
    }
  }

  private saveBounds() {
    // Two windows would otherwise take turns overwriting each other's idea of
    // where a window belongs.
    if (this.offsetFromFirst) return

    if (this.win.isDestroyed() || this.win.isMinimized()) return
    try {
      const bounds = this.win.isMaximized() ? this.win.getNormalBounds() : this.win.getBounds()
      writeFileSync(this.boundsFile + '.tmp', JSON.stringify(bounds), 'utf8')
      renameSync(this.boundsFile + '.tmp', this.boundsFile)
    } catch {
      /* best effort */
    }
  }

  /* -------------------------------------------------------------- layout */
  setLayout(rect: ContentLayout) {
    const wasVisible = this.layoutRect.visible
    this.layoutRect = rect
    this.layout()
    const active = this.getActive()
    if (active?.view) {
      active.view.setVisible(rect.visible && active.hasContent && !active.sleeping)
    }
    if (wasVisible !== rect.visible) this.focusView()
  }

  layout() {
    if (this.win.isDestroyed()) return
    // Frameless windows should report identical bounds/contentBounds, but on
    // Windows they can differ by the invisible frame — take the larger size so
    // the chrome always covers the whole window.
    const bounds = this.win.getBounds()
    const content = this.win.getContentBounds()
    const w = Math.max(bounds.width, content.width)
    const h = Math.max(bounds.height, content.height)
    this.chrome.setBounds({ x: 0, y: 0, width: w, height: h })
    this.overlay.setBounds({ x: 0, y: 0, width: w, height: h })

    const active = this.getActive()
    if (!active?.view) return

    // A page in HTML fullscreen owns the window, toolbar included.
    if (active.htmlFullscreen) {
      active.view.setBounds({ x: 0, y: 0, width: w, height: h })
      active.view.setBorderRadius(0)
      active.view.setVisible(active.hasContent && !active.sleeping)
      return
    }

    const r = this.layoutRect
    const rect = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width || w),
      height: Math.round(r.height || Math.max(0, h - r.y))
    }
    active.view.setBounds(rect)
    const radius = settings.get().radius
    active.view.setBorderRadius(rect.y > 4 ? Math.min(radius, 18) : 0)
    active.view.setVisible(r.visible && active.hasContent && !active.sleeping)
  }

  /**
   * Opens one of the browser's own pages. They are tabs like any other, so a
   * new tab opened next to them is a new tab and does not take their place,
   * and the tab strip names them.
   */
  openChromePage(page: string) {
    const [name, section] = page.split('#')
    const internal = name as InternalPage
    if (!(internal in INTERNAL_PAGES)) return

    const existing = this.tabs.find((t) => t.internal === internal)
    if (existing) {
      this.switchTab(existing.id)
    } else {
      const tab = new Tab(++this.seq, this.ses)
      tab.internal = internal
      tab.title = t(INTERNAL_PAGES[internal])
      tab.url = `nya://${internal}`
      const insertAt = this.tabs.findIndex((t) => t.id === this.activeId) + 1
      this.tabs.splice(insertAt > 0 ? insertAt : this.tabs.length, 0, tab)
      this.activeId = tab.id
      this.showActive()
      this.broadcast()
    }

    // The section is a hint for the page itself, not tab state.
    if (section) this.chrome.webContents.send('state:page-section', `${internal}#${section}`)
  }

  /**
   * Shows or hides the overlay layer. While hidden it is not just transparent
   * but invisible, so it never swallows clicks meant for the page.
   */
  setOverlayMode(mode: string | null) {
    this.overlayMode = mode
    const visible = mode !== null
    this.raiseOverlay()
    this.overlay.setVisible(visible)
    this.overlay.webContents.send('state:overlay', mode)
    this.chrome.webContents.send('state:overlay', mode)
    if (visible) this.overlay.webContents.focus()
    else this.focusView()
  }

  /**
   * A BaseWindow takes no keyboard input itself — the focused child view does.
   * Keep focus on the page while browsing and on the chrome UI otherwise.
   */
  focusView() {
    if (this.win.isDestroyed()) return
    const active = this.getActive()
    const pageVisible = this.layoutRect.visible && active?.hasContent && !active.sleeping
    const target = pageVisible ? active?.wc : this.chrome.webContents
    if (target && !target.isDestroyed()) target.focus()
  }

  /* ------------------------------------------------------------ broadcast */
  private send(channel: string, payload?: unknown) {
    if (!this.chrome.webContents.isDestroyed()) this.chrome.webContents.send(channel, payload)
    // The overlay renders from the same state, so it gets every update too.
    if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.send(channel, payload)
  }

  private broadcast() {
    if (this.broadcastTimer) return
    // Coalesce bursts (loading + title + favicon arrive together) into one frame.
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.send('state:tabs', this.tabs.map((t) => t.serialize(this.activeId)))
      this.send('state:security', { ...stats })
    }, 16)
  }

  /**
   * Tells sites which language this browser speaks. YouTube greeting you in
   * the language you picked in the installer is this header.
   */
  applyAcceptLanguage() {
    const wanted = settings.get().language
    if (!wanted) return
    try {
      this.ses.setUserAgent(this.ses.getUserAgent(), acceptLanguages(wanted, app.getLocale()))
    } catch {
      /* before ready, the default stands */
    }
  }

  /** Re-titles the browser's own tabs after a language switch. */
  retitleInternalTabs() {
    for (const tab of this.tabs) {
      if (tab.internal) tab.title = t(INTERNAL_PAGES[tab.internal])
      else if (!tab.hasContent && tab.url === START_URL) tab.title = t('Новая вкладка')
    }
    this.broadcast()
  }

  sendWindowState() {
    const state: WindowState = {
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      focused: this.win.isFocused(),
      platform: process.platform,
      incognito: this.incognito
    }
    this.send('state:window', state)
  }

  sendShortcut(action: string) {
    this.send('shortcut', action)
  }

  applySettings() {
    const s = settings.get()
    this.startEdgeWatch()
    history.setEnabled(s.saveHistory)
    refreshCustomLists()
    hardenSession(this.ses)
    this.layout()
    this.send('state:settings', s)
  }

  /* ---------------------------------------------------------- tab wiring */
  private wire = (tab: Tab) => {
    const wc = tab.wc
    if (!wc) return
    attachLog(wc, `tab${tab.id}`)
    wc.setZoomLevel(settings.get().defaultZoom)

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      if (!this.incognito) history.updateTitle(tab.url, title)
      this.broadcast()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      tab.favicon = icons[icons.length - 1] ?? null
      this.broadcast()
      // Kept so the start page can draw a real icon on its tiles without
      // going out to the site every time it opens.
      if (tab.favicon && !this.incognito) void favicons.remember(tab.url, tab.favicon, this.ses)
    })
    wc.on('did-start-loading', () => {
      tab.loading = true
      tab.progress = 0.08
      tab.error = null
      this.broadcast()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      tab.progress = 1
      // The viewer's own address never reaches the address bar; see Tab.load.
      tab.url = pdfSource(wc.getURL()) ?? wc.getURL() ?? tab.url
      this.broadcast()
      setTimeout(() => {
        tab.progress = 0
        this.broadcast()
      }, 260)
    })
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame) return
      // Subresources of the page being loaded must be judged against the page
      // they belong to, so this has to be set before they start arriving.
      documentHosts.set(wc.id, hostOfUrl(details.url))
      // Injected CSS does not survive a new document, so the record of what has
      // already been injected must not either.
      cosmeticSeen.delete(wc.id)
      tab.progress = 0.25
      this.broadcast()
    })
    wc.on('dom-ready', () => {
      void this.applyCosmetic(wc)
      // Much of the ad furniture arrives after DOMContentLoaded.
      setTimeout(() => void this.applyCosmetic(wc), 1500)
    })
    wc.on('did-navigate', (_e, raw) => {
      const url = pdfSource(raw) ?? raw
      tab.url = url
      documentHosts.set(wc.id, hostOfUrl(url))
      tab.progress = 0.7
      tab.upgraded = url.startsWith('https://')
      if (!this.incognito) history.record(url, tab.title)
      this.persistSession()
      this.broadcast()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      // A route change in a single-page app brings a whole new set of elements.
      void this.applyCosmetic(wc)
      tab.url = url
      if (!this.incognito) history.record(url, tab.title)
      this.broadcast()
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        /* keep empty */
      }
      const tlsProblem = HTTPS_UNAVAILABLE.has(code)
      if (settings.get().httpsOnly && host && !isHttpsFallback(host) && tlsProblem) {
        // The site simply has no HTTPS endpoint: offer plain HTTP instead of
        // silently downgrading.
        tab.loading = false
        tab.error = {
          code,
          description: description || t('Сайт не отвечает по HTTPS'),
          url,
          httpsFallbackAvailable: url.startsWith('https://')
        }
        this.broadcast()
        return
      }
      tab.loading = false
      tab.error = { code, description: description || t('Не удалось загрузить страницу'), url }
      this.broadcast()
    })
    wc.on('render-process-gone', (_e, details) => {
      tab.loading = false
      tab.error = {
        code: -1,
        description: t('Страница неожиданно завершила работу ({reason})', { reason: details.reason }),
        url: tab.url
      }
      this.broadcast()
    })
    wc.on('audio-state-changed', () => this.broadcast())
    wc.on('media-started-playing', () => this.broadcast())
    wc.on('media-paused', () => this.broadcast())
    wc.on('zoom-changed', () => this.broadcast())

    // HTML fullscreen — a video's ⛶ button. The view normally lives in the
    // strip below the toolbar, so without help "fullscreen" meant "the content
    // area": stretched, chrome still visible. The window goes fullscreen with
    // the page and comes back with it, unless it was already fullscreen (F11)
    // before the video asked.
    wc.on('enter-html-full-screen', () => {
      tab.htmlFullscreen = true
      if (!this.win.isFullScreen()) {
        this.windowedBeforeHtmlFullscreen = true
        this.win.setFullScreen(true)
      }
      this.layout()
      this.sendWindowState()
    })
    wc.on('leave-html-full-screen', () => {
      tab.htmlFullscreen = false
      if (this.windowedBeforeHtmlFullscreen) {
        this.windowedBeforeHtmlFullscreen = false
        this.win.setFullScreen(false)
      }
      this.layout()
      this.sendWindowState()
    })

    // A link to a PDF, clicked on a page. Chromium would navigate to it and
    // hand us a blank document, so the tab goes to the viewer instead and the
    // address bar keeps saying the document.
    wc.on('will-navigate', (event, url) => {
      if (!looksLikePdf(url)) return
      event.preventDefault()
      tab.load(url)
      this.broadcast()
    })

    wc.on('context-menu', (_e, params) => pageContextMenu(this, wc, params))

    wc.on('before-input-event', (event, input) => {
      if (this.handleInput(input, false)) event.preventDefault()
    })

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^https?:/i.test(url)) {
        if (/^(mailto|tel):/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      }
      // A popup aimed at an ad network is a popunder; it does not get a tab.
      if (isBlockedPopup(url, documentHosts.get(wc.id) ?? '')) return { action: 'deny' }
      // A page that asked for a window gets a window; everything else is a
      // tab, which is what people mean by "open in new tab" anyway.
      if (disposition === 'new-window') {
        this.chrome.webContents.send('shortcut', `new-window:${url}`)
        return { action: 'deny' }
      }
      this.newTab(url, disposition === 'background-tab')
      return { action: 'deny' }
    })

    // Warm up the connection while the user is still deciding to click.
    wc.on('update-target-url', (_e, url) => {
      if (settings.get().preconnect && /^https:/i.test(url)) {
        try {
          this.ses.preconnect({ url: new URL(url).origin, numSockets: 1 })
        } catch {
          /* ignore */
        }
      }
    })
  }

  /* ------------------------------------------------------------ shortcuts */
  handleInput(input: Electron.Input, fromChrome: boolean, wc?: Electron.WebContents): boolean {
    if (input.type !== 'keyDown') return false
    if (process.platform === 'darwin' && input.meta) return false
    const mod = process.platform === 'darwin' ? input.meta : input.control
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key

    // Без нативного меню Windows не даёт полям браузера стандартных клавиш
    // редактирования — Ctrl+V в палитре просто молчал. Только для своих
    // поверхностей: страницам сайтов эти клавиши нужны сырыми.
    if (fromChrome && wc && mod && !input.alt) {
      if (input.shift) {
        if (key === 'z') return this.run(() => wc.redo())
      } else {
        switch (key) {
          case 'c':
            return this.run(() => wc.copy())
          case 'x':
            return this.run(() => wc.cut())
          case 'v':
            return this.run(() => wc.paste())
          case 'a':
            return this.run(() => wc.selectAll())
          case 'z':
            return this.run(() => wc.undo())
          case 'y':
            return this.run(() => wc.redo())
        }
      }
    }

    if (key === 'F5') return this.run(() => this.reload(input.shift))
    if (key === 'F11') return this.run(() => this.win.setFullScreen(!this.win.isFullScreen()))
    if (key === 'F12') return this.run(() => this.openDevTools())
    if (key === 'F6') return this.run(() => this.focusAddress())
    if (key === 'Escape' && !fromChrome) return this.run(() => this.stop())

    if (input.alt && !mod) {
      if (key === 'ArrowLeft') return this.run(() => this.goBack())
      if (key === 'ArrowRight') return this.run(() => this.goForward())
      if (key === 'd') return this.run(() => this.focusAddress())
      return false
    }

    if (!mod) return false

    if (input.shift) {
      switch (key) {
        case 'n':
          return this.run(() => this.chrome.webContents.send('shortcut', 'new-private-window'))
        case 't':
          return this.run(() => this.reopenClosed())
        case 'r':
          return this.run(() => this.reload(true))
        case 'b':
          return this.run(() => this.uiShortcut('toggle-tabs'))
        case 'p':
          return this.run(() => this.uiShortcut('profiles'))
        case 'o':
          return this.run(() => this.uiShortcut('bookmarks'))
        case 'Tab':
          return this.run(() => this.cycleTab(-1))
        case 'Delete':
          return this.run(() => this.uiShortcut('clear-data'))
        default:
          return false
      }
    }

    switch (key) {
      case 'n':
        return this.run(() => this.chrome.webContents.send('shortcut', 'new-window'))
      case 't':
        return this.run(() => this.newTab())
      case 'w':
        return this.run(() => this.closeTab(this.activeId))
      case 'l':
        return this.run(() => this.focusAddress())
      case 'r':
        return this.run(() => this.reload())
      case 'd':
        return this.run(() => this.bookmarkCurrent())
      case 'f':
        return this.run(() => this.uiShortcut('find'))
      case 'j':
        return this.run(() => this.uiShortcut('downloads'))
      case 'h':
        return this.run(() => this.uiShortcut('history'))
      case ',':
        return this.run(() => this.uiShortcut('settings'))
      case 'Tab':
        return this.run(() => this.cycleTab(1))
      case '=':
      case '+':
        return this.run(() => this.setZoom(0.5))
      case '-':
        return this.run(() => this.setZoom(-0.5))
      case '0':
        return this.run(() => this.setZoom('reset'))
      default:
        if (/^[1-9]$/.test(key)) {
          const index = key === '9' ? this.tabs.length - 1 : Number(key) - 1
          const tab = this.tabs[index]
          return this.run(() => tab && this.switchTab(tab.id))
        }
        return false
    }
  }

  private run(fn: () => void): boolean {
    fn()
    return true
  }

  private uiShortcut(action: string) {
    this.chrome.webContents.focus()
    this.sendShortcut(action)
  }

  private focusAddress() {
    this.setOverlayMode('palette')
  }

  private cycleTab(delta: number) {
    if (this.tabs.length < 2) return
    const index = this.tabs.findIndex((t) => t.id === this.activeId)
    const next = this.tabs[(index + delta + this.tabs.length) % this.tabs.length]
    this.switchTab(next.id)
  }

  /* -------------------------------------------------------------- actions */
  newTab(url?: string, background = false): number {
    const tab = new Tab(++this.seq, this.ses)
    const insertAt = settings.get().newTabAfterCurrent
      ? this.tabs.findIndex((t) => t.id === this.activeId) + 1
      : this.tabs.length
    this.tabs.splice(insertAt > 0 ? insertAt : this.tabs.length, 0, tab)

    tab.ensureView(this.wire)
    if (tab.view) this.win.contentView.addChildView(tab.view)
    this.raiseOverlay()

    if (!background) this.activeId = tab.id
    if (url && url !== START_URL) tab.load(normalizeInput(url, settings.get()))

    this.showActive()
    this.persistSession()
    this.broadcast()
    return tab.id
  }

  switchTab(id: number) {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const previous = this.getActive()
    if (previous && previous.id !== id && previous.htmlFullscreen) {
      this.exitHtmlFullscreen(previous)
    }
    this.activeId = id
    tab.lastActive = Date.now()
    this.wake(tab)
    this.showActive()
    this.persistSession()
    this.broadcast()
  }

  /** Asks the page itself to leave fullscreen, so its player UI follows. */
  private exitHtmlFullscreen(tab: Tab) {
    const wc = tab.wc
    if (wc && !wc.isDestroyed()) {
      void wc.executeJavaScript('document.exitFullscreen?.()', true).catch(() => undefined)
    }
    tab.htmlFullscreen = false
  }

  /**
   * Turns one of the browser's own pages back into an ordinary tab. Internal
   * pages are painted by the chrome renderer and hold no view, so navigating
   * away from one has to build the view the site will land in — otherwise the
   * tab keeps showing settings while it believes it is loading a page.
   */
  private leaveInternal(tab: Tab) {
    if (!tab.internal) return
    tab.internal = null
    if (tab.ensureView(this.wire) && tab.view) {
      this.win.contentView.addChildView(tab.view)
      this.raiseOverlay()
    }
  }

  private wake(tab: Tab) {
    if (!tab.sleeping) return
    if (tab.ensureView(this.wire) && tab.view) {
      this.win.contentView.addChildView(tab.view)
      this.raiseOverlay()
    }
  }

  /** Re-adding moves a view to the top of the stack. */
  private raiseOverlay() {
    if (!this.win.isDestroyed()) this.win.contentView.addChildView(this.overlay)
  }

  closeTab(id: number) {
    const index = this.tabs.findIndex((t) => t.id === id)
    if (index === -1) return
    const [tab] = this.tabs.splice(index, 1)
    // Closing a fullscreen video's tab must not leave the window fullscreen:
    // the page dies without ever sending leave-html-full-screen.
    if (tab.htmlFullscreen && this.windowedBeforeHtmlFullscreen) {
      this.windowedBeforeHtmlFullscreen = false
      this.win.setFullScreen(false)
    }
    if (tab.hasContent) {
      this.closedStack.push({ url: tab.url, title: tab.title, favicon: tab.favicon })
      if (this.closedStack.length > 25) this.closedStack.shift()
      this.send('state:closed', this.closedStack.slice(-10).reverse())
    }
    tab.destroy(this.win)

    if (this.tabs.length === 0) {
      this.newTab()
      return
    }
    if (this.activeId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)]
      this.activeId = next.id
      this.wake(next)
    }
    this.showActive()
    this.persistSession()
    this.broadcast()
  }

  // Pinning a tab is a way of saying it should still be there later, so
  // neither of these takes it away.
  closeOthers(id: number) {
    for (const tab of [...this.tabs]) if (tab.id !== id && !tab.pinned) this.closeTab(tab.id)
  }

  closeToRight(id: number) {
    const index = this.tabs.findIndex((t) => t.id === id)
    if (index === -1) return
    for (const tab of this.tabs.slice(index + 1)) if (!tab.pinned) this.closeTab(tab.id)
  }

  reopenClosed() {
    const last = this.closedStack.pop()
    this.send('state:closed', this.closedStack.slice(-10).reverse())
    if (last) this.newTab(last.url)
  }

  recentlyClosed(): PersistedTab[] {
    return this.closedStack.slice(-10).reverse()
  }

  /**
   * The two rules the strip has to keep, applied after anything that could
   * break them: pinned tabs come first, and the members of a group sit next to
   * each other. A group is a place in the strip — if its tabs could scatter, the
   * name over them would be a lie — and a pinned tab that drifts into the middle
   * is a pinned tab you have to look for.
   *
   * Order is otherwise left alone: each group lands where its first member
   * already was, so grouping tabs does not rearrange the strip around them.
   */
  private reorderStrip() {
    const ordered: Tab[] = []
    const taken = new Set<number>()
    for (const pinnedPass of [true, false]) {
      for (const tab of this.tabs) {
        if (tab.pinned !== pinnedPass || taken.has(tab.id)) continue
        if (tab.groupId === null) {
          taken.add(tab.id)
          ordered.push(tab)
          continue
        }
        for (const member of this.tabs) {
          if (member.groupId !== tab.groupId || member.pinned !== pinnedPass) continue
          if (taken.has(member.id)) continue
          taken.add(member.id)
          ordered.push(member)
        }
      }
    }
    this.tabs = ordered
    // A group nobody is in is not a group.
    this.groups = this.groups.filter((group) => this.tabs.some((t) => t.groupId === group.id))
  }

  /** Groups travel with the tabs; the strip draws them in one pass. */
  private sendGroups() {
    this.send('state:groups', this.groups)
  }

  /* -------------------------------------------------------------- pinning */

  /**
   * A pinned tab leaves its group: it is going to the front of the strip, and a
   * group whose members are not together is not one.
   */
  pinTab(id: number, pinned?: boolean) {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    tab.pinned = pinned ?? !tab.pinned
    if (tab.pinned) tab.groupId = null
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  /* --------------------------------------------------------------- groups */

  /** A new group around one tab, ready to be renamed. */
  createGroup(tabId: number, name?: string) {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    tab.pinned = false
    const group: TabGroup = {
      id: ++this.groupSeq,
      name: name ?? t('Новая группа'),
      color: GROUP_COLOURS[this.groups.length % GROUP_COLOURS.length],
      collapsed: false
    }
    this.groups.push(group)
    tab.groupId = group.id
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  addToGroup(tabId: number, groupId: number) {
    const tab = this.tabs.find((t) => t.id === tabId)
    const group = this.groups.find((g) => g.id === groupId)
    if (!tab || !group) return
    tab.pinned = false
    tab.groupId = groupId
    // Moving a tab into a folded group would hide it the moment it arrives.
    group.collapsed = false
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  removeFromGroup(tabId: number) {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || tab.groupId === null) return
    tab.groupId = null
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  renameGroup(groupId: number, name: string) {
    const group = this.groups.find((g) => g.id === groupId)
    if (!group) return
    group.name = name.slice(0, 40).trim() || t('Новая группа')
    this.persistSession()
    this.sendGroups()
  }

  setGroupColour(groupId: number, color: string) {
    const group = this.groups.find((g) => g.id === groupId)
    if (!group || !(GROUP_COLOURS as readonly string[]).includes(color)) return
    group.color = color
    this.persistSession()
    this.sendGroups()
  }

  /**
   * Folding a group hides its tabs. The tab being read cannot be one of the
   * hidden ones, so if it is, the nearest tab outside the group takes over.
   */
  toggleGroup(groupId: number, collapsed?: boolean) {
    const group = this.groups.find((g) => g.id === groupId)
    if (!group) return
    const next = collapsed ?? !group.collapsed
    if (next && this.getActive()?.groupId === groupId) {
      const outside = this.tabs.filter((t) => t.groupId !== groupId)
      if (outside.length === 0) return
      const index = this.tabs.findIndex((t) => t.id === this.activeId)
      const after = this.tabs.slice(index).find((t) => t.groupId !== groupId)
      this.switchTab((after ?? outside[outside.length - 1]).id)
    }
    group.collapsed = next
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  ungroup(groupId: number) {
    for (const tab of this.tabs) if (tab.groupId === groupId) tab.groupId = null
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  closeGroup(groupId: number) {
    for (const tab of [...this.tabs]) if (tab.groupId === groupId) this.closeTab(tab.id)
    this.sendGroups()
  }

  moveTab(id: number, toIndex: number) {
    const from = this.tabs.findIndex((t) => t.id === id)
    if (from === -1) return
    const clamped = Math.max(0, Math.min(this.tabs.length - 1, toIndex))
    const [tab] = this.tabs.splice(from, 1)
    this.tabs.splice(clamped, 0, tab)
    // Dropped between two tabs of the same group, it joins them; dropped
    // anywhere else, it leaves whatever group it was in. Which is what the
    // drop looked like it meant.
    if (!tab.pinned) {
      const before = this.tabs[clamped - 1]?.groupId ?? null
      const after = this.tabs[clamped + 1]?.groupId ?? null
      tab.groupId = before !== null && before === after ? before : tab.groupId === before || tab.groupId === after ? tab.groupId : null
    }
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  duplicateTab(id: number) {
    const tab = this.tabs.find((t) => t.id === id)
    if (tab?.hasContent) this.newTab(tab.url, true)
  }

  toggleMute(id: number) {
    const wc = this.tabs.find((t) => t.id === id)?.wc
    if (wc && !wc.isDestroyed()) {
      wc.setAudioMuted(!wc.isAudioMuted())
      this.broadcast()
    }
  }

  sleepTab(id: number) {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || tab.id === this.activeId) return
    tab.sleep(this.win)
    this.broadcast()
  }

  reloadTab(id: number) {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.sleeping) return this.switchTab(id)
    tab.wc?.reload()
  }

  showTabMenu(id: number) {
    tabContextMenu(this, id)
  }

  showGroupMenu(groupId: number) {
    groupContextMenu(this, groupId)
  }

  /** A new tab that lands inside the group rather than after it. */
  newTabInGroup(groupId: number) {
    if (!this.groups.some((group) => group.id === groupId)) return
    const id = this.newTab()
    this.addToGroup(id, groupId)
  }

  navigate(input: string, id = this.activeId): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const url = normalizeInput(input, settings.get())
    if (url === START_URL) return this.goHome(id)
    this.leaveInternal(tab)
    this.wake(tab)
    tab.load(url)
    this.showActive()
    this.broadcast()
  }

  /** Retries a failed HTTPS-only navigation over plain HTTP, once, on request. */
  continueOverHttp(id = this.activeId) {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab?.error) return
    try {
      const url = new URL(tab.error.url)
      allowHttpFallback(url.hostname)
      url.protocol = 'http:'
      tab.load(url.toString())
      this.broadcast()
    } catch {
      /* malformed url */
    }
  }

  private withActive(fn: (wc: Electron.WebContents) => void) {
    const wc = this.getActive()?.wc
    if (wc && !wc.isDestroyed()) fn(wc)
  }

  goBack() {
    this.withActive((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack())
  }
  goForward() {
    this.withActive((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward())
  }
  reload(ignoreCache = false) {
    const tab = this.getActive()
    if (!tab) return
    if (tab.sleeping) return this.switchTab(tab.id)
    if (tab.error) return tab.load(tab.error.url)
    this.withActive((wc) => (ignoreCache ? wc.reloadIgnoringCache() : wc.reload()))
  }
  stop() {
    this.withActive((wc) => wc.stop())
  }

  goHome(id = this.activeId): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const homepage = settings.get().homepage
    if (homepage) return this.navigate(homepage, id)

    tab.destroy(this.win)
    tab.internal = null
    tab.hasContent = false
    tab.url = START_URL
    tab.title = t('Новая вкладка')
    tab.favicon = null
    tab.error = null
    tab.ensureView(this.wire)
    if (tab.view) this.win.contentView.addChildView(tab.view)
    this.raiseOverlay()
    this.showActive()
    this.broadcast()
  }

  setZoom(delta: number | 'reset') {
    this.withActive((wc) => {
      const next = delta === 'reset' ? settings.get().defaultZoom : Math.max(-3, Math.min(4, wc.getZoomLevel() + delta))
      wc.setZoomLevel(next)
      this.broadcast()
    })
  }

  find(text: string, forward = true) {
    this.withActive((wc) => {
      if (text) wc.findInPage(text, { forward, findNext: false })
      else wc.stopFindInPage('clearSelection')
    })
  }
  stopFind() {
    this.withActive((wc) => wc.stopFindInPage('clearSelection'))
  }

  openDevTools() {
    this.withActive((wc) => wc.openDevTools({ mode: 'detach' }))
  }

  openExternal(url: string) {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  }

  print() {
    this.withActive((wc) => wc.print({}))
  }

  /* ------------------------------------------------------------ bookmarks */
  bookmarkCurrent() {
    const tab = this.getActive()
    if (!tab?.hasContent || !/^https?:/i.test(tab.url)) return
    const result = bookmarks.toggle({ title: tab.title, url: tab.url })
    this.send('state:bookmarks', bookmarks.all())
    this.send('toast', result.added ? t('Добавлено в закладки') : t('Убрано из закладок'))
  }

  bookmarkTab(id: number) {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab?.hasContent || !/^https?:/i.test(tab.url)) return
    bookmarks.add({ title: tab.title, url: tab.url })
    this.send('state:bookmarks', bookmarks.all())
    this.send('toast', t('Добавлено в закладки'))
  }

  /**
   * Hides what the network blocker cannot: the empty frames and banner shells
   * left behind on the page. Only selectors whose class or id the document
   * actually uses are sent, and a re-survey injects just the new ones.
   */
  private async applyCosmetic(wc: WebContents) {
    if (!settings.get().cosmeticFiltering || !engine.ready) return
    if (wc.isDestroyed()) return
    const host = hostOfUrl(wc.getURL())
    if (!host) return

    let survey: { classes?: string[]; ids?: string[] } | null = null
    try {
      survey = await wc.executeJavaScriptInIsolatedWorld(COSMETIC_WORLD, [{ code: SURVEY_SCRIPT }])
    } catch {
      return // the page went away, or scripts cannot run there
    }
    if (!survey || wc.isDestroyed()) return

    let seen = cosmeticSeen.get(wc.id)
    if (!seen) {
      seen = new Set<string>()
      cosmeticSeen.set(wc.id, seen)
    }
    const known = seen
    const fresh = engine
      .cosmeticSelectors(host, survey.classes ?? [], survey.ids ?? [])
      .filter((selector) => !known.has(selector))
    if (fresh.length === 0) return

    for (const selector of fresh) known.add(selector)
    // 'user' origin outranks the page's own !important declarations.
    await wc.insertCSS(hideCss(fresh), { cssOrigin: 'user' }).catch(() => undefined)
  }

  /** Pushes the current list to the UI after a bulk change such as an import. */
  sendBookmarks() {
    this.send('state:bookmarks', bookmarks.all())
  }

  sendUpdateState(state: UpdateState) {
    this.send('state:update', state)
  }

  /* ----------------------------------------------------------- suggestions */
  suggestions(query: string): Suggestion[] {
    const q = query.trim()
    const s = settings.get()
    // A private window neither writes history nor reads it back: suggesting
    // yesterday's browsing to whoever is at the keyboard now defeats the point.
    const useHistory = s.historySuggestions && !this.incognito

    // What is already open comes first. With twenty tabs the thing you are
    // looking for is usually one of them, and opening a second copy of a page
    // you already have is the wrong answer to "where is that page".
    const openTabs = (match: string): Suggestion[] =>
      this.tabs
        .filter((tab) => tab.id !== this.activeId && (tab.hasContent || tab.internal))
        .filter((tab) => {
          if (!match) return true
          const where = `${tab.title} ${tab.url}`.toLowerCase()
          return where.includes(match)
        })
        .slice(0, 6)
        .map((tab) => ({
          kind: 'tab' as const,
          title: tab.title,
          url: tab.url || `nya://${tab.internal ?? 'start'}`,
          subtitle: t('Открытая вкладка'),
          tabId: tab.id
        }))

    if (!q) {
      const tabs = openTabs('')
      return [...tabs, ...(useHistory ? history.recent(Math.max(2, 8 - tabs.length)) : [])]
    }

    const out: Suggestion[] = []
    const lower = q.toLowerCase()
    out.push(...openTabs(lower))

    for (const fav of s.favorites) {
      if (fav.title.toLowerCase().includes(lower) || fav.url.toLowerCase().includes(lower)) {
        out.push({ kind: 'favorite', title: fav.title, url: fav.url, subtitle: t('Избранное') })
      }
    }
    for (const mark of bookmarks.all()) {
      if (mark.title.toLowerCase().includes(lower) || mark.url.toLowerCase().includes(lower)) {
        out.push({ kind: 'favorite', title: mark.title, url: mark.url, subtitle: t('Закладка') })
      }
      if (out.length > 6) break
    }
    if (useHistory) out.push(...history.search(q, 6))

    const direct = normalizeInput(q, s)
    if (!/^https?:\/\/(duckduckgo|www\.google|www\.bing|search|yandex|www\.startpage|www\.mojeek|www\.ecosia|searx)/i.test(direct)) {
      out.unshift({ kind: 'url', title: q, url: direct, subtitle: t('Открыть сайт') })
    }
    out.push({ kind: 'search', title: q, url: normalizeInput(`${q} `, s), subtitle: t('Поиск') })

    // A tab and a history entry often share a URL. The tab is listed first and
    // claims the address, so the same page is never offered twice — once to
    // switch to and once to open again.
    const seen = new Set<string>()
    const kept: Suggestion[] = []
    for (const item of out) {
      const key = item.kind === 'tab' ? `tab:${item.tabId}` : item.url
      if (seen.has(key) || (item.kind !== 'tab' && seen.has(item.url))) continue
      seen.add(key)
      seen.add(item.url)
      kept.push(item)
      if (kept.length === 9) break
    }
    return kept
  }

  preconnect(input: string) {
    const s = settings.get()
    if (!s.preconnect) return
    try {
      const url = new URL(normalizeInput(input, s))
      if (url.protocol === 'https:') this.ses.preconnect({ url: url.origin, numSockets: 2 })
      if (s.prefetchDns) void this.ses.resolveHost(url.hostname).catch(() => undefined)
    } catch {
      /* not a URL yet */
    }
  }

  getActive(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId)
  }

  private showActive() {
    for (const tab of this.tabs) {
      if (!tab.view) continue
      tab.view.setVisible(tab.id === this.activeId && tab.hasContent && this.layoutRect.visible)
    }
    this.layout()
    this.focusView()
  }

  /* ---------------------------------------------------------- permissions */
  private askPermission(request: PermissionRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const id = randomUUID()
      this.pendingPermissions.set(id, resolve)
      this.send('state:permission', { ...request, id })
      // Nothing is granted if the user simply ignores the request.
      setTimeout(() => {
        if (this.pendingPermissions.delete(id)) resolve(false)
      }, 60_000)
    })
  }

  answerPermission(id: string, allow: boolean) {
    const resolve = this.pendingPermissions.get(id)
    if (!resolve) return
    this.pendingPermissions.delete(id)
    resolve(allow)
  }

  /* ------------------------------------------------------------- autofill */
  /** A page reported a login form: offer matching credentials, if any. */
  handleAutofillForm(webContentsId: number, host: string) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab || tab.id !== this.activeId) return
    const matches = vault.forOrigin(host)
    if (matches.length === 0) return
    this.send('state:autofill', {
      host,
      locked: vault.locked,
      // `origin` travels so the offer can say where a credential came from when
      // it was not saved on this exact address.
      entries: matches.map(({ id, username, origin }) => ({ id, username, origin }))
    })
  }

  /** A page submitted credentials: offer to save them. */
  handleAutofillSubmitted(host: string, username: string, password: string) {
    if (!password) return
    // Offering to save a password from a private window would be the one
    // thing it promised not to do.
    if (this.incognito) return
    const existing = vault.forOrigin(host).find((e) => e.username === username)
    this.send('state:save-password', {
      host,
      username,
      // The password is kept in the main process until the user confirms.
      known: Boolean(existing)
    })
    this.pendingCredential = { host, username, password }
  }

  private pendingCredential: { host: string; username: string; password: string } | null = null

  confirmSavePassword(save: boolean): boolean {
    const pending = this.pendingCredential
    this.pendingCredential = null
    if (!save || !pending) return false
    const ok = vault.save(pending.host, pending.username, pending.password)
    this.send('toast', ok ? t('Пароль сохранён') : t('Хранилище паролей заблокировано'))
    return ok
  }

  /** Pushes a saved credential into the active page after a user action. */
  fillCredential(id: string): boolean {
    const tab = this.getActive()
    const wc = tab?.wc
    if (!wc || wc.isDestroyed() || vault.locked) return false
    const entry = vault.list().find((e) => e.id === id)
    if (!entry) return false
    let host = ''
    try {
      host = new URL(wc.getURL()).host
    } catch {
      return false
    }
    // A credential is only handed to a host it belongs to: the one it was
    // saved for, or another name on the same site. vault.matches decides, and
    // tests/vault.mjs is where the edges of that are pinned down.
    if (!vault.matches(host, entry)) return false
    const password = vault.reveal(id)
    if (!password) return false
    wc.send('autofill:fill', { host, username: entry.username, password })
    vault.touch(id)
    return true
  }

  /* ----------------------------------------------------------- wallpapers */
  async importWallpaper(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.win, {
      title: t('Выберите обои'),
      properties: ['openFile'],
      filters: [
        { name: t('Изображения и видео'), extensions: WALLPAPER_EXTENSIONS },
        { name: t('Все файлы'), extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const source = result.filePaths[0]
    const ext = extname(source).toLowerCase()
    if (!WALLPAPER_EXTENSIONS.includes(ext.slice(1))) return null

    const name = `${Date.now()}-${basename(source).replace(/[^\w.-]+/g, '_')}`.slice(-120)
    const target = join(profiles.wallpaperDir(), name)
    try {
      copyFileSync(source, target)
    } catch {
      return null
    }
    const video = ['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.ogv'].includes(ext)
    settings.patch({
      background: { ...settings.get().background, kind: video ? 'video' : 'image', file: name }
    })
    this.applySettings()
    return name
  }

  /* ------------------------------------------------------------ sleep loop */
  private startSleepLoop() {
    this.sleepTimer = setInterval(() => {
      const s = settings.get()
      if (!s.sleepBackgroundTabs) return
      const cutoff = Date.now() - s.sleepAfterMinutes * 60_000
      let changed = false
      for (const tab of this.tabs) {
        if (tab.id === this.activeId || tab.sleeping || !tab.hasContent) continue
        const wc = tab.wc
        if (!wc || wc.isDestroyed() || wc.isCurrentlyAudible()) continue
        if (tab.lastActive < cutoff) {
          tab.sleep(this.win)
          changed = true
        }
      }
      if (changed) this.broadcast()
    }, 60_000)
  }

  /* ------------------------------------------------------------ auto-hide */
  /**
   * Watches for the cursor at the window's edge, and only while auto-hide is
   * on: a timer this fast is nine wake-ups a second, and a laptop feels the
   * ones it did not need.
   */
  private startEdgeWatch() {
    const wanted = settings.get().tabAutoHide
    if (wanted === (this.edgeTimer !== null)) return
    if (!wanted) {
      if (this.edgeTimer) clearInterval(this.edgeTimer)
      this.edgeTimer = null
      this.setEdge(false)
      return
    }
    this.edgeTimer = setInterval(() => {
      const s = settings.get()
      if (!s.tabAutoHide || this.win.isDestroyed()) return
      if (!this.win.isFocused()) return this.setEdge(false)

      const bounds = this.win.getContentBounds()
      const point = screen.getCursorScreenPoint()
      const x = point.x - bounds.x
      const y = point.y - bounds.y
      if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return this.setEdge(false)

      const EDGE = 5
      const nearTop = y <= EDGE
      const nearSide =
        s.tabPosition === 'left' ? x <= EDGE : s.tabPosition === 'right' ? x >= bounds.width - EDGE : false
      if (nearTop || nearSide) return this.setEdge(true)

      const r = this.layoutRect
      if (y > r.y + 16 && x > r.x + 16 && x < r.x + r.width - 16) this.setEdge(false)
    }, 110)
  }

  private setEdge(value: boolean) {
    if (value === this.edgeActive) return
    this.edgeActive = value
    this.send('state:edge', value)
  }

  private shouldConfirmClose() {
    if (this.confirmedClose || !settings.get().confirmCloseMultiple) return false
    return this.tabs.filter((t) => t.hasContent).length > 1
  }

  /* -------------------------------------------------------- session state */
  private sessionFile() {
    return join(profiles.dir(), 'session.json')
  }

  private persistSession() {
    if (this.incognito || this.offsetFromFirst) return
    if (!settings.get().restoreSession) return
    try {
      const kept = this.tabs.filter((t) => t.hasContent && /^https?:/i.test(t.url))
      const payload = {
        tabs: kept.map((t) => ({
          url: t.url,
          title: t.title,
          favicon: t.favicon,
          pinned: t.pinned,
          groupId: t.groupId
        })),
        // Only the groups that still have a saved tab in them: restoring an
        // empty group would put a name over nothing.
        groups: this.groups.filter((g) => kept.some((t) => t.groupId === g.id)),
        activeIndex: kept.findIndex((t) => t.id === this.activeId)
      }
      const file = this.sessionFile()
      writeFileSync(file + '.tmp', JSON.stringify(payload), 'utf8')
      renameSync(file + '.tmp', file)
    } catch {
      /* best effort */
    }
  }

  restoreSession(): boolean {
    if (!settings.get().restoreSession) return false
    const file = this.sessionFile()
    if (!existsSync(file)) return false
    let payload: { tabs: PersistedTab[]; activeIndex: number; groups?: TabGroup[] }
    try {
      payload = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
    if (!Array.isArray(payload.tabs) || payload.tabs.length === 0) return false

    // Groups first: a restored tab needs its group to exist before it can
    // point at it, and the ids have to keep meaning what they meant.
    this.groups = (payload.groups ?? []).map((group) => ({ ...group }))
    this.groupSeq = this.groups.reduce((top, group) => Math.max(top, group.id), 0)
    const knownGroup = new Set(this.groups.map((group) => group.id))

    const lazy = settings.get().lazyRestore
    payload.tabs.slice(0, 40).forEach((saved, index) => {
      const isActive = index === Math.max(0, payload.activeIndex)
      const tab = new Tab(++this.seq, this.ses)
      tab.title = saved.title || saved.url
      tab.favicon = saved.favicon
      tab.url = saved.url
      tab.hasContent = true
      tab.pinned = saved.pinned === true
      tab.groupId =
        saved.groupId !== undefined && saved.groupId !== null && knownGroup.has(saved.groupId)
          ? saved.groupId
          : null
      this.tabs.push(tab)

      // Only the tab you were last looking at spends a process on startup.
      if (isActive || !lazy) {
        tab.ensureView(this.wire)
        if (tab.view) this.win.contentView.addChildView(tab.view)
        this.raiseOverlay()
        tab.load(saved.url)
      }
      if (isActive) this.activeId = tab.id
    })

    if (this.activeId === -1 && this.tabs[0]) this.activeId = this.tabs[0].id
    this.reorderStrip()
    this.showActive()
    this.sendGroups()
    this.broadcast()
    return true
  }

  async clearData() {
    await clearBrowsingData(this.ses)
    history.clear()
    this.send('toast', t('Данные сайтов удалены'))
    this.broadcast()
  }

  /** True when this window owns the view a message came from. */
  owns(sender: WebContents): boolean {
    if (this.chrome.webContents === sender || this.overlay.webContents === sender) return true
    return this.tabs.some((tab) => tab.wc === sender)
  }

  dispose() {
    if (this.sleepTimer) clearInterval(this.sleepTimer)
    if (this.edgeTimer) clearInterval(this.edgeTimer)
    this.persistSession()
    this.saveBounds()
  }
}

function appIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath ?? '', 'icon.png')
  ]
  return candidates.find((file) => existsSync(file))
}

/**
 * Chromium net errors that mean "this host has no working HTTPS endpoint":
 * refused/reset/timed-out connections plus TLS and certificate failures.
 */
const HTTPS_UNAVAILABLE = new Set([
  -100, -101, -102, -105, -107, -118, -200, -201, -202, -207, -501
])
