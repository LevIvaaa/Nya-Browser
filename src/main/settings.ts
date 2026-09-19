import { app } from 'electron'
import { JsonStore, track } from './store'

/**
 * The resolvers offered by name, and the RFC 8484 template each one answers on.
 * 'system' is not here: it means not resolving over HTTPS at all.
 */
export const DOH_TEMPLATES: Record<Exclude<DnsProvider, 'system' | 'custom'>, string> = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  adguard: 'https://dns.adguard-dns.com/dns-query'
}

export const DNS_PROVIDERS: DnsProvider[] = [
  'system',
  'cloudflare',
  'google',
  'quad9',
  'adguard',
  'custom'
]
import type {
  BackgroundSettings,
  Container,
  CustomEngine,
  LookPreset,
  DnsProvider,
  Favorite,
  PermissionSettings,
  Settings,
  StartPageSettings,
  WeatherSettings,
  WidgetBox,
  WidgetId
} from '../shared/types'
import {
  DEFAULT_BACKGROUND,
  LOOK_KEYS,
  DEFAULT_MENU,
  DEFAULT_TOOLBAR,
  DEFAULT_PERMISSIONS,
  DEFAULT_PLACE,
  DEFAULT_SETTINGS,
  DEFAULT_START_PAGE
} from '../shared/defaults'
import { DEFAULT_LAYOUT, GRID_COLUMNS } from '../shared/startPage'
import { MENU_IDS, TOOLBAR_IDS } from '../shared/chrome'
import { SHORTCUT_IDS, isCombo } from '../shared/shortcuts'
import { isKnownLanguage } from '../shared/i18n'

/** Bump when the shape changes in a way sanitize() cannot infer. */
export const SETTINGS_VERSION = 1

export {
  DEFAULT_BACKGROUND,
  LOOK_KEYS,
  DEFAULT_MENU,
  DEFAULT_TOOLBAR,
  DEFAULT_PERMISSIONS,
  DEFAULT_PLACE,
  DEFAULT_SETTINGS,
  DEFAULT_START_PAGE
} from '../shared/defaults'

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

/** The reading sheet's look, with everything clamped to what is readable. */
function sanitizeReader(v: unknown, d: Settings['reader']): Settings['reader'] {
  const input = (v ?? {}) as Partial<Settings['reader']>
  return {
    theme: oneOf(input.theme, ['system', 'light', 'sepia', 'dark'] as const, d.theme),
    size: clamp(input.size, 14, 30, d.size),
    serif: bool(input.serif, d.serif),
    width: clamp(input.width, 28, 72, d.width),
    // A tenth of a line either way is what people actually adjust.
    spacing: Math.round(clamp(input.spacing, 1.2, 2.2, d.spacing) * 20) / 20,
    textOnly: bool(input.textOnly, d.textOnly)
  }
}

/**
 * Engines somebody added by hand.
 *
 * A template without %s cannot search for anything, and one that is not https
 * would send the query in the clear — both are simply not kept. The word is
 * squeezed into something that can be typed before a space.
 */
function sanitizeEngines(v: unknown): CustomEngine[] {
  if (!Array.isArray(v)) return []
  const out: CustomEngine[] = []
  const taken = new Set<string>()
  for (const row of v.slice(0, 20)) {
    const one = (row ?? {}) as Partial<CustomEngine>
    const key = String(one.key ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9а-яё_-]/gi, '')
      .slice(0, 12)
    const template = String(one.template ?? '').slice(0, 500)
    if (!key || taken.has(key)) continue
    if (!/^https:\/\/\S+%s/i.test(template)) continue
    taken.add(key)
    out.push({ key, name: String(one.name ?? key).slice(0, 60), template })
  }
  return out
}

/** A file name inside the profile's own wallpapers folder, and nothing else. */
const WALLPAPER_NAME = /^[\w. -]{1,120}$/

