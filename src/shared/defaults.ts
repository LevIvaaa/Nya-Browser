/**
 * What the browser is before anybody changes anything.
 *
 * These live here rather than beside the store because the settings page needs
 * them too: a row can only say "you changed this" and offer to put it back if
 * it knows what it was.
 */
import type {
  BackgroundSettings,
  Container,
  MiddleClick,
  NewTabShows,
  CustomEngine,
  PermissionSettings,
  Settings,
  StartPageSettings,
  WeatherSettings
} from './types'
import { DEFAULT_LAYOUT } from './startPage'

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'aurora',
  intensity: 'medium',
  file: '',
  fit: 'cover',
  blur: 0,
  dim: 20,
  muted: true,
  speed: 1,
  pauseWhenBrowsing: true,
  rotate: { on: false, everyMinutes: 60, files: [], shuffle: true }
}

/**
 * The toolbar as it comes.
 *
 * Every id here is a button the toolbar knows how to draw; the order is the
 * order they sit in, and anything left out simply is not there. 'space' pushes
 * what follows to the right.
 */
export const DEFAULT_TOOLBAR = [
  'back',
  'forward',
  'reload',
  'home',
  'space',
  'address',
  'space',
  'extensions',
  'media',
  'profile',
  'menu'
]

/** The rows of the main menu, in the order they are shown. */
export const DEFAULT_MENU = [
  'new-tab',
  'new-window',
  'new-private-window',
  'bookmarks',
  'history',
  'downloads',
  'passwords',
  'tasks',
  'find',
  'print',
  'merge',
  'zoom',
  'settings'
]

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

export const DEFAULT_PLACE: WeatherSettings = { place: '', lat: 0, lon: 0, fahrenheit: false }

export const DEFAULT_START_PAGE: StartPageSettings = {
  greeting: true,
  clock: true,
  favorites: true,
  recent: true,
  stats: true,
  closed: true,
  weather: false,
  // Every one of the eight later widgets is off: a start page that fills
  // itself with things nobody asked for is a start page full of things to
  // switch off first.
  downloads: false,
  calendar: false,
  notes: false,
  chart: false,
  habits: false,
  todo: false,
  playing: false,
  rates: false,
  ratesBase: 'USD',
  ratesTo: ['EUR', 'GBP'],
  columns: 8,
  font: 'system',
  tiles: 'card',
  shape: 'rounded',
  tileLabels: true,
  tileFill: 100,
  ink: '',
  layout: { ...DEFAULT_LAYOUT },
  place: { ...DEFAULT_PLACE }
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  language: '',
  theme: 'system',
  themeSchedule: { on: false, light: '07:00', dark: '20:00' },
  highContrast: false,
  accent: '#7C6CFF',
  accentFromProfile: false,
  radius: 14,
  compact: false,
  density: 1,
  uiScale: 1,
  uiFont: '',
  looks: [],
  // Enough of the wallpaper to see, enough panel to read small text on.
  glass: 55,
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
  middleClick: 'background' as MiddleClick,
  newTabShows: 'start' as NewTabShows,
  confirmCloseMultiple: true,

  startPage: { ...DEFAULT_START_PAGE },
  // Empty on purpose. A new browser filling the start page with sites nobody
  // asked for is advertising, and it buries the "Добавить" tile under eight
  // things to delete first.
  favorites: [],
  searchEngine: 'duckduckgo',
  customEngines: [] as CustomEngine[],
  inlineAnswers: true,
  suggestions: true,
  siteSuggestions: true,
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
  passwordsAskOnStart: false,
  passwordsHello: false,
  webrtcPolicy: 'public_only',
  fingerprintGuard: false,
  clipboardGuard: true,
  phishingGuard: true,
  cookieBanners: true,
  containers: [],
  proxy: '',
  // A month: long enough not to nag, short enough that a permission given for
  // one errand does not last a year.
  reaskLocationDays: 30,
  spellcheck: true,
  spellcheckLanguages: ['ru', 'en-US'],
  drm: false,

  hardwareAcceleration: true,
  preconnect: true,
  prefetchDns: true,
  dnsProvider: 'system',
  dohCustom: '',
  dohFallback: true,
  smoothScrolling: true,
  sleepBackgroundTabs: true,
  sleepAfterMinutes: 20,
  lazyRestore: true,
  restoreSession: true,
  cacheSizeMb: 512,
  defaultZoom: 0,

  doNotDisturb: false,
  blockAutoplay: false,
  cardHello: true,

  shortcuts: {},

  afterClose: 'opener' as const,
  alwaysOnTop: false,
  mouseGestures: false,
  tabPreview: true,
  pinchZoom: true,
  linkHints: false,
  linkHintsKey: 'f',
  feedback: true,
  shortcutsInTips: true,
  toolbar: [...DEFAULT_TOOLBAR],
  menuOrder: [...DEFAULT_MENU],
  settingsFull: true,
  blockedDays: {},

  reader: {
    theme: 'system' as const,
    size: 19,
    serif: false,
    width: 44,
    spacing: 1.65,
    textOnly: false
  },

  downloadDir: '',
  askWhereToSave: false,
  downloadLimit: 0,
  downloadAtOnce: 3,
  downloadNameRule: '',
  downloadUnzip: false,
  downloadAsk: true
}

/**
 * What a saved look is allowed to carry.
 *
 * Appearance and nothing else: applying one must never be able to turn the ad
 * blocker off or point the browser at somebody's search engine, so anything
 * outside this list is dropped on the way in.
 */
export const LOOK_KEYS = [
  'theme',
  'themeSchedule',
  'highContrast',
  'accent',
  'accentFromProfile',
  'radius',
  'compact',
  'density',
  'uiScale',
  'uiFont',
  'glass',
  'reduceMotion',
  'animationSpeed',
  'background',
  'tabPosition',
  'railWidth',
  'tabMaxWidth',
  'closeButton',
  'startPage',
  'toolbar',
  'menuOrder'
] as const
