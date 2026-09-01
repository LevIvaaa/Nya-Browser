// ---------------------------------------------------------------------------
// Types shared by the main process, the preload bridge and the renderer.
// ---------------------------------------------------------------------------

export type TabPosition = 'top' | 'left' | 'right'
export type ThemeMode = 'light' | 'dark' | 'system'
export type ProceduralStyle = 'off' | 'aurora' | 'mesh' | 'waves'
export type BackgroundKind = ProceduralStyle | 'image' | 'video'
export type BackgroundFit = 'cover' | 'contain' | 'tile' | 'center'
export type BackgroundIntensity = 'subtle' | 'medium' | 'vivid'
export type PermissionPolicy = 'ask' | 'allow' | 'block'
export type CloseButtonMode = 'always' | 'hover' | 'active'
export type WebRtcPolicy = 'default' | 'public_only' | 'proxy_only'

export type SearchEngineId =
  | 'duckduckgo'
  | 'startpage'
  | 'brave'
  | 'mojeek'
  | 'ecosia'
  | 'google'
  | 'bing'
  | 'yandex'
  | 'custom'

export interface SearchEngine {
  id: SearchEngineId
  name: string
  template: string
  privacy: 'high' | 'medium' | 'low'
  hint: string
}

export interface Favorite {
  id: string
  title: string
  url: string
  /** optional emoji shown instead of the generated monogram */
  icon?: string
}

/** Wallpaper: a procedural animation, or the user's own image / video / GIF. */
export interface BackgroundSettings {
  kind: BackgroundKind
  intensity: BackgroundIntensity
  /** file name inside the profile's wallpapers folder */
  file: string
  fit: BackgroundFit
  blur: number
  dim: number
  /** play video wallpapers muted (they always start muted on first paint) */
  muted: boolean
  speed: number
  /** pause video/animation while a page is open, to save battery */
  pauseWhenBrowsing: boolean
}

export interface PermissionSettings {
  camera: PermissionPolicy
  microphone: PermissionPolicy
  geolocation: PermissionPolicy
  notifications: PermissionPolicy
  clipboard: PermissionPolicy
  midi: PermissionPolicy
  usb: PermissionPolicy
  fullscreen: PermissionPolicy
  download: PermissionPolicy
}

/** Everything the start page can put on its canvas. */
export type WidgetId =
  | 'clock'
  | 'greeting'
  | 'search'
  | 'favorites'
  | 'stats'
  | 'recent'
  | 'closed'
  | 'weather'

/**
 * Where a widget sits, in grid cells. The grid is the same width on every
 * screen, so a layout arranged on one window looks the same on another.
 */
export interface WidgetBox {
  x: number
  y: number
  w: number
  h: number
  /** text size multiplier, so one widget can shout and another whisper */
  scale: number
}

export type StartPageFont = 'system' | 'rounded' | 'serif' | 'mono'
/** Yandex-style cards with the caption inside, or bare icons with a label. */
export type TileStyle = 'card' | 'icon'

/** A city the geocoder found. */
export interface Place {
  name: string
  region: string
  country: string
  lat: number
  lon: number
}

/** What the start page draws: now, today, and the next few days. */
export interface Weather {
  temperature: number
  feels: number
  code: number
  wind: number
  day: boolean
  high: number
  low: number
  forecast: { day: string; code: number; high: number; low: number }[]
  fetched: number
}

export interface WeatherSettings {
  /** what the user typed; empty until they pick somewhere */
  place: string
  lat: number
  lon: number
  fahrenheit: boolean
}

export interface StartPageSettings {
  greeting: boolean
  clock: boolean
  favorites: boolean
  recent: boolean
  stats: boolean
  closed: boolean
  weather: boolean
  columns: number
  font: StartPageFont
  tiles: TileStyle
  layout: Record<WidgetId, WidgetBox>
  place: WeatherSettings
}

export interface Settings {
  // ---- appearance
  theme: ThemeMode
  accent: string
  radius: number
  compact: boolean
  /**
   * How opaque the panels are, 0-100: the top bar, the cards on the start page
   * and the ones in the settings. The wallpaper behind them is not affected —
   * that is what the wallpaper settings are for.
   */
  glass: number
  reduceMotion: boolean
  animationSpeed: number
  background: BackgroundSettings

  // ---- tabs
  tabPosition: TabPosition
  tabAutoHide: boolean
  railWidth: number
  tabMaxWidth: number
  closeButton: CloseButtonMode
  newTabAfterCurrent: boolean
  middleClickClose: boolean
  confirmCloseMultiple: boolean

  // ---- start page & search
  startPage: StartPageSettings
  favorites: Favorite[]
  searchEngine: SearchEngineId
  customSearchUrl: string
  historySuggestions: boolean
  homepage: string

