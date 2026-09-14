import {
  BaseWindow,
  WebContentsView,
  app,
  clipboard,
  dialog,
  globalShortcut,
  nativeImage,
  nativeTheme,
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
import { attachLog, log } from './log'
import { looksLikePdf, pdfSource, pdfViewerUrl } from './pdf'
import { translateBatch } from './translate'
import { WALLPAPER_EXTENSIONS, registerProtocols } from './protocol'
import { sites } from './sites'
import { usage } from './usage'
import { drafts } from './drafts'
import { apps, inScope, readManifest } from './apps'
import { allowCertificateOnce, installCertificateTrust, refusedCertificate } from './trust'
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
import { comboOf, shortcutMap } from '../shared/shortcuts'
import { extensionActions, loadExtensions, setExtensionSession } from './extensions'
import { normalizeInput } from '../shared/search'
import type {
  ContentLayout,
  InternalPage,
  PermissionRequest,
  Profile,
  InstalledApp,
  PrintOptions,
  Playing,
  ExtensionAction,
  SiteInfo,
  SiteRules,
  SplitState,
  WebAppCandidate,
  Suggestion,
  TabGroup,
  TabSpace,
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
/** A site's name as a person would say it: no scheme, no leading www. */
const hostOf = (raw: string): string => hostOfUrl(raw).replace(/^www\./, '')

/** What a frame says about the one thing it is playing. */
type MediaReport = Omit<Playing, 'tabId' | 'host' | 'favicon'>

export type MediaCommand =
  | 'toggle'
  | 'play'
  | 'pause'
  | 'mute'
  | 'seek'
  | 'skip'
  | 'volume'
  | 'rate'
  | 'next'
  | 'prev'
  | 'pip'

/**
 * Which of two frames of the same tab speaks for it: the one playing, and of
 * two playing ones the video — an advert in an iframe should not be allowed
 * to answer for the film it interrupted.
 */
const louder = (a: Playing, b: Playing) => {
  if (a.playing !== b.playing) return a.playing
  if (a.video !== b.video) return a.video
  return a.duration > b.duration
}

const isDev = !app.isPackaged

interface PersistedTab {
  url: string
  title: string
  favicon: string | null
  pinned?: boolean
  groupId?: number | null
  /** which big group it was in; absent in sessions written before they existed */
  space?: number
  /** set when the tab held one of the browser's own pages instead of a site */
  internal?: InternalPage | null
  /** how far down the page had been read */
  scroll?: number
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
  passwords: 'Пароли и карты'
}

class Tab {
  readonly id: number
  view: WebContentsView | null = null
  /**
   * How far down this page was scrolled, as the page last said. Kept so a
   * restored tab opens where it was left rather than at the top, which for a
   * long article is the difference between continuing and starting again.
   */
  scroll = 0
  /** Where to scroll once the restored page has finished loading, and then forgotten. */
  restoreScroll = 0
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

  /** Whether this page is currently showing a translation of itself. */
  translated = false
  /** What language the page says, or looks like, it is written in. */
  language = ''
  /** reading mode is up over this page */
  reading = false
  /** Which big group this tab lives in; they never move on their own. */
  space = 1
  /**
   * The app this page says it can be installed as. It is worked out when the
   * page loads and kept here rather than on the window, or switching to a
   * tab that is not an app would still be offering the last one that was.
   */
  candidate: WebAppCandidate | null = null

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
      // Three decimals, not one: a per cent step is a hundredth of a level,
      // and rounding it away made 105% read back as 106%.
      zoom: wc ? Math.round(wc.getZoomLevel() * 1000) / 1000 : 0,
      translated: this.translated,
      language: this.language,
      reading: this.reading,
      error: this.error
    }
  }
}

/**
 * The language a page gets translated into: the one the browser is in, and
 * when that is the system's, whatever the system says without its region.
 */
function translateTarget(): string {
  const code = settings.get().language || app.getLocale()
  return (code.split('-')[0] || 'ru').toLowerCase()
}

/** Inches, because that is what printToPDF measures margins in. */
const MARGIN_INCHES = { default: 0.4, none: 0, narrow: 0.2 }

function marginsForPrint(kind: PrintOptions['margins']) {
  if (kind === 'none') return { marginType: 'none' as const }
  if (kind === 'default') return { marginType: 'default' as const }
  const inch = MARGIN_INCHES.narrow
  return {
    marginType: 'custom' as const,
    top: inch,
    bottom: inch,
    left: inch,
    right: inch
  }
}

/**
 * "1-5, 8" as the pairs Electron's print wants. Anything that is not a page
 * number is dropped rather than guessed at, and an empty list means the
 * whole document — which is what the caller does with it.
 */
function pageRanges(text: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  for (const part of text.split(',')) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part)
    if (!range) continue
    const from = Number(range[1])
    const to = range[2] ? Number(range[2]) : from
    if (from < 1 || to < from) continue
    // Electron counts from zero here, and people do not.
    out.push({ from: from - 1, to: to - 1 })
  }
  return out
}

/** The same answers, in the shape printToPDF reads them. */
function pdfOptions(options: PrintOptions) {
  const inch = MARGIN_INCHES[options.margins] ?? MARGIN_INCHES.default
  return {
    landscape: options.landscape,
    printBackground: options.background,
    displayHeaderFooter: options.headers,
    scale: Math.max(0.25, Math.min(2, options.scale / 100)),
    pageSize: options.paper,
    margins: { top: inch, bottom: inch, left: inch, right: inch },
    ...(options.pages.trim() ? { pageRanges: options.pages.trim() } : {})
  }
}

/**
 * One address for the purposes of not listing the same page twice: the
 * fragment and a trailing slash make no difference to where you end up, and
 * "/settings" and "/settings/" appearing one under the other in the list is
 * how the address bar came to look like a bad search engine.
 */