/** Wallpapers taking turns: the list is names, the clock is minutes. */
function sanitizeRotation(v: unknown, d: BackgroundSettings['rotate']): BackgroundSettings['rotate'] {
  const r = (v ?? {}) as Partial<BackgroundSettings['rotate']>
  return {
    on: bool(r.on, d.on),
    // A quarter of an hour is the shortest that is not a distraction; a week
    // is the longest that still counts as taking turns.
    everyMinutes: Math.round(clamp(r.everyMinutes, 15, 10080, d.everyMinutes)),
    files: Array.isArray(r.files)
      ? [...new Set(r.files.filter((f): f is string => typeof f === 'string' && WALLPAPER_NAME.test(f)))].slice(0, 60)
      : d.files,
    shuffle: bool(r.shuffle, d.shuffle)
  }
}

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
    pauseWhenBrowsing: bool(b.pauseWhenBrowsing, d.pauseWhenBrowsing),
    rotate: sanitizeRotation(b.rotate, d.rotate)
  }
}

/** "HH:MM" on a 24-hour clock, or the hour it was. */
const timeOfDay = (v: unknown, fallback: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : fallback

/** Light by day and dark by night, with two hours that are really hours. */
function sanitizeSchedule(v: unknown, d: Settings['themeSchedule']): Settings['themeSchedule'] {
  const t = (v ?? {}) as Partial<Settings['themeSchedule']>
  return { on: bool(t.on, d.on), light: timeOfDay(t.light, d.light), dark: timeOfDay(t.dark, d.dark) }
}

/**
 * Saved looks.
 *
 * Each one carries only appearance settings — running one must never be able
 * to turn the ad blocker off or point the browser at somebody's search engine,
 * so anything outside this list is dropped on the way in.
 */

/** Jars of cookies with names on them, as far as they can be trusted. */
function sanitizeContainers(v: unknown): Container[] {
  if (!Array.isArray(v)) return []
  const out: Container[] = []
  const taken = new Set<string>()
  for (const row of v.slice(0, 20)) {
    const one = (row ?? {}) as Partial<Container>
    // The id becomes part of a session partition name, so it is letters and
    // digits or it is nothing.
    const id = String(one.id ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 32)
    if (!id || taken.has(id)) continue
    taken.add(id)
    out.push({
      id,
      name: String(one.name ?? id).slice(0, 40),
      colour: /^#[0-9a-f]{6}$/i.test(String(one.colour)) ? String(one.colour) : '#7c6cff',
      icon: [...String(one.icon ?? '')].slice(0, 2).join('')
    })
  }
  return out
}

function sanitizeLooks(v: unknown, d: LookPreset[]): LookPreset[] {
  if (!Array.isArray(v)) return d
  const out: LookPreset[] = []
  const taken = new Set<string>()
  for (const row of v.slice(0, 24)) {
    const one = (row ?? {}) as Partial<LookPreset>
    const id = String(one.id ?? '').slice(0, 40)
    if (!id || taken.has(id)) continue
    const look: Partial<Settings> = {}
    const given = (one.look ?? {}) as Record<string, unknown>
    for (const key of LOOK_KEYS) {
      if (key in given) (look as Record<string, unknown>)[key] = given[key]
    }
    taken.add(id)
    out.push({ id, name: String(one.name ?? '').slice(0, 60), look })
  }
  return out
}

/** A fortnight of counts: real dates, real numbers, and nothing else. */
function sanitizeDays(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [day, count] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(count)
    if (!/^d{4}-d{2}-d{2}$/.test(day) || !Number.isFinite(n) || n < 0) continue
    out[day] = Math.min(10_000_000, Math.round(n))
  }
  // Fourteen days; anything older is not drawn and not kept.
  return Object.fromEntries(Object.entries(out).sort().slice(-14))
}

/**
 * The toolbar and the menu: a list of ids the interface knows how to draw.
 *
 * Anything unknown is dropped rather than kept and ignored — a button that
 * cannot be drawn would be an invisible gap nobody could get rid of. An empty
 * result falls back to the way it comes, because a toolbar with nothing on it
 * is not a choice anybody made on purpose.
 */
