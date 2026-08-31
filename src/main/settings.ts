import { app } from 'electron'
import { JsonStore, track } from './store'
import type {
  BackgroundSettings,
  Favorite,
  PermissionSettings,
  Settings,
  StartPageSettings
} from '../shared/types'

/** Bump when the shape changes in a way sanitize() cannot infer. */
export const SETTINGS_VERSION = 1

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'aurora',
  intensity: 'medium',
  file: '',
  fit: 'cover',
  blur: 0,
  dim: 20,
  muted: true,
  speed: 1,
  pauseWhenBrowsing: true
}

export const DEFAULT_PERMISSIONS: PermissionSettings = {
  camera: 'ask',
  microphone: 'ask',
  geolocation: 'ask',
  notifications: 'block',
  clipboard: 'ask',
  midi: 'block',
  usb: 'block',
  fullscreen: 'allow',
  download: 'ask'
}

export const DEFAULT_START_PAGE: StartPageSettings = {
  greeting: true,
  clock: true,
  favorites: true,
  recent: true,
  stats: true,
  closed: true,
  columns: 8
}

const fav = (title: string, url: string, icon?: string): Favorite => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  title,
  url,
  icon
})

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#7C6CFF',
  radius: 14,
  compact: false,
  glass: true,
  reduceMotion: false,
  animationSpeed: 1,
  background: { ...DEFAULT_BACKGROUND },

  tabPosition: 'top',
  tabAutoHide: false,
  railWidth: 232,
  tabMaxWidth: 230,
  closeButton: 'hover',
  newTabAfterCurrent: false,
  middleClickClose: true,
  confirmCloseMultiple: true,

  startPage: { ...DEFAULT_START_PAGE },
  favorites: [
    fav('DuckDuckGo', 'https://duckduckgo.com', '🦆'),
    fav('GitHub', 'https://github.com', '🐙'),
    fav('YouTube', 'https://youtube.com', '▶️'),
    fav('Wikipedia', 'https://wikipedia.org', '📚'),
    fav('Reddit', 'https://reddit.com', '👽'),
    fav('Hacker News', 'https://news.ycombinator.com', '📰'),
    fav('MDN', 'https://developer.mozilla.org', '📘'),
    fav('ChatGPT', 'https://chat.openai.com', '🤖')
  ],
  searchEngine: 'duckduckgo',
  customSearchUrl: 'https://searx.be/search?q=%s',
  historySuggestions: true,
  homepage: '',

  blockAds: true,
  blockTrackers: true,
  blockCrypto: true,
  filterLists: true,
  cosmeticFiltering: true,
  customBlocked: [],
  customAllowed: [],
  httpsOnly: true,
  blockThirdPartyCookies: true,
  doNotTrack: true,
  stripTrackingParams: true,
  permissions: { ...DEFAULT_PERMISSIONS },
  saveHistory: true,
  clearOnExit: false,
  webrtcPolicy: 'public_only',
  spellcheck: true,
  spellcheckLanguages: ['ru', 'en-US'],

  hardwareAcceleration: true,
  preconnect: true,
  prefetchDns: true,
  smoothScrolling: true,
  sleepBackgroundTabs: true,
  sleepAfterMinutes: 20,
  lazyRestore: true,
  restoreSession: true,
  cacheSizeMb: 512,
  defaultZoom: 0,

  downloadDir: '',
  askWhereToSave: false
}

/* -------------------------------------------------------------- validation */
const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const str = (v: unknown, max: number, fallback: string) =>
  typeof v === 'string' ? v.slice(0, max) : fallback

const POLICY = ['ask', 'allow', 'block'] as const
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i

const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,8})?$/

/** BCP-47-ish codes only; unknown ones are dropped again by the session. */
const localeList = (v: unknown, fallback: string[]) =>
  Array.isArray(v)
    ? [...new Set(v.filter((c): c is string => typeof c === 'string' && LOCALE_RE.test(c.trim())).map((c) => c.trim()))].slice(0, 8)
    : fallback

const domainList = (v: unknown, fallback: string[]) =>
  Array.isArray(v)
    ? [...new Set(v.filter((d): d is string => typeof d === 'string' && HOST_RE.test(d.trim())).map((d) => d.trim().toLowerCase()))].slice(0, 500)
    : fallback