  // ---- privacy & security
  blockAds: boolean
  blockTrackers: boolean
  blockCrypto: boolean
  /** EasyList-style rules on top of the built-in domain list; needs downloads */
  filterLists: boolean
  /** hide leftover ad frames and banners with injected CSS */
  cosmeticFiltering: boolean
  customBlocked: string[]
  customAllowed: string[]
  httpsOnly: boolean
  blockThirdPartyCookies: boolean
  doNotTrack: boolean
  stripTrackingParams: boolean
  permissions: PermissionSettings
  saveHistory: boolean
  clearOnExit: boolean
  webrtcPolicy: WebRtcPolicy
  /** off by default costs nothing; on, Chromium downloads dictionaries from Google */
  spellcheck: boolean
  spellcheckLanguages: string[]
  /** Widevine: lets Netflix and friends play, at the cost of fetching Google's CDM */
  drm: boolean

  // ---- performance
  hardwareAcceleration: boolean
  preconnect: boolean
  prefetchDns: boolean
  smoothScrolling: boolean
  sleepBackgroundTabs: boolean
  sleepAfterMinutes: number
  lazyRestore: boolean
  restoreSession: boolean
  cacheSizeMb: number
  defaultZoom: number

  // ---- downloads
  downloadDir: string
  askWhereToSave: boolean
}

export interface AvatarCrop {
  x: number
  y: number
  scale: number
}

export interface Profile {
  id: string
  name: string
  /** emoji, or "file:<name>" for a picture in the shared avatars folder */
  avatar: string
  /**
   * How a picture sits inside the circle: the offset is a fraction of the
   * circle, the zoom a multiplier. Cropping this way rather than by rewriting
   * the file is what lets an animated avatar stay animated.
   */
  crop?: AvatarCrop
  color: string
  created: number
  lastUsed: number
}

export interface ProfilesState {
  profiles: Profile[]
  activeId: string
}

/** The browser's own pages, the ones that live in a tab without a web view. */
export type InternalPage =
  | 'settings'
  | 'history'
  | 'downloads'
  | 'bookmarks'
  | 'passwords'

export interface TabState {
  id: number
  /** set when this tab holds one of the browser's own pages instead of a site */
  internal: InternalPage | null
  title: string
  url: string
  displayUrl: string
  origin: string
  favicon: string | null
  loading: boolean
  progress: number
  canGoBack: boolean
  canGoForward: boolean
  active: boolean
  hasContent: boolean
  secure: boolean
  upgraded: boolean
  blocked: number
  sleeping: boolean
  muted: boolean
  audible: boolean
  zoom: number
  error: TabError | null
}

export interface TabError {
  code: number
  description: string
  url: string
  /** set when the page failed only because it has no HTTPS endpoint */
  httpsFallbackAvailable?: boolean
}

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
  focused: boolean
  platform: NodeJS.Platform
  /** a private window: nothing about this session reaches the disk */
  incognito: boolean
}

export interface Suggestion {
  kind: 'search' | 'url' | 'history' | 'favorite'
  title: string
  url: string
  subtitle?: string
  visits?: number
}

export interface HistoryEntry {
  url: string
  title: string
  visits: number
  last: number
}

export interface SecurityStats {
  ads: number
  trackers: number
  crypto: number
  upgrades: number
  params: number
  cookies: number
  since: number
}

export interface DownloadItem {
  id: string
  name: string
  url: string
  path: string
  received: number
  total: number
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
  speed: number
}

export interface PermissionRequest {
  id: string
  origin: string
  permission: keyof PermissionSettings
}

export interface ContentLayout {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
  userData: string
  profileDir: string
  blocklistSize: number
  sandboxed: boolean
}

export interface SecurityCheck {
  id: string
  title: string
  detail: string
  status: 'pass' | 'warn' | 'fail'
  evidence: string
}

/** Whether protected video can play. */
export interface WidevineState {
  /** the user asked for DRM */
  enabled: boolean
  /** the CDM is installed and usable now */
  ready: boolean
  version: string
  error: string
  /** false on a build without the castlabs component updater */
  supported: boolean
}

/** Where the self-update stands. */
export interface UpdateState {
  /** 'available' means found but not fetched: downloading is the user's call */
  stage:
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'error'
    | 'unsupported'
  /** the version running now */
  version: string
  /** the version found on GitHub, when there is a newer one */
  available: string | null
  /** download progress, 0-100 */
  percent: number
  /** size of the update in bytes, known as soon as it is found */
  size: number
  error: string
  /** false for the portable build and in development, which cannot self-update */
  supported: boolean
  checkedAt: number
}

/** A Chrome extension loaded into the active profile. */
export interface InstalledExtension {
  id: string
  name: string
  version: string
  /** folder it was loaded from */
  path: string
  /** false when the folder is gone or Electron refused the manifest */
  loaded: boolean
  /** manifest_version: 2 or 3, 0 when unreadable */
  manifest: number
}

export interface AddExtensionResult {
  added?: InstalledExtension
  error?: string
}

/** State of the downloadable EasyList-style filter lists. */
export interface FilterStatus {
  enabled: boolean
  rules: number
  cosmetic: number
  /** newest list timestamp, 0 when nothing has been downloaded yet */
  updated: number
  lists: Array<{ id: string; name: string; bytes: number; updated: number }>
}

/** How Windows currently sees us as a browser. */
export interface DefaultBrowserState {
  /** Windows opens https links with us right now */
  isDefault: boolean
  /** we are listed in Settings → Default apps */
  registered: boolean
  /** false in development, where registering the electron.exe stub is pointless */
  canRegister: boolean
}