const idList = (v: unknown, allowed: readonly string[], fallback: string[]) => {
  if (!Array.isArray(v)) return [...fallback]
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of v.slice(0, 40)) {
    const id = String(item ?? '')
    if (!allowed.includes(id)) continue
    // Spacers may repeat; nothing else may.
    if (id !== 'space' && seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.length > 0 ? out : [...fallback]
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

function sanitizeBox(v: unknown, fallback: WidgetBox): WidgetBox {
  const b = (v ?? {}) as Partial<WidgetBox>
  const w = clamp(b.w, 2, GRID_COLUMNS, fallback.w)
  const box: WidgetBox = {
    w,
    h: clamp(b.h, 1, 40, fallback.h),
    // Clamped against its own width, so a widget can never start off the grid.
    x: clamp(b.x, 0, GRID_COLUMNS - w, Math.min(fallback.x, GRID_COLUMNS - w)),
    y: clamp(b.y, 0, 80, fallback.y),
    scale: clamp(b.scale, 0.6, 2.2, fallback.scale)
  }
  if (/^#[0-9a-f]{6}$/i.test(String(b.ink))) box.ink = String(b.ink)
  return box
}

function sanitizeLayout(v: unknown): Record<WidgetId, WidgetBox> {
  const raw = (v ?? {}) as Partial<Record<WidgetId, WidgetBox>>
  const out = {} as Record<WidgetId, WidgetBox>
  for (const key of Object.keys(DEFAULT_LAYOUT) as WidgetId[]) {
    out[key] = sanitizeBox(raw[key], DEFAULT_LAYOUT[key])
  }
  return out
}

function sanitizePlace(v: unknown): WeatherSettings {
  const p = (v ?? {}) as Partial<WeatherSettings>
  const lat = Number(p.lat)
  const lon = Number(p.lon)
  // A coordinate that cannot exist is not clamped to the nearest pole — it is
  // thrown away along with the name, because the widget would otherwise report
  // the weather somewhere the user never chose.
  const real = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  return {
    place: real ? str(p.place, 80, '') : '',
    lat: real ? lat : 0,
    lon: real ? lon : 0,
    fahrenheit: bool(p.fahrenheit, false)
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
    weather: bool(s.weather, d.weather),
    downloads: bool(s.downloads, d.downloads),
    calendar: bool(s.calendar, d.calendar),
    notes: bool(s.notes, d.notes),
    chart: bool(s.chart, d.chart),
    habits: bool(s.habits, d.habits),
    todo: bool(s.todo, d.todo),
    playing: bool(s.playing, d.playing),
    rates: bool(s.rates, d.rates),
    // Three letters, which is what a currency code is and all that is ever
    // sent to the bank.
    ratesBase: /^[A-Za-z]{3}$/.test(String(s.ratesBase)) ? String(s.ratesBase).toUpperCase() : d.ratesBase,
    ratesTo: Array.isArray(s.ratesTo)
      ? [
          ...new Set(
            s.ratesTo
              .filter((one): one is string => typeof one === 'string' && /^[A-Za-z]{3}$/.test(one))
              .map((one) => one.toUpperCase())
          )
        ].slice(0, 6)
      : [...d.ratesTo],
    columns: clamp(s.columns, 4, 12, d.columns),
    font: oneOf(s.font, ['system', 'rounded', 'serif', 'mono'] as const, d.font),
    tiles: oneOf(s.tiles, ['card', 'icon'] as const, d.tiles),
    shape: oneOf(s.shape, ['rounded', 'soft', 'circle', 'square'] as const, d.shape),
    tileLabels: bool(s.tileLabels, d.tileLabels),
    tileFill: clamp(s.tileFill, 0, 100, d.tileFill),
    // Empty means "follow the theme"; anything that is not a colour becomes that.
    ink: /^#[0-9a-f]{6}$/i.test(String(s.ink)) ? String(s.ink) : '',
    layout: sanitizeLayout(s.layout),
    place: sanitizePlace(s.place)
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

/**
 * Key bindings a person changed. Unknown command ids are dropped rather than
 * kept: they would sit in the file forever and mean nothing. An empty string
 * survives — it is how a command is left with no key at all.
 */
function sanitizeShortcuts(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, combo] of Object.entries(v as Record<string, unknown>)) {
    if (!SHORTCUT_IDS.has(id)) continue
    if (typeof combo !== 'string') continue
    if (combo !== '' && !isCombo(combo)) continue
    out[id] = combo
    if (Object.keys(out).length >= 60) break
  }
  return out
}

/** Everything read from disk or IPC passes through here before it is used. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS
  return {
    onboarded: bool(input.onboarded, d.onboarded),
    language: isKnownLanguage(String(input.language)) ? String(input.language) : '',
    theme: oneOf(input.theme, ['light', 'dark', 'system'] as const, d.theme),
    themeSchedule: sanitizeSchedule(input.themeSchedule, d.themeSchedule),
    highContrast: bool(input.highContrast, d.highContrast),
    accent: /^#[0-9a-f]{6}$/i.test(String(input.accent)) ? String(input.accent) : d.accent,
    accentFromProfile: bool(input.accentFromProfile, d.accentFromProfile),
    radius: clamp(input.radius, 0, 28, d.radius),
    compact: bool(input.compact, d.compact),
    density: Math.round(clamp(input.density, 0, 2, d.density) * 2) / 2,
    // Below four fifths the text stops being readable, above two fifths more
    // the toolbar stops fitting on a laptop.
    uiScale: Math.round(clamp(input.uiScale, 0.8, 1.4, d.uiScale) * 20) / 20,
    uiFont: /^[\w .-]{0,64}$/.test(String(input.uiFont ?? '')) ? String(input.uiFont ?? '') : d.uiFont,
    looks: sanitizeLooks(input.looks, d.looks),
    glass: clamp(input.glass, 0, 100, d.glass),
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
    middleClick: oneOf(input.middleClick, ['background', 'foreground'] as const, d.middleClick),
    newTabShows: oneOf(input.newTabShows, ['start', 'home', 'blank'] as const, d.newTabShows),
    confirmCloseMultiple: bool(input.confirmCloseMultiple, d.confirmCloseMultiple),

    startPage: sanitizeStartPage(input.startPage),
    favorites: sanitizeFavorites(input.favorites, d.favorites),
    customEngines: sanitizeEngines(input.customEngines),
    inlineAnswers: bool(input.inlineAnswers, d.inlineAnswers),
    suggestions: bool(input.suggestions, d.suggestions),
    siteSuggestions: bool(input.siteSuggestions, d.siteSuggestions),
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
    passwordsAskOnStart: bool(input.passwordsAskOnStart, d.passwordsAskOnStart),
    passwordsHello: bool(input.passwordsHello, d.passwordsHello),
    webrtcPolicy: oneOf(input.webrtcPolicy, ['default', 'public_only', 'proxy_only'] as const, d.webrtcPolicy),
    fingerprintGuard: bool(input.fingerprintGuard, d.fingerprintGuard),
    clipboardGuard: bool(input.clipboardGuard, d.clipboardGuard),
    phishingGuard: bool(input.phishingGuard, d.phishingGuard),
    cookieBanners: bool(input.cookieBanners, d.cookieBanners),
    containers: sanitizeContainers(input.containers),
    /*
     * A Chromium proxy rule string, and only that shape.
     *
     * This is handed to the session as-is, so it is checked before it gets
     * there: schemes, hosts, ports and the separators between them. Anything
     * else means no proxy rather than a guess.
     */
    proxy: /^[w.:/;=@[]-]{0,300}$/.test(String(input.proxy ?? '')) ? String(input.proxy ?? '') : d.proxy,
    reaskLocationDays: Math.round(clamp(input.reaskLocationDays, 0, 365, d.reaskLocationDays)),
    spellcheck: bool(input.spellcheck, d.spellcheck),
    spellcheckLanguages: localeList(input.spellcheckLanguages, d.spellcheckLanguages),
    drm: bool(input.drm, d.drm),

    hardwareAcceleration: bool(input.hardwareAcceleration, d.hardwareAcceleration),
    preconnect: bool(input.preconnect, d.preconnect),
    prefetchDns: bool(input.prefetchDns, d.prefetchDns),
    dnsProvider: DNS_PROVIDERS.includes(input.dnsProvider as DnsProvider)
      ? (input.dnsProvider as DnsProvider)
      : d.dnsProvider,
    // Only an https template is worth keeping: anything else would be the
    // plain resolver wearing the name of a secure one.
    dohCustom: /^https:\/\/\S+$/i.test(String(input.dohCustom ?? ''))
      ? String(input.dohCustom).slice(0, 300)
      : d.dohCustom,
    dohFallback: bool(input.dohFallback, d.dohFallback),
    smoothScrolling: bool(input.smoothScrolling, d.smoothScrolling),
    sleepBackgroundTabs: bool(input.sleepBackgroundTabs, d.sleepBackgroundTabs),
    sleepAfterMinutes: clamp(input.sleepAfterMinutes, 1, 240, d.sleepAfterMinutes),
    lazyRestore: bool(input.lazyRestore, d.lazyRestore),
    restoreSession: bool(input.restoreSession, d.restoreSession),
    cacheSizeMb: clamp(input.cacheSizeMb, 64, 4096, d.cacheSizeMb),
    defaultZoom: clamp(input.defaultZoom, -3, 4, d.defaultZoom),

    doNotDisturb: bool(input.doNotDisturb, d.doNotDisturb),
    blockAutoplay: bool(input.blockAutoplay, d.blockAutoplay),
    cardHello: bool(input.cardHello, d.cardHello),

    shortcuts: sanitizeShortcuts(input.shortcuts),

    afterClose: oneOf(input.afterClose, ['opener', 'right', 'left', 'recent'] as const, d.afterClose),
    alwaysOnTop: bool(input.alwaysOnTop, d.alwaysOnTop),
    mouseGestures: bool(input.mouseGestures, d.mouseGestures),
    tabPreview: bool(input.tabPreview, d.tabPreview),
    pinchZoom: bool(input.pinchZoom, d.pinchZoom),
    linkHints: bool(input.linkHints, d.linkHints),
    // One letter, and not one that already means something while reading.
    linkHintsKey: /^[a-z]$/.test(String(input.linkHintsKey)) ? String(input.linkHintsKey) : d.linkHintsKey,
    feedback: bool(input.feedback, d.feedback),
    shortcutsInTips: bool(input.shortcutsInTips, d.shortcutsInTips),
    toolbar: idList(input.toolbar, TOOLBAR_IDS, d.toolbar),
    menuOrder: idList(input.menuOrder, MENU_IDS, d.menuOrder),
    settingsFull: bool(input.settingsFull, d.settingsFull),
    blockedDays: sanitizeDays(input.blockedDays),
    reader: sanitizeReader(input.reader, d.reader),

    downloadDir: str(input.downloadDir, 400, d.downloadDir),
    askWhereToSave: bool(input.askWhereToSave, d.askWhereToSave),
    downloadLimit: clamp(input.downloadLimit, 0, 1_000_000, d.downloadLimit),
    downloadAtOnce: clamp(input.downloadAtOnce, 1, 6, d.downloadAtOnce),
    downloadNameRule: str(input.downloadNameRule, 120, d.downloadNameRule),
    downloadUnzip: bool(input.downloadUnzip, d.downloadUnzip),
    downloadAsk: bool(input.downloadAsk, d.downloadAsk)
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