function sanitizeBackground(v: unknown): BackgroundSettings {
  const b = (v ?? {}) as Partial<BackgroundSettings>
  const d = DEFAULT_BACKGROUND
  return {
    kind: oneOf(b.kind, ['off', 'aurora', 'mesh', 'waves', 'image', 'video'] as const, d.kind),
    intensity: oneOf(b.intensity, ['subtle', 'medium', 'vivid'] as const, d.intensity),
    // only a plain file name is ever accepted, so nothing can point outside the folder
    file: /^[\w. -]{1,120}$/.test(String(b.file ?? '')) ? String(b.file) : '',
    fit: oneOf(b.fit, ['cover', 'contain', 'tile', 'center'] as const, d.fit),
    blur: clamp(b.blur, 0, 40, d.blur),
    dim: clamp(b.dim, 0, 85, d.dim),
    muted: bool(b.muted, d.muted),
    speed: clamp(b.speed, 0.25, 2, d.speed),
    pauseWhenBrowsing: bool(b.pauseWhenBrowsing, d.pauseWhenBrowsing)
  }
}

function sanitizePermissions(v: unknown): PermissionSettings {
  const p = (v ?? {}) as Partial<PermissionSettings>
  const d = DEFAULT_PERMISSIONS
  return {
    camera: oneOf(p.camera, POLICY, d.camera),
    microphone: oneOf(p.microphone, POLICY, d.microphone),
    geolocation: oneOf(p.geolocation, POLICY, d.geolocation),
    notifications: oneOf(p.notifications, POLICY, d.notifications),
    clipboard: oneOf(p.clipboard, POLICY, d.clipboard),
    midi: oneOf(p.midi, POLICY, d.midi),
    usb: oneOf(p.usb, POLICY, d.usb),
    fullscreen: oneOf(p.fullscreen, POLICY, d.fullscreen),
    download: oneOf(p.download, POLICY, d.download)
  }
}

function sanitizeStartPage(v: unknown): StartPageSettings {
  const s = (v ?? {}) as Partial<StartPageSettings>
  const d = DEFAULT_START_PAGE
  return {
    greeting: bool(s.greeting, d.greeting),
    clock: bool(s.clock, d.clock),
    favorites: bool(s.favorites, d.favorites),
    recent: bool(s.recent, d.recent),
    stats: bool(s.stats, d.stats),
    closed: bool(s.closed, d.closed),
    columns: clamp(s.columns, 4, 12, d.columns)
  }
}