function sameAddress(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.origin}${path}${parsed.search}`.toLowerCase()
  } catch {
    return url.toLowerCase()
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
/**
 * The window to give a page that asked for one: the size it asked for, kept
 * inside the screen and above the size a login form needs, centred on the
 * window it came from. The preferences are the ones a tab gets — a popup is a
 * page like any other and is trusted no further.
 */
function popupOptions(features: string, parent: BaseWindow) {
  const asked = (name: string) => {
    const match = new RegExp(name + String.raw`\s*=\s*(\d+)`).exec(features ?? '')
    return match ? parseInt(match[1], 10) : 0
  }
  const bounds = parent.getBounds()
  const area = screen.getDisplayMatching(bounds).workAreaSize
  const width = Math.min(Math.max(asked('width') || 520, 380), area.width)
  const height = Math.min(Math.max(asked('height') || 660, 400), area.height)
  return {
    width,
    height,
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + (bounds.height - height) / 2),
    frame: true,
    backgroundColor: '#0c0d12',
    icon: appIcon(),
    fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      safeDialogs: true,
      safeDialogsMessage: t('Страница показывает диалоги слишком часто'),
      autoplayPolicy: 'document-user-activation-required' as const,
      navigateOnDragDrop: false
    }
  }
}

export class BrowserWindow {
  win: BaseWindow
  chrome: WebContentsView
  /** Transparent layer above the page: menus, popovers and the command palette. */
  overlay: WebContentsView
  tabs: Tab[] = []
  /**
   * The big groups. There is always at least one and it starts nameless,
   * so a browser nobody has organised looks like a browser with no groups.
   */
  private spaces: Array<{ id: number; name: string; colour: string; pinned: boolean }> = [
    { id: 1, name: '', colour: '', pinned: false }
  ]
  private spaceId = 1
  private spaceSeq = 1
  activeId = -1

  private seq = 0
  private ses!: Session
  /** The session this window's pages run in, for work done on their behalf. */
  get pageSession(): Session {
    return this.ses
  }
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
  /**
   * While an offer is anchored to a field, the overlay is cut down to the
   * size of the card itself. It is one layer over the whole window, so at
   * full size it would swallow every click meant for the page underneath.
   */
  private overlayBounds: { x: number; y: number; width: number; height: number } | null = null
  /** The login field an offer is currently anchored to. */
  private field: {
    webContentsId: number
    host: string
    /** what that field was asking for: a password, a card, an address */
    kind: 'login' | 'card' | 'address' | 'code' | 'new-password'
    x: number
    y: number
    width: number
    height: number
  } | null = null
  private hideOffer: ReturnType<typeof setTimeout> | null = null
  /** Whether the locked-vault card is on screen and holding the keyboard. */
  private noticeUp = false
  /** Hosts where the reader said "not now" to the locked-vault notice. */
  private noticeDismissed = new Set<string>()

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
  /**
   * Set when this window is one installed app rather than the browser: no tab
   * strip, no address bar, and a link that leaves the app's scope opens in a
   * real browser window instead of quietly turning the app into one.
   */
  readonly appMode: InstalledApp | null
  /**
   * Windows pages opened for themselves. A sign-in or a payment opens one and
   * closes it again; a page opening them without end is doing something else,
   * and past this many the rest arrive as tabs, where they are a nuisance
   * rather than a thing covering the screen.
   */
  private readonly popups = new Set<Electron.BrowserWindow>()
  private static readonly MAX_POPUPS = 4
  /** the app a page could be installed as, for the toolbar to offer */
  private candidate: WebAppCandidate | null = null
  /** window was windowed when a page went HTML-fullscreen; restore on leave */
  private windowedBeforeHtmlFullscreen = false

  constructor(incognito = false, appMode: InstalledApp | null = null) {
    this.incognito = incognito
    this.appMode = appMode
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
      title: appMode ? appMode.name : 'Nya Browser',
      icon: appIcon()
    })

    // An installed app gets its own identity in the shell: its own button on
    // the taskbar with its own icon, pinnable on its own, and a relaunch that
    // reopens the app rather than the browser. Without this the app's window is
    // just another one of the browser's, stacked under the browser's icon,
    // which is most of what made an "installed app" feel like a bookmark.
    if (process.platform === 'win32' && appMode) {
      try {
        this.win.setAppDetails({
          appId: `com.nya.browser.app.${appMode.id}`,
          relaunchCommand: `"${process.execPath}" --nya-app=${appMode.id}`,
          relaunchDisplayName: appMode.name
        })
      } catch (error) {
        log('apps: window identity', String(error))
      }
    }

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
      // A window that is gone is not playing anything, and must not be
      // holding the machine's media keys.
      this.frameMedia.clear()
      this.dropMediaKeys()
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
    // The two things a download says out loud: that it will not fit, and that
    // it has landed — the second with a way to the folder, because that is
    // what the next click always is.
    downloads.onTrouble((name) => this.toast(t('Не хватает места для {name}', { name })))
    downloads.onUnpacked(() => this.toast(t('Архив распакован')))
    downloads.onDone((item) => {
      if (settings.get().doNotDisturb) return
      this.send('toast', {
        message: t('{name} загружен', { name: item.name }),
        action: { label: t('Показать в папке'), id: `reveal:${item.id}` }
      })
    })

    this.startSleepLoop()
    this.startEdgeWatch()
    this.timeTimer = setInterval(() => this.countTime(), 15_000)
    this.win.on('closed', () => {
      if (this.timeTimer) clearInterval(this.timeTimer)
      this.timeTimer = null
      usage.flush()
    })
  }

  /** Ticks while this window is being looked at; see countTime(). */
  private timeTimer: ReturnType<typeof setInterval> | null = null

  /* ------------------------------------------------------------- profiles */
  /** Binds the window to the active profile's session and data stores. */
  private bindSession() {
    const dir = profiles.dir()
    settings.load(dir)
    history.load(dir)
    favicons.load(dir)
    history.setEnabled(settings.get().saveHistory)
    bookmarks.load(dir)
    sites.load(dir)
    // Time spent is per profile, like everything else a person does here.
    // So is what was half-typed into a form — and neither is kept at all in a
    // private window, where the whole point is that nothing is written down.
    if (!this.incognito) {
      usage.load(dir)
      drafts.load(dir)
    }
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
    installCertificateTrust(this.ses)
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
    // What was downloaded is per profile, and a half-finished file has to be
    // written down before the window closes if it is to be picked up after.
    if (!this.incognito) downloads.load(dir)
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
    if (this.appMode) this.newTab(this.appMode.startUrl)
    else if (this.incognito || this.offsetFromFirst || !this.restoreSession()) this.newTab()
    this.broadcast()
  }

  sendProfiles() {
    this.send('state:profiles', profiles.state)
  }

  currentProfile(): Profile {
    return profiles.active
  }

  /* ------------------------------------------------------- window bounds */
  /**
   * A window a page opened has no address bar of ours, and a sign-in form in a
   * window that says nothing about whose it is would be a phishing tool. So the
   * title bar carries the origin, the page is not allowed to write over it, and
   * it is rewritten again on every navigation.
   */
  private dressPopup(win: Electron.BrowserWindow, opened: string) {
    const wc = win.webContents
    this.popups.add(win)
    win.on('closed', () => this.popups.delete(win))
    const retitle = () => {
      if (win.isDestroyed()) return
      try {
        win.setTitle(new URL(wc.getURL() || opened).origin)
      } catch {
        win.setTitle('Nya Browser')
      }
    }
    retitle()
    wc.on('page-title-updated', (event) => {
      event.preventDefault()
      retitle()
    })
    wc.on('did-navigate', retitle)
    wc.on('did-navigate-in-page', retitle)
    wc.on('context-menu', (_e, params) => pageContextMenu(this, wc, params))
    // A flow can take another step into a window of its own, and the step after
    // that is where a bank's confirmation usually lives.
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      const blank = url === '' || url === 'about:blank'
      if (!blank && !/^https?:/i.test(url)) {
        if (/^(mailto|tel):/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' as const }
      }
      if (disposition === 'foreground-tab' || disposition === 'background-tab') {
        this.newTab(url, disposition === 'background-tab')
        return { action: 'deny' as const }
      }
      if (this.popups.size >= BrowserWindow.MAX_POPUPS) return { action: 'deny' as const }
      return {
        action: 'allow' as const,
        outlivesOpener: false,
        overrideBrowserWindowOptions: popupOptions(features, this.win)
      }
    })
    wc.on('did-create-window', (child, details) => this.dressPopup(child, details.url))
  }
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

  /**
   * How far a maximised window hangs off the screen.
   *
   * Windows maximises a frameless window to the size of the screen *plus* its
   * invisible resize border — eight pixels or so on every edge, deliberately,
   * so that the edges stay grabbable. Anything drawn out there cannot be seen
   * or clicked, and what lives in the top right corner is the close button:
   * half of it was off the screen, which is exactly how it looked. So the
   * interface is moved inside those pixels instead of being drawn under them.
   */
  private edgeOverflow() {
    const none = { left: 0, top: 0, right: 0, bottom: 0 }
    if (process.platform !== 'win32') return none
    if (!this.win.isMaximized() || this.win.isFullScreen()) return none
    const bounds = this.win.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    return {
      left: Math.max(0, Math.round(area.x - bounds.x)),
      top: Math.max(0, Math.round(area.y - bounds.y)),
      right: Math.max(0, Math.round(bounds.x + bounds.width - (area.x + area.width))),
      bottom: Math.max(0, Math.round(bounds.y + bounds.height - (area.y + area.height)))
    }
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
    const over = this.edgeOverflow()
    const inner = { width: w - over.left - over.right, height: h - over.top - over.bottom }
    this.chrome.setBounds({ x: over.left, y: over.top, ...inner })
    this.overlay.setBounds(
      this.overlayBounds ?? { x: over.left, y: over.top, ...inner }
    )

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
    // The page is measured inside the chrome, so it moves with it.
    const rect = {
      x: Math.round(r.x) + over.left,
      y: Math.round(r.y) + over.top,
      width: Math.round(r.width || inner.width),
      height: Math.round(r.height || Math.max(0, inner.height - r.y))
    }
    // Split: the active page takes its share of the width, the other takes
    // the rest, and the gap between them is left empty on purpose — the
    // chrome shows through it, which is what makes a divider possible at all.
    const shown = this.pairShown()
    const firstView = shown?.[0].view
    const secondView = shown?.[1].view
    if (shown && firstView && secondView) {
      const [first, second] = shown
      const gap = BrowserWindow.SPLIT_GAP
      const leftWidth = Math.max(
        0,
        Math.min(rect.width - gap, Math.round((rect.width - gap) * this.splitRatio))
      )
      firstView.setBounds({ ...rect, width: leftWidth })
      firstView.setBorderRadius(0)
      firstView.setVisible(r.visible && first.hasContent)
      secondView.setBounds({
        x: rect.x + leftWidth + gap,
        y: rect.y,
        width: rect.width - leftWidth - gap,
        height: rect.height
      })
      secondView.setBorderRadius(0)
      secondView.setVisible(r.visible && second.hasContent)
      return
    }

    active.view.setBounds(rect)
    // Square. The page is flush against the left and right edges of the window,
    // so rounding its corners cut two notches out of it — one under the first
    // tab, and a second one on the right whenever the window is not maximised.
    // The window's own rounded corners are the shell's, and the shell clips the
    // page to them; the page does not need corners of its own.
    active.view.setBorderRadius(0)
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
  setOverlayMode(
    mode: string | null,
    options: {
      bounds?: { x: number; y: number; width: number; height: number } | null
      focus?: boolean
    } = {}
  ) {
    // Only the three the browser volunteers: everything else — the address
    // bar, the profiles, a group's colour — was asked for by a person.
    if (
      mode !== null &&
      settings.get().doNotDisturb &&
      (mode === 'save-password' || mode === 'autofill' || mode === 'install-app')
    ) {
      return
    }
    this.overlayMode = mode
    const visible = mode !== null
    this.overlayBounds = visible ? (options.bounds ?? null) : null
    this.raiseOverlay()
    this.layout()
    this.overlay.setVisible(visible)
    this.overlay.webContents.send('state:overlay', mode)
    this.chrome.webContents.send('state:overlay', mode)
    // An offer under a field must not take the keyboard away from that
    // field: people carry on typing while it is up, and it disappears when
    // what they typed no longer needs it.
    if (visible && options.focus !== false) this.overlay.webContents.focus()
    else if (!visible) this.focusView()
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
    // "Do not disturb" is about the browser's own voice: its toasts and its
    // offers. It never touches a site's own notifications, which are a
    // permission and live elsewhere.
    if (channel === 'toast' && settings.get().doNotDisturb) return
    if (!this.chrome.webContents.isDestroyed()) this.chrome.webContents.send(channel, payload)
    // The overlay renders from the same state, so it gets every update too.
    if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.send(channel, payload)
  }

  private broadcast() {
    if (this.broadcastTimer) return
    // Coalesce bursts (loading + title + favicon arrive together) into one frame.
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.send(
        'state:tabs',
        this.here().map((t) => t.serialize(this.activeId))
      )
      this.sendSpaces()
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
      incognito: this.incognito,
      app: this.appMode
        ? { id: this.appMode.id, name: this.appMode.name, themeColor: this.appMode.themeColor }
        : null
    }
    this.send('state:window', state)
  }

  sendShortcut(action: string) {
    this.send('shortcut', action)
  }

  applySettings() {
    const s = settings.get()
    this.shortcutTable = null
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

    // Chromium counts the matches as it goes; without this the search box
    // could only move the page about and hope you noticed.
    wc.on('found-in-page', (_e, result) => {
      if (tab.id !== this.activeId) return
      this.send('state:find', {
        query: this.findQuery,
        matches: result.matches,
        active: result.activeMatchOrdinal
      })
    })

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
    wc.on('did-finish-load', () => {
      if (tab.id === this.activeId) void this.lookForApp(tab)
      // The page reads QR codes itself and needs the two words for its buttons
      // in the language the browser is wearing.
      wc.send('qr:words', { open: t('Открыть'), copy: t('Копировать') })
      // The same for the offer to put back what was typed into a form here and
      // never sent.
      wc.send('draft:words', {
        title: t('Здесь остался незаконченный текст'),
        restore: t('Восстановить'),
        dismiss: t('Не нужно')
      })
      // A restored tab opens where it was left. Once only: after that the
      // page is the reader's again.
      if (tab.restoreScroll > 0) {
        const to = tab.restoreScroll
        tab.restoreScroll = 0
        void wc
          .executeJavaScript(`window.scrollTo(0, ${Math.round(to)})`, false)
          .catch(() => undefined)
      }
    })
    wc.on('dom-ready', () => {
      void this.applyCosmetic(wc)
      // Much of the ad furniture arrives after DOMContentLoaded.
      setTimeout(() => void this.applyCosmetic(wc), 1500)
    })
    wc.on('did-navigate', (_e, raw) => {
      const url = pdfSource(raw) ?? raw
      tab.url = url
      // A different page is not the translated one, and is not the one being
      // read either.
      tab.translated = false
      tab.reading = false
      // Until the new page says otherwise, nothing is known about its
      // language, and the offer to translate stays away.
      tab.language = ''
      // A site that was left at a different zoom opens at it again.
      const own = sites.get(hostOfUrl(url)).zoom
      wc.setZoomLevel(own ?? settings.get().defaultZoom)
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
      // A certificate is the one failure someone can answer for themselves, so
      // the page is told what was wrong with it and offers the choice.
      const certificate = host ? refusedCertificate(host) : null
      tab.error = {
        code,
        description: description || t('Не удалось загрузить страницу'),
        url,
        certificate: certificate ?? undefined
      }
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
    // Whichever page you are working in is the one the browser is «on»: click
    // into the half on the right and that tab comes forward, with its address
    // in the bar and its name open in the strip. Without this, using the
    // second page left the first one looking like the one in front.
    wc.on('focus', () => {
      if (this.activeId === tab.id || !this.inPair(tab.id)) return
      this.activeId = tab.id
      tab.lastActive = Date.now()
      this.candidate = tab.candidate
      this.sendApp()
      this.layout()
      this.sendSplit()
      this.broadcast()
    })

    wc.on('audio-state-changed', () => {
      this.broadcast()
      this.mediaHeard()
    })
    wc.on('media-started-playing', () => {
      this.broadcast()
      this.mediaHeard()
    })
    wc.on('media-paused', () => {
      this.broadcast()
      this.mediaHeard()
    })
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
      // An app window is the app. A link that leaves its scope opens in a
      // real browser window rather than quietly turning the app into one.
      if (this.appMode && !inScope(this.appMode, url)) {
        event.preventDefault()
        void shell.openExternal(url).catch(() => undefined)
        return
      }
      if (!looksLikePdf(url)) return
      event.preventDefault()
      tab.load(url)
      this.broadcast()
    })

    wc.on('context-menu', (_e, params) => pageContextMenu(this, wc, params))

    wc.on('before-input-event', (event, input) => {
      if (this.handleInput(input, false)) event.preventDefault()
    })

    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (this.appMode && /^https?:/i.test(url) && !inScope(this.appMode, url)) {
        void shell.openExternal(url).catch(() => undefined)
        return { action: 'deny' }
      }
      // Half the sign-in libraries open the window first and decide where to
      // send it a moment later, so a window with nothing in it yet is a real
      // request and not a mistake.
      const blank = url === '' || url === 'about:blank'
      if (!blank && !/^https?:/i.test(url)) {
        if (/^(mailto|tel):/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      }
      // A popup aimed at an ad network is a popunder; it does not get a tab.
      if (!blank && isBlockedPopup(url, documentHosts.get(wc.id) ?? '')) return { action: 'deny' }
      // A page that asks for a window of its own size is running something
      // that talks back to that window: signing in with an account from
      // another site, or a bank confirming a payment. Both hold on to what
      // window.open returned and post messages to it, and a refused window
      // returns null — which is where those flows used to stop. So this opens
      // one. Everything else is a tab, which is what people mean by "open in
      // new tab" anyway.
      if (disposition === 'new-window' || blank) {
        // Four windows at once is more than any sign-in or payment needs. A
        // page still asking gets nothing — turning the rest into tabs only
        // moved the flood into the tab strip.
        if (this.popups.size >= BrowserWindow.MAX_POPUPS) return { action: 'deny' }
        return {
          action: 'allow',
          outlivesOpener: false,
          overrideBrowserWindowOptions: popupOptions(features, this.win)
        }
      }
      this.newTab(url, disposition === 'background-tab')
      return { action: 'deny' }
    })

    wc.on('did-create-window', (child, details) => this.dressPopup(child, details.url))

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
    // The settings page is listening for the next chord to bind it. While it
    // is, the window answers nothing — otherwise every key it tries to record
    // would do its old job instead of being recorded.
    if (this.capturingShortcut && fromChrome) return false
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
    if (key === 'F6') return this.run(() => this.focusAddress())
    if (key === 'Escape' && !fromChrome) {
      // Escape is the browser's own key — it stops a page loading — so a page
      // never sees it. Whatever the browser has put over the page gets it
      // first, and the choosing of a screenshot area is exactly that.
      if (this.choosingArea) {
        return this.run(() => {
          this.choosingArea = false
          this.withActive((wc) => wc.send('capture:cancel'))
        })
      }
      return this.run(() => this.stop())
    }

    // Alt+D is the second name of the address bar on Windows and is not in
    // the table: it is a platform convention, not a preference.
    if (input.alt && !mod && key === 'd') return this.run(() => this.focusAddress())

    // The zoom keys and Ctrl+1…9 stay where they are. They are what the key
    // is on this platform; the table is for the rest.
    if (mod && !input.alt && !input.shift) {
      if (key === '=' || key === '+') return this.run(() => this.setZoom(0.5))
      if (key === '-') return this.run(() => this.setZoom(-0.5))
      if (key === '0') return this.run(() => this.setZoom('reset'))
      if (/^[1-9]$/.test(key)) {
        const here = this.here()
        const index = key === '9' ? here.length - 1 : Number(key) - 1
        const tab = here[index]
        return this.run(() => tab && this.switchTab(tab.id))
      }
    }
    if (mod && input.shift && key === 'Delete') return this.run(() => this.uiShortcut('clear-data'))

    const command = this.shortcuts().get(comboOf(input))
    if (!command) return false
    return this.run(() => this.runCommand(command))
  }

  /** True while the settings page is recording a new binding. */
  private capturingShortcut = false

  setCapturingShortcut(on: boolean) {
    this.capturingShortcut = on
  }

  /** Rebuilt when the settings change, not on every keypress. */
  private shortcutTable: Map<string, string> | null = null

  private shortcuts(): Map<string, string> {
    if (!this.shortcutTable) this.shortcutTable = shortcutMap(settings.get().shortcuts)
    return this.shortcutTable
  }

  /** One place where a command id becomes something happening. */
  runCommand(id: string) {
    switch (id) {
      case 'new-tab':
        return this.newTab()
      case 'close-tab':
        return this.closeTab(this.activeId)
      case 'reopen-tab':
        return this.reopenClosed()
      case 'next-tab':
        return this.cycleTab(1)
      case 'prev-tab':
        return this.cycleTab(-1)
      case 'new-window':
        return this.chrome.webContents.send('shortcut', 'new-window')
      case 'new-private-window':
        return this.chrome.webContents.send('shortcut', 'new-private-window')
      case 'focus-address':
        return this.focusAddress()
      case 'reload':
        return this.reload()
      case 'back':
        return this.goBack()
      case 'forward':
        return this.goForward()
      case 'bookmark':
        return this.bookmarkCurrent()
      case 'find':
        return this.uiShortcut('find')
      case 'downloads':
        return this.uiShortcut('downloads')
      case 'history':
        return this.uiShortcut('history')
      case 'bookmarks':
        return this.uiShortcut('bookmarks')
      case 'settings':
        return this.uiShortcut('settings')
      case 'profiles':
        return this.uiShortcut('profiles')
      case 'toggle-tabs':
        return this.uiShortcut('toggle-tabs')
      case 'fullscreen':
        return this.win.setFullScreen(!this.win.isFullScreen())
      case 'devtools':
        return this.openDevTools()
      case 'translate-selection': {
        // The selection lives in the page, so the page is asked for it.
        const tab = this.getActive()
        const wc = tab?.wc
        if (!wc || wc.isDestroyed()) return
        void wc
          .executeJavaScript('String(window.getSelection() ?? "")', true)
          .then((text: string) => this.translateSelection(wc, text))
          .catch(() => undefined)
        return
      }
      case 'capture-area':
        void this.capture('area')
        return
      case 'capture-full':
        void this.capture('full')
        return
      default:
        return
    }
  }

  private run(fn: () => void): boolean {
    fn()
    return true
  }

  /**
   * The overlay asking for something that lives in the other renderer — the
   * find bar is drawn with the toolbar, not over the page.
   */
  requestUiAction(action: string) {
    if (action !== 'find') return
    this.setOverlayMode(null)
    this.uiShortcut(action)
  }

  private uiShortcut(action: string) {
    this.chrome.webContents.focus()
    this.sendShortcut(action)
  }

  private focusAddress() {
    this.setOverlayMode('palette')
  }

  private cycleTab(delta: number) {
    const here = this.here()
    if (here.length < 2) return
    const index = here.findIndex((t) => t.id === this.activeId)
    const next = here[(index + delta + here.length) % here.length]
    this.switchTab(next.id)
  }

  /* -------------------------------------------------------------- actions */
  newTab(url?: string, background = false): number {
    const tab = new Tab(++this.seq, this.ses)
    tab.space = this.spaceId
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
    // A tab found through search or the tab list can be in another big group;
    // going to it means going there.
    if (tab.space !== this.spaceId) this.spaceId = tab.space
    tab.lastActive = Date.now()
    // Whatever this tab decided about being an app, not what the last one did.
    this.candidate = tab.candidate
    this.sendApp()
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

  /**
   * Gives a tab a view, puts it in the window, and sends it where it is
   * supposed to be.
   *
   * A tab put to sleep remembers the page it was on and goes back to it by
   * itself. A tab restored from the last run and never opened since remembers
   * only an address, and a view made for it is empty until somebody loads it
   * — which is how a page beside another one came up as a black rectangle.
   */
  private summon(tab: Tab) {
    if (tab.internal) return
    if (tab.ensureView(this.wire) && tab.view) {
      this.win.contentView.addChildView(tab.view)
      this.raiseOverlay()
    }
    const wc = tab.wc
    if (wc && !wc.getURL() && tab.url && tab.url !== START_URL) tab.load(tab.url)
  }

  private wake(tab: Tab) {
    if (!tab.sleeping) return
    this.summon(tab)
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
    if (this.dropMedia(tab.id)) this.sendMedia()
    if (this.inPair(tab.id)) {
      this.pair = null
      this.sendSplit()
    }

    // The last tab out of a group takes the group with it. One left behind
    // was a row in the list holding nothing, which could not be opened,
    // filled or got rid of.
    if (tab.groupId !== null && !this.tabs.some((t) => t.groupId === tab.groupId)) {
      this.groups = this.groups.filter((group) => group.id !== tab.groupId)
      this.sendGroups()
    }

    // An empty big group is still a big group; it gets a blank tab rather
    // than dumping you into somebody else's.
    if (this.here().length === 0) {
      this.newTab()
      return
    }
    if (this.activeId === id) {
      const here = this.here()
      const next = here[Math.min(index, here.length - 1)] ?? here[here.length - 1]
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
    for (const tab of this.here()) if (tab.id !== id && !tab.pinned) this.closeTab(tab.id)
  }

  closeToRight(id: number) {
    const here = this.here()
    const index = here.findIndex((t) => t.id === id)
    if (index === -1) return
    for (const tab of here.slice(index + 1)) if (!tab.pinned) this.closeTab(tab.id)
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
    // One big group at a time, so its tabs are a run in the list as well as
    // in the strip — which is what lets a position in one mean the same in
    // the other.
    for (const space of this.spaces) {
      const inSpace = this.tabs.filter((tab) => tab.space === space.id)
      for (const pinnedPass of [true, false]) {
        for (const tab of inSpace) {
          if (tab.pinned !== pinnedPass || taken.has(tab.id)) continue
          if (tab.groupId === null) {
            taken.add(tab.id)
            ordered.push(tab)
            continue
          }
          for (const member of inSpace) {
            if (member.groupId !== tab.groupId || member.pinned !== pinnedPass) continue
            if (taken.has(member.id)) continue
            taken.add(member.id)
            ordered.push(member)
          }
        }
      }
    }
    // A tab whose big group went away still belongs somewhere.
    for (const tab of this.tabs) if (!taken.has(tab.id)) ordered.push(tab)
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
      pinned: false,
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

  /**
   * The seven offered colours are a starting point, not the whole of it:
   * anything that is a colour is allowed. The shape is checked because this
   * value is interpolated straight into the strip's styles.
   */
  setGroupColour(groupId: number, color: string) {
    const group = this.groups.find((g) => g.id === groupId)
    if (!group || !/^#[0-9a-f]{6}$/i.test(color)) return
    group.color = color.toLowerCase()
    this.persistSession()
    this.sendGroups()
  }

  /**
   * Pins or unpins a group as one thing. A pinned tab normally leaves its
   * group — a group whose members are not together is not one — but a whole
   * group moving to the front stays together, so here the members keep it.
   */
  pinGroup(groupId: number, pinned?: boolean) {
    const group = this.groups.find((g) => g.id === groupId)
    if (!group) return
    group.pinned = pinned ?? !group.pinned
    for (const tab of this.tabs) if (tab.groupId === groupId) tab.pinned = group.pinned
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  /**
   * Moves a whole group. Its tabs are one run in the strip, so the run comes
   * out, the target is measured against what is left, and the run goes back
   * in there — which is what dragging the name over a group looks like it
   * should do.
   */
  moveGroup(groupId: number, toIndex: number) {
    const here = this.here()
    const members = here.filter((tab) => tab.groupId === groupId)
    if (members.length === 0) return
    const rest = here.filter((tab) => tab.groupId !== groupId)
    const at = Math.max(0, Math.min(rest.length, toIndex))
    this.replaceHere([...rest.slice(0, at), ...members, ...rest.slice(at)])
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  /** A tab dropped on a group's name joins it, wherever it came from. */
  dropOnGroup(tabId: number, groupId: number) {
    const tab = this.tabs.find((t) => t.id === tabId)
    const group = this.groups.find((g) => g.id === groupId)
    if (!tab || !group || tab.groupId === groupId) return
    tab.pinned = group.pinned
    tab.groupId = groupId
    group.collapsed = false
    this.reorderStrip()
    this.persistSession()
    this.sendGroups()
    this.broadcast()
  }

  /**
   * Renaming happens in the chip itself, which is where the name is. Choosing
   * a colour needs a panel, and a panel drawn by the strip would be behind the
   * page — so that one goes to the overlay, which is what the overlay is for.
   */
  editGroup(groupId: number, action: 'rename' | 'colour') {
    if (!this.groups.some((g) => g.id === groupId)) return
    if (action === 'colour') this.setOverlayMode(`group-colour:${groupId}`)
    else this.send('state:group-edit', { id: groupId, action })
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
      // Somewhere to go while this group folds up — in this big group, not
      // in another one, which would have moved the whole strip out from
      // under the click.
      const here = this.here()
      const outside = here.filter((t) => t.groupId !== groupId)
      if (outside.length === 0) {
        // The group is every tab there is here. Refusing to fold it up was
        // the wrong answer — the click did nothing and said nothing about
        // why. A new tab is somewhere to be while it is folded.
        this.newTab()
        this.reorderStrip()
      } else {
        const index = here.findIndex((t) => t.id === this.activeId)
        const after = here.slice(index).find((t) => t.groupId !== groupId)
        this.switchTab((after ?? outside[outside.length - 1]).id)
      }
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
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    // The index came from the strip, which shows one big group, so it is
    // measured against that group's tabs and nothing else.
    const rest = this.here().filter((t) => t.id !== id)
    const clamped = Math.max(0, Math.min(rest.length, toIndex))
    // What the drop looked like it meant. Landing between two tabs of one
    // group joins it. Landing anywhere else takes the tab out of whatever
    // group it was in and leaves it standing on its own — unless it did not
    // really leave, which is a drop still touching its own group.
    if (!tab.pinned) {
      const before = rest[clamped - 1]?.groupId ?? null
      const after = rest[clamped]?.groupId ?? null
      const inside = before !== null && before === after
      const stayed = tab.groupId !== null && (tab.groupId === before || tab.groupId === after)
      tab.groupId = inside ? before : stayed ? tab.groupId : null
    }
    this.replaceHere([...rest.slice(0, clamped), tab, ...rest.slice(clamped)])
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

  /* --------------------------------------------------------------- apps */

  /**
   * Asks the page where its manifest is, and reads it. Only the page knows —
   * the link is in its head — but only this process should fetch it, so the
   * page is asked for an address and nothing more.
   */
  private async lookForApp(tab: Tab) {
    tab.candidate = null
    this.candidate = null
    const wc = tab.wc
    if (this.appMode || this.incognito || !wc || wc.isDestroyed()) return this.sendApp()
    if (!/^https?:/i.test(tab.url)) return this.sendApp()
    let manifestUrl = ''
    try {
      manifestUrl = String(
        await wc.executeJavaScript(
          `(() => { const l = document.querySelector('link[rel~="manifest"]'); return l ? l.href : '' })()`,
          false
        )
      )
    } catch {
      return this.sendApp()
    }
    if (!manifestUrl) return this.sendApp()
    const found = await readManifest(this.ses, tab.url, manifestUrl)
    // The page may have moved on while the manifest was being fetched.
    tab.candidate = found && !apps.has(found.id) ? found : null
    if (this.getActive()?.id !== tab.id) return
    this.candidate = tab.candidate
    this.sendApp()
  }

  private sendApp() {
    this.send('state:app-candidate', this.candidate)
  }

  installable(): WebAppCandidate | null {
    return this.candidate
  }

  /** Installs what the toolbar is currently offering. */
  async installApp(): Promise<InstalledApp | null> {
    if (!this.candidate) return null
    const record = await apps.install(this.candidate, this.ses)
    if (record) {
      this.candidate = null
      this.sendApp()
      this.send('toast', t('{name} установлено', { name: record.name }))
    }
    return record
  }

  /* ---------------------------------------------------------- one site */

  /** Everything the padlock panel puts on screen about the current page. */
  siteInfo(): SiteInfo | null {
    const tab = this.getActive()
    const wc = tab?.wc
    if (!tab || !wc || wc.isDestroyed()) return null
    let host = ''
    try {
      host = new URL(tab.url).host.replace(/^www\./, '')
    } catch {
      return null
    }
    if (!host) return null
    return {
      host,
      url: tab.url,
      secure: tab.url.startsWith('https://'),
      blocked: perTabBlocked.get(wc.id) ?? 0,
      zoom: Math.round(wc.getZoomLevel() * 10) / 10,
      rules: sites.get(host),
      defaults: settings.get().permissions
    }
  }

  /**
   * Changes one site's rules and makes them true right now: a permission
   * taken away should not wait for a reload, and blocking turned off should
   * show the page it was breaking.
   */
  setSiteRules(host: string, patch: Partial<SiteRules>, reload = false) {
    sites.set(host, patch)
    if (patch.zoom !== undefined) {
      for (const tab of this.tabs) {
        if (tab.wc && !tab.wc.isDestroyed() && hostOfUrl(tab.url) === host.replace(/^www\./, '')) {
          tab.wc.setZoomLevel(patch.zoom)
        }
      }
    }
    if (reload) this.reload()
    this.broadcast()
  }

  clearSiteRules(host: string) {
    sites.reset(host)
    this.reload()
    this.broadcast()
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

  /**
   * Opens a site whose certificate the browser refused, after its holder was
   * shown what was wrong with it. The exception is this host, this certificate
   * and this run of the browser: nothing is written down.
   */
  proceedPastCertificate(id = this.activeId): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab?.error?.certificate) return
    if (!allowCertificateOnce(tab.error.certificate.host)) return
    const url = tab.error.url
    tab.error = null
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
      const next =
        delta === 'reset'
          ? settings.get().defaultZoom
          : Math.max(-3, Math.min(4, wc.getZoomLevel() + delta))
      this.applyZoom(wc, next, delta === 'reset')
    })
  }

  /**
   * The zoom people actually read: per cent, in fives. Chromium counts in
   * levels where each step is 1.2×, which is why the menu used to offer 83%
   * and 120% and nothing in between.
   */
  setZoomPercent(percent: number) {
    const wanted = Math.max(25, Math.min(500, Math.round(percent)))
    this.withActive((wc) => {
      const level = Math.log(wanted / 100) / Math.log(1.2)
      this.applyZoom(wc, level, Math.abs(wanted - 100) < 0.5)
    })
  }

  /**
   * Sets the zoom and remembers it for the site, because a page that forgets
   * its size on every reload is a page you set the size of twice a minute.
   * The default is stored as nothing at all, so changing the default later
   * still reaches every site that never asked for anything else.
   */
  private applyZoom(wc: WebContents, level: number, isDefault: boolean) {
    wc.setZoomLevel(level)
    const host = hostOfUrl(wc.getURL())
    if (host) sites.set(host, { zoom: isDefault ? undefined : level })
    this.broadcast()
  }

  /** What is being looked for, so a count belongs to the right search. */
  private findQuery = ''

  /**
   * A picture of the page: 'view' is what is on screen, 'full' is the whole
   * scroll of it, 'area' is a piece the reader draws with the mouse.
   *
   * It goes to the downloads folder and to the clipboard at once — a
   * screenshot is taken either to keep or to paste, and which one it is is
   * not knowable from here.
   */
  async capture(kind: 'view' | 'full' | 'area') {
    const tab = this.getActive()
    if (!tab) return false
    // A page the browser draws itself — the start page, the settings — has no
    // view of its own at all, so this is settled before anything is asked of
    // one: otherwise it is a silent no, which reads as a broken menu item.
    if (!tab.hasContent || tab.internal || tab.sleeping || !this.layoutRect.visible) {
      this.send('toast', t('Здесь нечего снимать'))
      return false
    }
    const wc = tab.wc
    if (!wc || wc.isDestroyed()) return false
    if (kind === 'area') {
      this.choosingArea = true
      // The page draws the selection, because only the page knows where the
      // mouse is over it. It answers on capture:area.
      wc.send('capture:area', { hint: t('Выделите область · клик — видимая часть · Esc — отмена') })
      return true
    }
    try {
      const image = kind === 'full' ? await this.wholePage(wc) : await wc.capturePage()
      return this.editPicture(image)
    } catch {
      this.send('toast', t('Не удалось сохранить снимок'))
      return false
    }
  }

  /**
   * Counts the time this window is actually looked at.
   *
   * Only while the window has the focus and the tab in front is a site: a
   * browser left open behind a text editor is not time spent reading, and the
   * settings page is not a site. Fifteen seconds is the grain — fine enough to
   * be honest over an evening, coarse enough that nobody's afternoon is
   * reconstructable from it.
   */
  private countTime() {
    if (this.incognito) return
    if (this.win.isDestroyed() || !this.win.isFocused()) return
    const tab = this.getActive()
    if (!tab || tab.internal !== null || tab.sleeping) return
    const host = hostOfUrl(tab.url)
    if (host) usage.add(host, 15)
  }

  /** A word to the person, from anywhere in the main process. */
  toast(text: string) {
    this.send('toast', text)
  }

  /** Where a page says it is being read, kept for the next start. */
  noteScroll(wcId: number, y: number) {
    const tab = this.tabs.find((t) => t.wc?.id === wcId)
    if (tab) tab.scroll = y
  }

  /** Asks the page what files it has on it. The answer arrives separately. */
  harvestFiles() {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed()) return
    wc.send('page:harvest')
  }

  /** The page's answer, on its way to the panel that shows it. */
  showFiles(webContentsId: number, files: Array<{ url: string; name: string; kind: string }>) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab || tab.id !== this.activeId) return
    this.send('state:files', files)
    this.setOverlayMode('files')
  }

  /** Everything that was ticked, one after another. */
  downloadMany(urls: string[]) {
    for (const url of urls.slice(0, 100)) this.downloadFrom(url)
  }

  /**
   * A link somebody dropped on the browser, or picked out of a page. The
   * address the page it came from is written down with it, so the list can
   * say later where a file was found.
   */
  downloadFrom(url: string) {
    if (!/^https?:\/\//i.test(url)) return
    const here = this.getActive()?.wc
    if (here && !here.isDestroyed()) downloads.noteSource(here.getURL())
    this.ses.downloadURL(url)
  }

  /** The same file, asked for again — from the list, without the page. */
  downloadAgain(id: string) {
    const url = downloads.sourceOf(id)
    // The session, not a page: the interface lives in the default session and
    // a download started there would be invisible to this window's list.
    if (url && /^https?:/i.test(url)) this.ses.downloadURL(url)
  }

  /**
   * The selected sentence, in the language the browser speaks.
   *
   * Translating a whole page to read one line is a heavy thing to do, and the
   * page comes back changed. This leaves the page alone: the words come back
   * in a bubble under themselves.
   */
  async translateSelection(wc: WebContents, text: string) {
    const cut = text.slice(0, 1200).trim()
    if (!cut) return
    wc.send('selection:translating')
    try {
      const [out] = await translateBatch([cut], translateTarget())
      if (out && out !== cut) wc.send('selection:translation', out)
      else wc.send('selection:translation', cut)
    } catch {
      this.send('toast', t('Не удалось перевести'))
      wc.send('selection:translation', cut)
    }
  }

  /* --------------------------------------------------------------- media */

  /* --------------------------------------------------------------- split */

  /**
   * The two tabs shown side by side, left first. A pair, not «the active tab
   * and another one»: clicking either half must leave the pair standing, and
   * which of the two you are typing in is a separate question from which of
   * them is on the left.
   */
  private pair: [number, number] | null = null
  /** How much of the width the left page takes. */
  private splitRatio = 0.5
  /** The gap between the two pages, through which the divider shows. */
  private static SPLIT_GAP = 8

  /** Whether a tab is one of the two shown side by side. */
  inPair(tabId: number) {
    return this.pair !== null && (this.pair[0] === tabId || this.pair[1] === tabId)
  }

  /**
   * The pair as it can actually be drawn: both tabs still exist, both have a
   * view to show, and one of them is the tab in front. Anything else — a
   * third tab in front, a half closed — means there is nothing to divide.
   */
  private pairShown(): [Tab, Tab] | null {
    if (!this.pair) return null
    const left = this.tabs.find((tab) => tab.id === this.pair?.[0])
    const right = this.tabs.find((tab) => tab.id === this.pair?.[1])
    if (!left || !right || left.id === right.id) return null
    if (!this.inPair(this.activeId)) return null
    return [left, right]
  }

  /**
   * Puts a tab beside the one in front. Picking either half of a pair that
   * already exists ends it — one gesture for both directions, the way a
   * toggle should be.
   */
  splitWith(tabId: number | null) {
    if (tabId === null || this.inPair(tabId) || (this.pair === null && tabId === this.activeId)) {
      // The second page leaves the way it came: the division slides to the
      // right edge, and only then is the page taken away. Snapping it out of
      // existence is what made this read as a glitch rather than a gesture.
      if (!this.pair) return
      return this.slideSplit(this.splitRatio, 1, () => {
        this.pair = null
        this.splitRatio = 0.5
        this.showActive()
        this.sendSplit()
        this.broadcast()
      })
    }

    const other = this.tabs.find((tab) => tab.id === tabId)
    const here = this.getActive()
    if (!other || !here || other.id === here.id) return

    this.pair = [here.id, other.id]
    // Closed before it is opened: the first frame must show the second page
    // with no width at all, or the join begins with a jump.
    this.splitRatio = 1
    // A tab that has never been opened has neither a view nor a page in it.
    this.summon(other)
    // And in the strip the two of them come together: the far one travels to
    // the tab it is joining, and from then on they sit as one.
    this.drawTogether(here, other)
    this.showActive()
    this.broadcast()
    // The pages arrive the same way: from the right edge, opening the window
    // into two as they come.
    this.slideSplit(1, 0.5)
  }

  /**
   * Puts the joined tab immediately after the one it joined, so the pair reads
   * as one thing in the strip. A tab in somebody else's group stays where it
   * is: moving it would take it out of a run it belongs to, and that is a
   * bigger change than was asked for.
   */
  private drawTogether(here: Tab, other: Tab) {
    if (here.groupId !== other.groupId || here.space !== other.space) return
    const from = this.tabs.indexOf(other)
    const at = this.tabs.indexOf(here)
    if (from === -1 || at === -1 || from === at + 1) return
    this.tabs.splice(from, 1)
    this.tabs.splice(this.tabs.indexOf(here) + 1, 0, other)
  }

  /** A running join or parting, so a second one cannot fight the first. */
  private splitSlide: ReturnType<typeof setInterval> | null = null

  /**
   * Moves the division from one place to another over a quarter of a second,
   * laying the pages out on every frame. The pages themselves are native
   * layers and cannot be animated by any stylesheet — the only way to make
   * two windows become one is to actually move the boundary between them.
   */
  private slideSplit(from: number, to: number, done?: () => void) {
    if (this.splitSlide) clearInterval(this.splitSlide)
    const started = Date.now()
    const ms = 260
    this.splitRatio = from
    this.layout()
    this.sendSplit()
    this.splitSlide = setInterval(() => {
      if (this.win.isDestroyed()) {
        if (this.splitSlide) clearInterval(this.splitSlide)
        this.splitSlide = null
        return
      }
      const part = Math.min(1, (Date.now() - started) / ms)
      // Quick to leave, slow to arrive — the same curve the interface uses.
      const eased = 1 - Math.pow(1 - part, 3)
      this.splitRatio = from + (to - from) * eased
      this.layout()
      this.sendSplit()
      if (part >= 1) {
        if (this.splitSlide) clearInterval(this.splitSlide)
        this.splitSlide = null
        done?.()
      }
    }, 16)
  }

  /** Where the divider was dragged to. */
  setSplitRatio(ratio: number) {
    if (!this.pair) return
    this.splitRatio = Math.max(0.2, Math.min(0.8, ratio))
    this.layout()
    this.sendSplit()
  }

  private sendSplit() {
    this.send('state:split', this.splitNow())
  }

  /**
   * The pair as it stands. Pushed when it changes, and asked for by a window
   * that has only just opened — a message sent before there was anybody to
   * hear it is how a restored pair came back invisible.
   */
  splitNow(): SplitState | null {
    if (!this.pair) return null
    const left = this.tabs.find((tab) => tab.id === this.pair?.[0])
    const right = this.tabs.find((tab) => tab.id === this.pair?.[1])
    if (!left || !right) return null
    // One of the browser's own pages is drawn by the interface itself and
    // fills the window: there are no two halves to divide, and a line down the
    // middle of the home page is the divider for a split nobody can see. The
    // pairing is kept — the strip still shows it, and going back to either of
    // the two brings the division up again.
    const active = this.getActive()
    const drawable =
      this.pairShown() !== null &&
      active &&
      active.hasContent &&
      !active.internal &&
      !active.sleeping
    if (!drawable) {
      return { left: left.id, right: right.id, ratio: this.splitRatio, rect: null }
    }
    const over = this.edgeOverflow()
    const r = this.layoutRect
    return {
      left: left.id,
      right: right.id,
      ratio: this.splitRatio,
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width || this.win.getContentBounds().width - over.left - over.right),
        height: Math.round(r.height)
      }
    }
  }

  /** The window the media keys are pointed at, if any. */
  private static mediaKeys: BrowserWindow | null = null

  /**
   * What each frame of each tab says it is playing, keyed by tab and frame.
   * Frames matter: a video on a page is as often as not inside somebody
   * else's player, in an iframe of its own.
   */
  private frameMedia = new Map<string, { tabId: number; media: MediaReport; since: number }>()

  /** A page said what language it is written in. */
  handleLanguage(webContentsId: number, code: string) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab || tab.language === code) return
    tab.language = code
    this.broadcast()
  }

  /**
   * A frame said what it is playing, or that it has stopped. The list is the
   * browser's, not the page's: what people want is one place that answers
   * «where is that sound coming from».
   */
  handleMediaState(webContentsId: number, frameId: number, state: MediaReport | null) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab) return
    const key = `${webContentsId}:${frameId}`
    if (!state) {
      if (!this.frameMedia.delete(key)) return
    } else {
      // When it started, so that the one you pressed play on last is the one
      // the panel opens with — that is the one you are listening to.
      const before = this.frameMedia.get(key)
      const since = state.playing && !before?.media.playing ? Date.now() : (before?.since ?? Date.now())
      this.frameMedia.set(key, { tabId: tab.id, media: state, since })
    }
    this.sendMedia()
  }

  /** Forgets everything a tab was playing. */
  private dropMedia(tabId: number) {
    let gone = false
    for (const [key, entry] of this.frameMedia) {
      if (entry.tabId === tabId) {
        this.frameMedia.delete(key)
        gone = true
      }
    }
    return gone
  }

  /**
   * One row per tab, out of however many frames reported — and one for every
   * tab that is making a noise without having said a word about it, so that
   * the list can never be emptier than the room is loud.
   */
  playingNow(): Playing[] {
    const rows = new Map<number, Playing>()

    const started = new Map<number, number>()
    for (const { tabId, media, since } of this.frameMedia.values()) {
      const tab = this.tabs.find((t) => t.id === tabId)
      const wc = tab?.wc
      if (!tab || !wc || wc.isDestroyed()) continue
      const muted = wc.isAudioMuted()
      const row: Playing = {
        ...media,
        tabId,
        // A page that plays through a detached element tells nobody it
        // started; the browser can hear it, so the browser says so.
        playing: media.playing || wc.isCurrentlyAudible(),
        muted,
        host: hostOf(tab.url),
        favicon: tab.favicon || ''
      }
      const had = rows.get(tabId)
      if (!had || louder(row, had)) {
        rows.set(tabId, row)
        started.set(tabId, since)
      }
    }

    for (const tab of this.here()) {
      const wc = tab.wc
      if (!wc || wc.isDestroyed() || rows.has(tab.id)) continue
      if (!wc.isCurrentlyAudible()) continue
      started.set(tab.id, 0)
      rows.set(tab.id, {
        tabId: tab.id,
        title: tab.title || hostOf(tab.url),
        artist: '',
        art: '',
        playing: true,
        muted: wc.isAudioMuted(),
        volume: 1,
        position: 0,
        duration: 0,
        video: false,
        seekable: false,
        rate: 0,
        next: false,
        prev: false,
        pip: false,
        host: hostOf(tab.url),
        favicon: tab.favicon || ''
      })
    }

    // Playing first, and of those the one started last — the order a person
    // would put them in, because the last thing you pressed play on is the
    // thing you meant to listen to.
    return [...rows.values()].sort(
      (a, b) =>
        Number(b.playing) - Number(a.playing) ||
        (started.get(b.tabId) ?? 0) - (started.get(a.tabId) ?? 0)
    )
  }

  private sendMedia() {
    this.send('state:media', this.playingNow())
    this.syncMediaKeys()
  }

  /** The browser heard a tab start or stop; the list is about to be wrong. */
  private mediaHeard() {
    // The flag Chromium answers with settles a moment after the event.
    setTimeout(() => !this.win.isDestroyed() && this.sendMedia(), 250)
  }

  /**
   * The keys on a keyboard that say play and skip. They are taken from the
   * whole machine, so they are taken only while this window is the one making
   * a sound, and given back the moment it stops — a browser that keeps them
   * after the video ended is a browser that broke somebody's music player.
   */
  private syncMediaKeys() {
    const wants = this.anythingPlaying()
    const owner = BrowserWindow.mediaKeys
    if (wants && owner !== this) {
      if (owner) owner.dropMediaKeys()
      BrowserWindow.mediaKeys = this
      try {
        globalShortcut.register('MediaPlayPause', () => this.mediaKey('toggle'))
        globalShortcut.register('MediaNextTrack', () => this.mediaKey('next'))
        globalShortcut.register('MediaPreviousTrack', () => this.mediaKey('prev'))
        globalShortcut.register('MediaStop', () => this.mediaKey('pause'))
      } catch {
        /* another application holds them; it is welcome to them */
      }
    } else if (!wants && owner === this) {
      this.dropMediaKeys()
    }
  }

  private dropMediaKeys() {
    if (BrowserWindow.mediaKeys === this) BrowserWindow.mediaKeys = null
    for (const key of ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop']) {
      try {
        globalShortcut.unregister(key)
      } catch {
        /* never registered */
      }
    }
  }

  /** Tells one tab's player what to do. */
  mediaCommand(tabId: number, what: MediaCommand, to?: number) {
    const tab = this.tabs.find((t) => t.id === tabId)
    const wc = tab?.wc
    if (!wc || wc.isDestroyed()) return false

    // Silence is the browser's own to give: a page playing through an element
    // it never put in the document has no mute button to press.
    if (what === 'mute') {
      wc.setAudioMuted(!wc.isAudioMuted())
      this.sendMedia()
      return true
    }

    // A window of its own is a privilege pages are only granted when a person
    // asked for it, so the asking is done as a person.
    if (what === 'pip') {
      void wc
        .executeJavaScript(
          `document.dispatchEvent(new CustomEvent('nya-media-do', { detail: '{"do":"pip"}' }))`,
          true
        )
        .catch(() => undefined)
      return true
    }

    // A page that says nothing about whether it is playing still has to be
    // told which way to toggle; the browser knows, because it can hear it.
    if (what === 'toggle' && to === undefined) {
      const row = this.playingNow().find((item) => item.tabId === tabId)
      to = row?.playing ? 1 : 0
    }

    wc.send('media:command', { do: what, to })
    // Pages report a second later at the slowest; this is so the button under
    // the finger changes at the speed of the finger.
    setTimeout(() => !this.win.isDestroyed() && this.sendMedia(), 300)
    return true
  }

  /** Whether the media keys should be listened for at all. */
  anythingPlaying() {
    return this.playingNow().some((item) => item.playing)
  }

  /** The one the media keys act on: whatever is playing, newest first. */
  mediaKey(what: 'toggle' | 'next' | 'prev' | 'pause') {
    const first = this.playingNow()[0]
    if (!first) return false
    // A page with no track list still answers a skip: ten seconds of it.
    if (what === 'next' && !first.next) return this.mediaCommand(first.tabId, 'skip', 10)
    if (what === 'prev' && !first.prev) return this.mediaCommand(first.tabId, 'skip', -10)
    return this.mediaCommand(first.tabId, what)
  }

  /** Whether a picture's area is being drawn over the page right now. */
  private choosingArea = false

  /** The piece the reader drew, in the page's own coordinates. */
  async captureArea(webContentsId: number, rect: { x: number; y: number; width: number; height: number }) {
    this.choosingArea = false
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    const wc = tab?.wc
    if (!wc || wc.isDestroyed() || tab.id !== this.activeId) return false
    // Nothing drawn: the visible part, which is what a click without a drag
    // asks for.
    try {
      if (rect.width < 4 || rect.height < 4) return this.editPicture(await wc.capturePage())
      const image = await wc.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
      return this.editPicture(image)
    } catch {
      this.send('toast', t('Не удалось сохранить снимок'))
      return false
    }
  }

  /**
   * The whole scroll of the page. capturePage stops at the viewport, so this
   * goes through the debugger protocol, which is the only way to ask
   * Chromium for more than is on screen. Devtools hold that connection, so
   * when they are open this quietly settles for what is visible.
   */
  private async wholePage(wc: Electron.WebContents) {
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    } catch {
      return wc.capturePage()
    }
    try {
      const metrics = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as {
        cssContentSize?: { width: number; height: number }
      }
      const size = metrics.cssContentSize
      const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        // A page can be tens of thousands of pixels tall; past this it is a
        // picture nobody can look at and a file nobody can open.
        clip: size
          ? {
              x: 0,
              y: 0,
              width: Math.min(size.width, 8000),
              height: Math.min(size.height, 20000),
              scale: 1
            }
          : undefined
      })) as { data: string }
      return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
    } catch {
      return wc.capturePage()
    } finally {
      try {
        wc.debugger.detach()
      } catch {
        /* it was not ours to detach */
      }
    }
  }

  /** Writes the picture where downloads go, and puts it on the clipboard. */
  /**
   * The picture, handed to the person before it is kept.
   *
   * A screenshot is taken to point at something and to hide the rest, and
   * neither can be done once it is already a file. So it stops in the editor
   * first; keeping it is a button there.
   */
  private editPicture(image: Electron.NativeImage) {
    if (image.isEmpty()) return false
    this.setOverlayMode('shot', { focus: true })
    this.overlay.webContents.send('shot:open', image.toDataURL())
    return true
  }

  /** What the editor's "save" does: the file, and the clipboard, as before. */
  keepDataUrl(data: string): boolean {
    try {
      const image = nativeImage.createFromDataURL(data)
      return this.keepPicture(image)
    } catch {
      this.send('toast', t('Не удалось сохранить снимок'))
      return false
    }
  }

  copyDataUrl(data: string): boolean {
    try {
      const image = nativeImage.createFromDataURL(data)
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      this.send('toast', t('Скопировано'))
      return true
    } catch {
      return false
    }
  }

  private keepPicture(image: Electron.NativeImage) {
    if (image.isEmpty()) return false
    const png = image.toPNG()
    clipboard.writeImage(image)
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .slice(0, 19)
    let host = 'page'
    try {
      host = new URL(this.getActive()?.url ?? '').hostname.replace(/^www\./, '') || 'page'
    } catch {
      /* a page with no address of its own */
    }
    const dir = settings.get().downloadDir || app.getPath('downloads')
    const file = join(dir, `${host}-${stamp}.png`)
    try {
      writeFileSync(file, png)
    } catch {
      this.send('toast', t('Не удалось сохранить снимок'))
      return false
    }
    this.send('toast', t('Снимок сохранён и скопирован'))
    return true
  }

  /**
   * Reading mode on or off for the tab in front. The page does the reading
   * and the drawing; this hands it the look — the theme it should match and
   * the word for minutes in the language the browser is speaking.
   */
  toggleReader() {
    this.withActive((wc) => {
      wc.send('reader:words', { minutes: t('мин') })
      wc.send('reader:toggle', {
        dark: nativeTheme.shouldUseDarkColors,
        size: 19,
        serif: false
      })
    })
  }

  /** What the page says came of it, and the one case worth a word. */
  handleReaderState(webContentsId: number, state: { on: boolean; nothing?: boolean }) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab) return
    tab.reading = state.on === true
    if (state.nothing) this.send('toast', t('Здесь нечего читать'))
    this.broadcast()
  }

  find(text: string, forward = true) {
    this.findQuery = text
    this.withActive((wc) => {
      if (text) {
        // Always as a search that continues. Chromium counts out loud only
        // for those — a request that opens a search reports nothing at all,
        // which is measured, and is why this box could never say how many
        // there were. Different words are a new search to it either way, and
        // the same words again are the step to the next match.
        wc.findInPage(text, { forward, findNext: true })
      } else {
        wc.stopFindInPage('clearSelection')
        this.send('state:find', { query: '', matches: 0, active: 0 })
      }
    })
  }

  stopFind() {
    this.findQuery = ''
    this.withActive((wc) => wc.stopFindInPage('clearSelection'))
    this.send('state:find', { query: '', matches: 0, active: 0 })
  }

  openDevTools() {
    this.withActive((wc) => wc.openDevTools({ mode: 'detach' }))
  }

  openExternal(url: string) {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  }

  /** The printers Windows knows about, for the browser's own print sheet. */
  async printers(): Promise<Array<{ name: string; description: string; isDefault: boolean }>> {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed()) return []
    try {
      const list = await wc.getPrintersAsync()
      return list.map((printer) => ({
        name: printer.name,
        description: printer.displayName || printer.description || '',
        // Which one Windows would have used is not a field of its own; it is
        // one of the platform options, as a string.
        isDefault:
          String((printer.options as unknown as Record<string, unknown>)?.['printer-is-default']) === 'true'
      }))
    } catch (error) {
      log('printers', String(error))
      return []
    }
  }

  /**
   * Prints to a named printer with no dialog of Windows' own, because the one
   * Electron would open never appears. A printer that asks for a filename —
   * "Microsoft Print to PDF" is one — puts up its own window and answers when
   * that window is answered, so nothing is reported until then.
   */
  printTo(deviceName: string, options: PrintOptions) {
    this.withActive((wc) => {
      try {
        wc.print(
          {
            silent: true,
            deviceName,
            copies: Math.max(1, Math.min(50, Math.round(options.copies))),
            landscape: options.landscape,
            color: options.colour,
            printBackground: options.background,
            scaleFactor: Math.max(25, Math.min(200, Math.round(options.scale))),
            pageSize: options.paper,
            margins: marginsForPrint(options.margins),
            duplexMode: options.duplex ? 'longEdge' : 'simplex',
            header: options.headers ? ' ' : undefined,
            footer: options.headers ? ' ' : undefined,
            ...(pageRanges(options.pages).length > 0
              ? { pageRanges: pageRanges(options.pages) }
              : {})
          },
          (ok, reason) => {
            if (ok) return this.send('toast', t('Отправлено на печать'))
            if (reason === 'cancelled') return
            log('print', reason)
            this.send('toast', t('Не удалось напечатать'))
          }
        )
      } catch (error) {
        log('print', String(error))
        this.send('toast', t('Не удалось напечатать'))
      }
    })
  }

  /**
   * The pages as they will be printed, for the print sheet to show. Same
   * call as the one that makes the file, so the preview cannot disagree
   * with what comes out.
   */
  async printPreview(options: PrintOptions): Promise<Uint8Array | null> {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed()) return null
    try {
      return await wc.printToPDF(pdfOptions(options))
    } catch (error) {
      log('printPreview', String(error))
      return null
    }
  }

  /** The page as a PDF file, which is the other half of what printing is for. */
  async printPdf(options: PrintOptions): Promise<boolean> {
    const tab = this.getActive()
    const wc = tab?.wc
    if (!tab || !wc || wc.isDestroyed()) return false
    const safe = (tab.title || 'page').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80)
    const picked = await dialog.showSaveDialog(this.win, {
      title: t('Сохранить как PDF'),
      defaultPath: join(app.getPath('downloads'), `${safe || 'page'}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (picked.canceled || !picked.filePath) return false
    try {
      const data = await wc.printToPDF(pdfOptions(options))
      writeFileSync(picked.filePath, data)
      this.send('toast', t('Сохранено в PDF'))
      return true
    } catch (error) {
      log('printToPDF', String(error))
      this.send('toast', t('Не удалось сохранить PDF'))
      return false
    }
  }

  /* ------------------------------------------------------------ translate */

  /**
   * Translates the open page, or puts it back if it is already translated.
   *
   * The reader is told where the text goes before it goes: the engine has no
   * translator of its own, so this is a public Google endpoint, and the text
   * of the page is what it receives.
   */
  translatePage() {
    const tab = this.getActive()
    const wc = tab?.wc
    if (!tab || !wc || wc.isDestroyed() || !/^https?:/i.test(tab.url)) return false
    if (tab.translated) {
      wc.send('translate:restore')
      tab.translated = false
      this.send('toast', t('Показан оригинал'))
      this.broadcast()
      return true
    }
    this.send('toast', t('Переводим — текст страницы уходит в Google Переводчик'))
    wc.send('translate:start', { to: translateTarget() })
    return true
  }

  /** A page finished translating itself. */
  translationDone(webContentsId: number, count: number) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab) return
    tab.translated = count > 0
    if (tab.id === this.activeId) {
      this.send('toast', count > 0 ? t('Страница переведена') : t('Переводить нечего'))
    }
    this.broadcast()
  }

  /**
   * Saves the page as a file. HTMLComplete rather than the single .html:
   * a page saved without its images and stylesheets is a page nobody can
   * read later, which is the only reason to save one.
   */
  async savePage() {
    const tab = this.getActive()
    const wc = tab?.wc
    if (!tab || !wc || wc.isDestroyed()) return false
    const safe = (tab.title || 'page').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80)
    const picked = await dialog.showSaveDialog(this.win, {
      title: t('Сохранить страницу'),
      defaultPath: join(app.getPath('downloads'), `${safe || 'page'}.html`),
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (picked.canceled || !picked.filePath) return false
    try {
      await wc.savePage(picked.filePath, 'HTMLComplete')
      this.send('toast', t('Страница сохранена'))
      return true
    } catch (error) {
      log('savePage', String(error))
      this.send('toast', t('Не удалось сохранить страницу'))
      return false
    }
  }

  /** Puts the page on the home page, next to the other tiles. */
  addToHome() {
    const tab = this.getActive()
    if (!tab?.hasContent || !/^https?:/i.test(tab.url)) return false
    const current = settings.get().favorites
    if (current.some((item) => item.url === tab.url)) {
      this.send('toast', t('Уже на главной'))
      return false
    }
    const title =
      (tab.title || '').trim() || tab.url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]
    settings.patch({
      favorites: [...current, { id: randomUUID(), title: title.slice(0, 60), url: tab.url }]
    })
    this.send('toast', t('Добавлено на главную'))
    return true
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

  /* -------------------------------------------------------- big groups */

  /** The tabs of the group in force — the ones the strip is made of. */
  private here(): Tab[] {
    return this.tabs.filter((tab) => tab.space === this.spaceId)
  }

  /**
   * Puts a new order for this group's tabs back into the whole list, leaving
   * every other group's tabs where they were.
   */
  private replaceHere(order: Tab[]) {
    const start = this.tabs.findIndex((tab) => tab.space === this.spaceId)
    const others = this.tabs.filter((tab) => tab.space !== this.spaceId)
    const at =
      start === -1
        ? others.length
        : this.tabs.slice(0, start).filter((tab) => tab.space !== this.spaceId).length
    this.tabs = [...others.slice(0, at), ...order, ...others.slice(at)]
  }

  /** The big groups as the strip draws them. */
  private spacesForUi(): TabSpace[] {
    return this.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      colour: space.colour,
      count: this.tabs.filter((tab) => tab.space === space.id).length,
      active: space.id === this.spaceId,
      pinned: space.pinned === true
    }))
  }

  private sendSpaces() {
    this.send('state:spaces', this.spacesForUi())
  }

  /**
   * Everything the interface cannot work without, for a window that has
   * just loaded. These three only ever arrived as a push, so a renderer
   * that came up between two of them had no tabs and no groups until
   * something happened to cause the next one.
   */
  snapshot() {
    return {
      tabs: this.here().map((tab) => tab.serialize(this.activeId)),
      groups: this.groups,
      spaces: this.spacesForUi()
    }
  }

  /** A new one, empty, and you are in it. */
  newSpace(name?: string): number {
    const id = ++this.spaceSeq
    this.spaces.push({ id, name: (name ?? '').slice(0, 40), colour: '', pinned: false })
    this.spaceId = id
    // Empty means empty: one blank tab, so there is something to look at.
    this.newTab()
    this.persistSession()
    return id
  }

  switchSpace(id: number) {
    if (!this.spaces.some((space) => space.id === id) || id === this.spaceId) return
    this.spaceId = id
    const here = this.here()
    if (here.length === 0) return void this.newTab()
    // Back to whichever of its tabs was last looked at.
    const last = here.reduce((best, tab) => (tab.lastActive > best.lastActive ? tab : best), here[0])
    this.activeId = last.id
    this.wake(last)
    this.showActive()
    this.persistSession()
    this.broadcast()
  }

  /**
   * Moves a big group in the row. The order is the order of this list, and
   * the strip draws the pinned ones from it, so this is the whole of it.
   */
  moveSpace(id: number, toIndex: number) {
    const from = this.spaces.findIndex((space) => space.id === id)
    if (from === -1) return
    const to = Math.max(0, Math.min(this.spaces.length - 1, Math.round(toIndex)))
    if (from === to) return
    const [moved] = this.spaces.splice(from, 1)
    this.spaces.splice(to, 0, moved)
    this.persistSession()
    this.broadcast()
  }

  editSpace(id: number, patch: { name?: string; colour?: string; pinned?: boolean }) {
    const space = this.spaces.find((item) => item.id === id)
    if (!space) return
    if (patch.name !== undefined) space.name = patch.name.slice(0, 40)
    if (patch.colour !== undefined) space.colour = /^#[0-9a-f]{6}$/i.test(patch.colour) ? patch.colour : ''
    if (patch.pinned !== undefined) space.pinned = patch.pinned
    this.persistSession()
    this.broadcast()
  }

  /**
   * Closes a whole group and everything in it. The last one standing cannot
   * be closed — that would be a browser with nowhere to put a tab.
   */
  closeSpace(id: number) {
    if (this.spaces.length < 2) return
    const index = this.spaces.findIndex((space) => space.id === id)
    if (index === -1) return
    for (const tab of this.tabs.filter((tab) => tab.space === id)) {
      const at = this.tabs.indexOf(tab)
      if (at !== -1) this.tabs.splice(at, 1)
      tab.destroy(this.win)
    }
    this.spaces.splice(index, 1)
    if (this.spaceId === id) {
      this.spaceId = this.spaces[Math.min(index, this.spaces.length - 1)].id
      const here = this.here()
      if (here.length === 0) return void this.newTab()
      this.activeId = here[here.length - 1].id
      this.wake(here[here.length - 1])
    }
    this.showActive()
    this.persistSession()
    this.broadcast()
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

    // Whatever was typed goes first, because it is the one thing certainly
    // meant. An address if it reads like one, a search if it does not —
    // typing "pinterest" used to put six half-remembered addresses above
    // searching for the word itself.
    const direct = normalizeInput(q, s)
    const search: Suggestion = {
      kind: 'search',
      title: q,
      url: normalizeInput(`${q} `, s),
      subtitle: t('Поиск')
    }
    if (!/^https?:\/\/(duckduckgo|www\.google|www\.bing|search|yandex|www\.startpage|www\.mojeek|www\.ecosia|searx)/i.test(direct)) {
      out.unshift({ kind: 'url', title: q, url: direct, subtitle: t('Открыть сайт') })
      out.push(search)
    } else {
      out.unshift(search)
    }

    // A tab and a history entry often share a URL. The tab is listed first and
    // claims the address, so the same page is never offered twice — once to
    // switch to and once to open again.
    const seen = new Set<string>()
    const kept: Suggestion[] = []
    for (const item of out) {
      const same = sameAddress(item.url)
      const key = item.kind === 'tab' ? `tab:${item.tabId}` : same
      if (seen.has(key) || (item.kind !== 'tab' && seen.has(same))) continue
      seen.add(key)
      seen.add(same)
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
    // Both halves of a pair stay on screen while either of them is in front:
    // clicking the page on the right is not a reason to take it away.
    const paired = this.pairShown()
    for (const tab of this.tabs) {
      if (!tab.view) continue
      const shown =
        tab.id === this.activeId ||
        (paired !== null && (tab.id === paired[0].id || tab.id === paired[1].id))
      tab.view.setVisible(shown && tab.hasContent && this.layoutRect.visible)
    }
    this.layout()
    this.focusView()
    // Which page is in front decides whether there is a division to draw —
    // and a pair that has just ended has to be announced too, or the line
    // stays on screen for ever, dividing nothing.
    this.sendSplit()
  }

  /* ----------------------------------------------------------- extensions */

  /**
   * An extension's own window, hanging off its button.
   *
   * Chromium draws these; here the toolbar is the browser's own, so the popup
   * is too: a view of its own holding the extension's page, put under the
   * button, measured to whatever the page turns out to be, and taken away the
   * moment attention moves elsewhere. It is a real extension page — the same
   * origin, the same APIs — because anything less would be a picture of an
   * extension rather than the extension.
   */
  private popup: WebContentsView | null = null
  private popupId = ''
  private popupWatch: ReturnType<typeof setInterval> | null = null

  extensionActions(): ExtensionAction[] {
    return extensionActions()
  }

  /** One more extension, or one fewer: the toolbar is told. */
  sendExtensions() {
    this.send('state:extensions', extensionActions())
  }

  /** Opens, or closes, the popup of one extension. `x` is where its button is. */
  openExtension(id: string, x: number) {
    if (this.popupId === id) return this.closeExtension()
    this.closeExtension()
    const action = extensionActions().find((one) => one.id === id)
    if (!action) return false
    if (!action.popup) {
      // An extension with no page of its own has nothing to show; saying so is
      // better than a window that opens empty.
      this.send('toast', t('У этого расширения нет своего окна'))
      return false
    }

    // An extension's background sleeps until it is needed, and its popup is
    // exactly when it is needed: everything the popup asks for is answered
    // from there, so it is woken before the window opens rather than left to
    // be knocked on by a page that has already given up waiting.
    void this.ses.serviceWorkers
      .startWorkerForScope(`chrome-extension://${id}/`)
      .catch(() => undefined)

    const view = new WebContentsView({
      webPreferences: {
        session: this.ses,
        // The shim has to stand in the extension's own world to be of any use:
        // it is the extension's `chrome.tabs` it is fixing, not a copy of it.
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        preload: join(__dirname, '../preload/extension.js')
      }
    })
    this.popup = view
    this.popupId = id
    view.setBackgroundColor('#00000000')
    this.win.contentView.addChildView(view)
    this.place(view, x, 360, 220)
    view.webContents.loadURL(action.popup).catch((error) => {
      log('extension popup failed: ' + String(error))
      this.closeExtension()
      this.send('toast', t('Окно расширения не открылось'))
    })
    view.webContents.on('did-fail-load', (_e, code, description, url) =>
      log(`extension popup ${code} ${description} ${url}`)
    )

    const fit = () => this.fitExtension(x)
    view.webContents.on('did-finish-load', () => {
      fit()
      view.webContents.focus()
    })
    // A popup grows and shrinks as it is used — a menu opens, a list fills in.
    this.popupWatch = setInterval(fit, 400)
    view.webContents.on('blur', () => setTimeout(() => this.closeExtension(), 120))
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.newTab(url)
      this.closeExtension()
      return { action: 'deny' }
    })
    return true
  }

  /** Where a popup sits: under its button, and never off the window's edge. */
  private place(view: WebContentsView, x: number, width: number, height: number) {
    const bounds = this.win.getContentBounds()
    const top = Math.round(this.layoutRect.y > 0 ? this.layoutRect.y - 4 : 40)
    const left = Math.max(8, Math.min(Math.round(x - width / 2), bounds.width - width - 8))
    view.setBounds({ x: left, y: top, width, height })
    view.setBorderRadius(12)
  }

  /** Measures the extension's page and gives it exactly that much room. */
  private fitExtension(x: number) {
    const view = this.popup
    if (!view || view.webContents.isDestroyed()) return
    void view.webContents
      .executeJavaScript(
        `[Math.ceil(Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)),
          Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))]`,
        false
      )
      .then((size: [number, number]) => {
        if (!this.popup || this.popup !== view) return
        const bounds = this.win.getContentBounds()
        const width = Math.max(180, Math.min(Math.round(size[0]) + 2, 760, bounds.width - 16))
        const height = Math.max(80, Math.min(Math.round(size[1]) + 2, 620, bounds.height - 80))
        const at = view.getBounds()
        if (Math.abs(at.width - width) < 2 && Math.abs(at.height - height) < 2) return
        this.place(view, x, width, height)
      })
      .catch(() => undefined)
  }

  /** This window's tabs, in the shape an extension expects to be given. */
  extensionTabs() {
    return this.here()
      .filter((tab) => tab.wc && !tab.wc.isDestroyed())
      .map((tab, index) => ({
        id: tab.wc?.id ?? 0,
        index,
        windowId: 1,
        active: tab.id === this.activeId,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favicon ?? '',
        audible: tab.wc?.isCurrentlyAudible() ?? false,
        muted: tab.muted,
        pinned: tab.pinned,
        incognito: this.incognito,
        width: Math.round(this.layoutRect.width),
        height: Math.round(this.layoutRect.height)
      }))
  }

  /** The tab an extension names, found by the id it was given. */
  private byContentsId(id: number) {
    return this.tabs.find((tab) => tab.wc?.id === id)
  }

  extensionTabCreate(url: string, active: boolean) {
    const id = this.newTab(url || undefined, !active)
    const tab = this.tabs.find((one) => one.id === id)
    return this.extensionTabs().find((one) => one.id === tab?.wc?.id) ?? null
  }

  extensionTabUpdate(id: number, patch: { url: string; active: boolean; muted: boolean | null }) {
    const tab = id === 0 ? this.getActive() : this.byContentsId(id)
    if (!tab) return null
    if (patch.url) this.navigate(patch.url, tab.id)
    if (patch.active) this.switchTab(tab.id)
    if (patch.muted !== null) tab.wc?.setAudioMuted(patch.muted)
    this.broadcast()
    return this.extensionTabs().find((one) => one.id === tab.wc?.id) ?? null
  }

  extensionTabRemove(ids: number[]) {
    for (const id of ids) {
      const tab = this.byContentsId(id)
      if (tab) this.closeTab(tab.id)
    }
    return true
  }

  extensionTabReload(id: number) {
    const tab = id === 0 ? this.getActive() : this.byContentsId(id)
    if (!tab?.wc || tab.wc.isDestroyed()) return false
    tab.wc.reload()
    return true
  }

  closeExtension() {
    if (this.popupWatch) clearInterval(this.popupWatch)
    this.popupWatch = null
    const view = this.popup
    this.popup = null
    this.popupId = ''
    if (!view) return false
    try {
      this.win.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      /* already gone */
    }
    this.focusView()
    return true
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

  /** Room around the card inside the overlay's own bounds, for its shadow. */
  private static readonly OFFER_MARGIN = 20

  /**
   * A page reported that it has a login form at all. Nothing is shown for this
   * on its own — the offer belongs under the field, and which field that is
   * nobody knows until it is clicked.
   */
  handleAutofillForm(_webContentsId: number, _host: string) {}

  /**
   * Someone clicked a login box. If something is saved for this site the offer
   * opens under the box — or, when the vault is shut, a notice in the corner
   * asking for the master password, which is the only thing standing between
   * the click and the password.
   */
  handleAutofillField(
    webContentsId: number,
    host: string,
    kind: 'login' | 'card' | 'address' | 'code' | 'new-password',
    rect: { x: number; y: number; width: number; height: number },
    postsTo = ''
  ) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab || tab.id !== this.activeId) return
    if (this.hideOffer) {
      clearTimeout(this.hideOffer)
      this.hideOffer = null
    }
    // A password belongs to a host; a card and an address belong to the
    // person, and are the same wherever they are buying.
    const forHost = kind === 'login' || kind === 'code' ? vault.forOrigin(host) : []
    // A box asking for six digits is only worth an offer where there is a
    // code to put in it.
    const matches = kind === 'code' ? forHost.filter((e) => e.code) : forHost
    const cards = kind === 'card' && !vault.locked ? vault.cards() : []
    const addresses = kind === 'address' && !vault.locked ? vault.addresses() : []
    const count =
      kind === 'card'
        ? cards.length
        : kind === 'address'
          ? addresses.length
          : kind === 'new-password'
            ? 1
            : matches.length
    // Nothing to offer, and — with the vault shut — nothing worth asking
    // to open it for unless this site has a password saved.
    if (count === 0 && !(vault.locked && kind === 'login' && vault.count > 0)) {
      return this.closeOffer()
    }
    this.field = { webContentsId, host, kind, ...rect }
    const margin = BrowserWindow.OFFER_MARGIN

    if (vault.locked) {
      if (this.noticeDismissed.has(host)) return
      // Already up: leave it alone. Re-showing it on every focus is what
      // made it jitter — it takes the keyboard, the page reports its field
      // lost focus, the card closes, the keyboard goes back, and round.
      if (this.overlayMode === 'autofill' && this.noticeUp) return
      this.noticeUp = true
      this.send('state:autofill', {
        host,
        kind,
        locked: true,
        entries: [],
        cards: [],
        addresses: []
      })
      return this.setOverlayMode('autofill', {
        bounds: this.noticeBounds(380, 210),
        // The master password is typed into this card, so it takes the keyboard.
        focus: true
      })
    }

    const year = Date.now() - 365 * 24 * 60 * 60 * 1000
    this.send('state:autofill', {
      host,
      kind,
      locked: false,
      // `origin` travels so the offer can say where a credential came from when
      // it was not saved on this exact address.
      entries: matches.map(({ id, username, origin, created, code }) => ({
        id,
        username,
        origin,
        code,
        // Said in the offer rather than in a notification: the moment somebody
        // is signing in is the one moment a reminder to change the password is
        // about something they are already doing.
        old: created < year
      })),
      cards,
      addresses,
      postsTo
    })
    this.setOverlayMode('autofill', {
      bounds: this.offerBounds(rect, count, kind, Boolean(postsTo)),
      focus: false
    })
  }

  /** The page area, in window coordinates, as the interface reported it. */
  private contentBox() {
    const over = this.edgeOverflow()
    return {
      x: over.left + this.layoutRect.x,
      y: over.top + this.layoutRect.y,
      width: this.layoutRect.width,
      height: this.layoutRect.height
    }
  }

  /**
   * The card sits under the field and as wide as it, never narrower than a
   * name needs — unless there is no room below, where it goes above instead,
   * the way every menu near the bottom of a screen does.
   */
  private offerBounds(
    rect: { x: number; y: number; width: number; height: number },
    count: number,
    kind: 'login' | 'card' | 'address' | 'code' | 'new-password' = 'login',
    warned = false
  ) {
    const margin = BrowserWindow.OFFER_MARGIN
    const inner = this.contentBox()
    const width = Math.round(Math.max(260, Math.min(420, rect.width)))
    // Six rows before it starts scrolling: four was a keyhole for anyone with
    // a handful of cards or accounts on one site.
    const height =
      kind === 'new-password'
        ? 150 + (warned ? 34 : 0)
        : 12 +
          Math.min(count, 6) * 44 +
          30 +
          (warned ? 34 : 0) +
          // The way to the rest of the vault, under the accounts for this site.
          (kind === 'login' ? 38 : 0)
    const bounds = this.win.getBounds()
    let x = Math.round(inner.x + rect.x)
    let y = Math.round(inner.y + rect.y + rect.height + 4)
    if (y + height > bounds.height - 8) y = Math.round(inner.y + rect.y - height - 4)
    x = Math.max(4, Math.min(x, bounds.width - width - 4))
    y = Math.max(4, y)
    return { x: x - margin, y: y - margin, width: width + margin * 2, height: height + margin * 2 }
  }

  /** A card in the corner, up against the right edge of the page. */
  private noticeBounds(width: number, height: number) {
    const margin = BrowserWindow.OFFER_MARGIN
    const inner = this.contentBox()
    return {
      x: Math.round(inner.x + inner.width - width - 14 - margin),
      y: Math.round(inner.y + 14 - margin),
      width: width + margin * 2,
      height: height + margin * 2
    }
  }

  /** The page said the field lost focus; the card goes with it. */
  hideAutofill(webContentsId: number) {
    const tab = this.tabs.find((t) => t.wc?.id === webContentsId)
    if (!tab || tab.id !== this.activeId) return
    // The locked-vault card asked for the keyboard, which is why the field
    // lost it. It closes when it is answered, not when it is opened.
    if (this.noticeUp) return
    // Not at once: clicking the card is itself what takes focus off the field,
    // and closing on that would mean the card could never be used.
    if (this.hideOffer) clearTimeout(this.hideOffer)
    this.hideOffer = setTimeout(() => {
      this.hideOffer = null
      this.closeOffer()
    }, 220)
  }

  private closeOffer() {
    this.field = null
    this.noticeUp = false
    if (this.overlayMode === 'autofill') this.setOverlayMode(null)
  }

  /**
   * The offer becomes a search over the whole vault. That needs the keyboard,
   * which the small card under the field deliberately never takes — so it
   * moves to the corner and takes it, the way the locked-vault notice does.
   */
  openOfferSearch() {
    if (!this.field || vault.locked) return
    this.noticeUp = true
    this.setOverlayMode('autofill', { bounds: this.noticeBounds(400, 360), focus: true })
  }

  /** Shuts the offer without remembering anything about the site. */
  closeOfferNow() {
    this.closeOffer()
  }

  /**
   * A password made in the offer, put into every password box on the form.
   * A change-password form has two or three of them and expects the same
   * value in each; a sign-up has one.
   */
  fillNewPassword(password: string): boolean {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed() || !password) return false
    let host = ''
    try {
      host = new URL(wc.getURL()).host
    } catch {
      return false
    }
    wc.send('autofill:fill-new', { host, password })
    return true
  }

  /** "Not now" on the locked notice: not for this site, not this time. */
  dismissVaultNotice() {
    if (this.field) this.noticeDismissed.add(this.field.host)
    this.closeOffer()
  }

  /**
   * The vault opened while an offer was up. What started all this was a click
   * on a login box, so the offer comes straight back — with the passwords in
   * it this time.
   */
  reofferAutofill() {
    const field = this.field
    if (!field || vault.locked) return
    this.handleAutofillField(field.webContentsId, field.host, field.kind, field)
  }

  /**
   * A page submitted credentials. Worth asking about only when the answer
   * could change something: a password the vault already has for that name,
   * unchanged, is the one the browser just filled in, and asking to save it
   * again is noise.
   */
  handleAutofillSubmitted(host: string, username: string, password: string) {
    if (!password) return
    // Offering to save a password from a private window would be the one
    // thing it promised not to do.
    if (this.incognito) return
    const existing = vault.forOrigin(host).find((e) => e.username === username)
    if (existing && !vault.locked && vault.reveal(existing.id) === password) return
    this.pendingCredential = { host, username, password }
    this.send('state:save-password', { host, username, password, known: Boolean(existing) })
    this.setOverlayMode('save-password', {
      bounds: this.noticeBounds(400, 244),
      focus: true
    })
  }

  private pendingCredential: { host: string; username: string; password: string } | null = null

  /**
   * The answer to that question, with whatever was edited in the card. The
   * password can be changed there because the one the page sent is not
   * always the one worth keeping — a typo, or a generated password the
   * reader wants to adjust before it is the only copy.
   */
  confirmSavePassword(save: boolean, username?: string, password?: string): boolean {
    const pending = this.pendingCredential
    this.pendingCredential = null
    if (this.overlayMode === 'save-password') this.setOverlayMode(null)
    if (!save || !pending) return false
    const ok = vault.save(
      pending.host,
      username ?? pending.username,
      password || pending.password
    )
    this.send('toast', ok ? t('Пароль сохранён') : t('Хранилище паролей заблокировано'))
    return ok
  }

  /** Pushes a saved credential into the active page after a user action. */
  /**
   * Puts a card into the page. A card is not tied to a site the way a
   * password is — it is the same card wherever you are buying — so there is
   * nothing to match against; what stands in for that is that it goes
   * nowhere until somebody picks it. The security code is not sent, because
   * it is not kept: those three digits are the part a person types.
   */
  fillCard(id: string): boolean {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed() || vault.locked) return false
    const card = vault.cards().find((c) => c.id === id)
    if (!card) return false
    const number = vault.revealCard(id)
    if (!number) return false
    let host = ''
    try {
      host = new URL(wc.getURL()).host
    } catch {
      return false
    }
    wc.send('autofill:fill-card', {
      host,
      number,
      holder: card.holder,
      month: card.month,
      year: card.year
    })
    vault.touchCard(id)
    return true
  }

  /** The same for an address: chosen by a person, then filled in one go. */
  fillAddress(id: string): boolean {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed() || vault.locked) return false
    const fields = vault.revealAddress(id)
    if (!fields) return false
    let host = ''
    try {
      host = new URL(wc.getURL()).host
    } catch {
      return false
    }
    wc.send('autofill:fill-address', { host, fields })
    vault.touchAddress(id)
    return true
  }

  /**
   * The six digits for this entry, put into the box that asked for them.
   * Nothing is kept: the code is read, sent, and gone in thirty seconds.
   */
  fillCode(id: string): boolean {
    const wc = this.getActive()?.wc
    if (!wc || wc.isDestroyed() || vault.locked) return false
    const code = vault.code(id)
    if (!code) return false
    let host = ''
    try {
      host = new URL(wc.getURL()).host
    } catch {
      return false
    }
    wc.send('autofill:fill-code', { host, digits: code.digits })
    vault.touch(id)
    return true
  }

  fillCredential(id: string, anywhere = false): boolean {
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
    //
    // `anywhere` is the one exception, and it is not a weakening of that rule
    // but a different act: somebody searched the whole vault from this form
    // and picked this entry by name. The browser is not deciding what belongs
    // here — a person is, for one field, once.
    if (!anywhere && !vault.matches(host, entry)) return false
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
      // Our own pages count too: settings and history were open windows onto
      // the browser, and losing them on restart is losing where you were.
      const kept = this.tabs.filter(
        (t) => t.internal !== null || (t.hasContent && /^https?:/i.test(t.url))
      )
      const payload = {
        tabs: kept.map((t) => ({
          url: t.url,
          title: t.title,
          favicon: t.favicon,
          pinned: t.pinned,
          groupId: t.groupId,
          space: t.space,
          internal: t.internal,
          scroll: t.scroll > 0 ? Math.round(t.scroll) : undefined
        })),
        spaces: this.spaces,
        spaceId: this.spaceId,
        // Only the groups that still have a saved tab in them: restoring an
        // empty group would put a name over nothing.
        groups: this.groups.filter((g) => kept.some((t) => t.groupId === g.id)),
        activeIndex: kept.findIndex((t) => t.id === this.activeId),
        // Two pages put side by side stay side by side tomorrow: the pair is
        // as much a part of how the window was left as which tabs were open.
        splitPair: this.pair
          ? [
              kept.findIndex((t) => t.id === (this.pair as [number, number])[0]),
              kept.findIndex((t) => t.id === (this.pair as [number, number])[1])
            ]
          : null,
        splitRatio: this.splitRatio
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
    let payload: {
      tabs: PersistedTab[]
      activeIndex: number
      splitPair?: [number, number] | null
      splitRatio?: number
      groups?: TabGroup[]
      spaces?: Array<{ id: number; name: string; colour: string; pinned?: boolean }>
      spaceId?: number
    }
    try {
      payload = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
    if (!Array.isArray(payload.tabs) || payload.tabs.length === 0) return false

    // Groups first: a restored tab needs its group to exist before it can
    // point at it, and the ids have to keep meaning what they meant.
    // `pinned` is newer than the first sessions written, so a group saved
    // before it existed comes back unpinned rather than undefined.
    this.groups = (payload.groups ?? []).map((group) => ({ ...group, pinned: group.pinned === true }))
    this.groupSeq = this.groups.reduce((top, group) => Math.max(top, group.id), 0)
    const knownGroup = new Set(this.groups.map((group) => group.id))

    // The big groups, before the tabs that name them. A session written
    // before they existed comes back as the one nameless group everything
    // was already in.
    if (Array.isArray(payload.spaces) && payload.spaces.length > 0) {
      this.spaces = payload.spaces.map((space) => ({
        id: space.id,
        name: String(space.name ?? '').slice(0, 40),
        colour: /^#[0-9a-f]{6}$/i.test(String(space.colour)) ? String(space.colour) : '',
        pinned: space.pinned === true
      }))
      this.spaceSeq = this.spaces.reduce((top, space) => Math.max(top, space.id), 1)
      this.spaceId = this.spaces.some((space) => space.id === payload.spaceId)
        ? (payload.spaceId as number)
        : this.spaces[0].id
    }
    const knownSpace = new Set(this.spaces.map((space) => space.id))

    const lazy = settings.get().lazyRestore
    payload.tabs.slice(0, 40).forEach((saved, index) => {
      const isActive = index === Math.max(0, payload.activeIndex)
      const tab = new Tab(++this.seq, this.ses)
      tab.title = saved.title || saved.url
      tab.favicon = saved.favicon
      tab.url = saved.url
      tab.hasContent = true
      tab.internal = saved.internal ?? null
      tab.restoreScroll = Number(saved.scroll) > 0 ? Number(saved.scroll) : 0
      tab.pinned = saved.pinned === true
      tab.space = knownSpace.has(saved.space as number) ? (saved.space as number) : this.spaces[0].id
      tab.groupId =
        saved.groupId !== undefined && saved.groupId !== null && knownGroup.has(saved.groupId)
          ? saved.groupId
          : null
      this.tabs.push(tab)

      // Only the tab you were last looking at spends a process on startup —
      // and one of our own pages spends none at all, because the interface
      // draws it itself.
      if (tab.internal === null && (isActive || !lazy)) {
        tab.ensureView(this.wire)
        if (tab.view) this.win.contentView.addChildView(tab.view)
        this.raiseOverlay()
        tab.load(saved.url)
      }
      if (isActive) this.activeId = tab.id
    })

    // The two that were side by side, found again by their places in the list
    // that was saved.
    const saved = payload.splitPair
    if (Array.isArray(saved) && saved.length === 2) {
      const first = this.tabs[saved[0]]
      const second = this.tabs[saved[1]]
      if (first && second && first !== second) {
        this.pair = [first.id, second.id]
        const ratio = Number(payload.splitRatio)
        if (ratio >= 0.2 && ratio <= 0.8) this.splitRatio = ratio
        this.summon(first)
        this.summon(second)
      }
    }

    if (this.activeId === -1 && this.tabs[0]) this.activeId = this.tabs[0].id
    // A big group whose tabs were all blank saves nothing, and comes back
    // empty. Whichever one the window opens on gets a tab either way.
    if (this.here().length === 0) {
      this.newTab()
      return true
    }
    if (this.tabs.every((tab) => tab.id !== this.activeId)) this.activeId = this.here()[0].id
    this.reorderStrip()
    this.showActive()
    this.sendGroups()
    this.broadcast()
    return true
  }

  async clearData() {
    await clearBrowsingData(this.ses)
    history.clear()
    // Half-typed forms are site data like any other: "clear site data" has to
    // mean it, or the word is worth nothing.
    drafts.clear()
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