function sanitizeFavorites(v: unknown, fallback: Favorite[]): Favorite[] {
  if (!Array.isArray(v)) return fallback
  const out: Favorite[] = []
  for (const raw of v) {
    if (!raw || typeof raw.url !== 'string') continue
    if (!/^https?:\/\//i.test(raw.url)) continue
    out.push({
      id: str(raw.id, 40, Math.random().toString(36).slice(2, 10)),
      title: str(raw.title, 64, raw.url),
      url: raw.url.slice(0, 2048),
      icon: typeof raw.icon === 'string' ? raw.icon.slice(0, 8) : undefined
    })
    if (out.length >= 40) break
  }
  return out
}

/** Everything read from disk or IPC passes through here before it is used. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS
  return {
    theme: oneOf(input.theme, ['light', 'dark', 'system'] as const, d.theme),
    accent: /^#[0-9a-f]{6}$/i.test(String(input.accent)) ? String(input.accent) : d.accent,
    radius: clamp(input.radius, 0, 28, d.radius),
    compact: bool(input.compact, d.compact),
    glass: bool(input.glass, d.glass),
    reduceMotion: bool(input.reduceMotion, d.reduceMotion),
    animationSpeed: clamp(input.animationSpeed, 0.4, 2, d.animationSpeed),
    background: sanitizeBackground(input.background),

    tabPosition: oneOf(input.tabPosition, ['top', 'left', 'right'] as const, d.tabPosition),
    tabAutoHide: bool(input.tabAutoHide, d.tabAutoHide),
    railWidth: clamp(input.railWidth, 168, 420, d.railWidth),
    tabMaxWidth: clamp(input.tabMaxWidth, 120, 420, d.tabMaxWidth),
    closeButton: oneOf(input.closeButton, ['always', 'hover', 'active'] as const, d.closeButton),
    newTabAfterCurrent: bool(input.newTabAfterCurrent, d.newTabAfterCurrent),
    middleClickClose: bool(input.middleClickClose, d.middleClickClose),
    confirmCloseMultiple: bool(input.confirmCloseMultiple, d.confirmCloseMultiple),

    startPage: sanitizeStartPage(input.startPage),
    favorites: sanitizeFavorites(input.favorites, d.favorites),
    searchEngine: oneOf(
      input.searchEngine,
      ['duckduckgo', 'startpage', 'brave', 'mojeek', 'ecosia', 'google', 'bing', 'yandex', 'custom'] as const,
      d.searchEngine
    ),
    customSearchUrl: /^https:\/\/\S+%s/i.test(String(input.customSearchUrl))
      ? String(input.customSearchUrl).slice(0, 512)
      : d.customSearchUrl,
    historySuggestions: bool(input.historySuggestions, d.historySuggestions),
    homepage: /^https?:\/\//i.test(String(input.homepage)) ? String(input.homepage).slice(0, 2048) : '',

    blockAds: bool(input.blockAds, d.blockAds),
    blockTrackers: bool(input.blockTrackers, d.blockTrackers),
    blockCrypto: bool(input.blockCrypto, d.blockCrypto),
    filterLists: bool(input.filterLists, d.filterLists),
    cosmeticFiltering: bool(input.cosmeticFiltering, d.cosmeticFiltering),
    customBlocked: domainList(input.customBlocked, d.customBlocked),
    customAllowed: domainList(input.customAllowed, d.customAllowed),
    httpsOnly: bool(input.httpsOnly, d.httpsOnly),
    blockThirdPartyCookies: bool(input.blockThirdPartyCookies, d.blockThirdPartyCookies),
    doNotTrack: bool(input.doNotTrack, d.doNotTrack),
    stripTrackingParams: bool(input.stripTrackingParams, d.stripTrackingParams),
    permissions: sanitizePermissions(input.permissions),
    saveHistory: bool(input.saveHistory, d.saveHistory),
    clearOnExit: bool(input.clearOnExit, d.clearOnExit),
    webrtcPolicy: oneOf(input.webrtcPolicy, ['default', 'public_only', 'proxy_only'] as const, d.webrtcPolicy),
    spellcheck: bool(input.spellcheck, d.spellcheck),
    spellcheckLanguages: localeList(input.spellcheckLanguages, d.spellcheckLanguages),

    hardwareAcceleration: bool(input.hardwareAcceleration, d.hardwareAcceleration),
    preconnect: bool(input.preconnect, d.preconnect),
    prefetchDns: bool(input.prefetchDns, d.prefetchDns),
    smoothScrolling: bool(input.smoothScrolling, d.smoothScrolling),
    sleepBackgroundTabs: bool(input.sleepBackgroundTabs, d.sleepBackgroundTabs),
    sleepAfterMinutes: clamp(input.sleepAfterMinutes, 1, 240, d.sleepAfterMinutes),
    lazyRestore: bool(input.lazyRestore, d.lazyRestore),
    restoreSession: bool(input.restoreSession, d.restoreSession),
    cacheSizeMb: clamp(input.cacheSizeMb, 64, 4096, d.cacheSizeMb),
    defaultZoom: clamp(input.defaultZoom, -3, 4, d.defaultZoom),

    downloadDir: str(input.downloadDir, 400, d.downloadDir),
    askWhereToSave: bool(input.askWhereToSave, d.askWhereToSave)
  }
}

/**
 * Settings for the active profile, kept in a durable transactional store.
 * Switching profile re-points the store at that profile's folder.
 */
class SettingsStore {
  private store = track(
    new JsonStore<Settings>(
      'settings.json',
      () => ({ ...DEFAULT_SETTINGS }),
      SETTINGS_VERSION,
      (data) => data as Partial<Settings>, // sanitize() already tolerates old shapes
      sanitize
    )
  )
  private listeners = new Set<(s: Settings) => void>()

  load(dir: string): Settings {
    this.store.open(dir)
    if (!this.store.get().downloadDir) {
      this.store.set({ downloadDir: app.getPath('downloads') })
    }
    this.emit()
    return this.store.get()
  }

  get(): Settings {
    return this.store.get()
  }

  patch(partial: Partial<Settings>): Settings {
    this.store.set(partial)
    this.emit()
    return this.store.get()
  }

  reset(): Settings {
    const downloadDir = this.store.get().downloadDir
    this.store.reset()
    this.store.set({ downloadDir })
    this.emit()
    return this.store.get()
  }

  onChange(fn: (s: Settings) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Forces pending changes to disk (called on quit and on window close). */
  flush() {
    this.store.flush()
  }

  get file() {
    return this.store.file
  }

  private emit() {
    for (const fn of this.listeners) fn(this.store.get())
  }
}

export const settings = new SettingsStore()
