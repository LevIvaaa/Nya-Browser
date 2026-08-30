import { session, shell, type Session } from 'electron'
import { URL } from 'url'
import {
  AD_DOMAINS,
  ALLOW_LIST,
  CRYPTO_DOMAINS,
  DomainMatcher,
  TRACKER_DOMAINS,
  TRACKING_PARAMS
} from './blocklist'
import { settings } from './settings'
import type { PermissionRequest, PermissionSettings, SecurityStats } from '../shared/types'

const ads = new DomainMatcher(AD_DOMAINS)
const trackers = new DomainMatcher(TRACKER_DOMAINS)
const miners = new DomainMatcher(CRYPTO_DOMAINS)
const builtinAllow = new DomainMatcher(ALLOW_LIST)

export const BLOCKLIST_SIZE = ads.size + trackers.size + miners.size

export const stats: SecurityStats = {
  ads: 0,
  trackers: 0,
  crypto: 0,
  upgrades: 0,
  params: 0,
  cookies: 0,
  since: Date.now()
}

/** Per-tab block counters, keyed by webContents id. */
export const perTabBlocked = new Map<number, number>()

/** Hosts that proved they have no HTTPS endpoint; only used after a failure. */
const httpsFallback = new Set<string>()

const PRIVATE_HOST =
  /^(localhost|127(\.\d+){3}|0\.0\.0\.0|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|\[?::1\]?|[\w-]+\.(local|lan|internal|home|test))$/i

const MULTI_PART_TLD = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp',
  'com.br', 'com.cn', 'com.tr', 'co.in', 'co.kr', 'com.mx', 'com.ar', 'co.za', 'com.ua',
  'com.pl', 'com.sg', 'com.hk', 'com.tw', 'co.il', 'com.sa', 'com.eg'
])

/** Registrable domain — enough to tell first-party from third-party. */
export function baseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.')
  if (parts.length <= 2) return parts.join('.')
  const lastTwo = parts.slice(-2).join('.')
  return MULTI_PART_TLD.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo
}

const sameSite = (a: string, b: string) => baseDomain(a) === baseDomain(b)

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Strips tracking query parameters; returns null when nothing changed. */
export function cleanUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!url.search) return null
    let touched = false
    for (const key of TRACKING_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        touched = true
      }
    }
    return touched ? url.toString() : null
  } catch {
    return null
  }
}

export type BlockKind = 'ad' | 'tracker' | 'crypto' | 'custom'

/** User lists are rebuilt whenever settings change — they are small. */
let customBlock = new DomainMatcher()
let customAllow = new DomainMatcher()

export function refreshCustomLists() {
  const s = settings.get()
  customBlock = new DomainMatcher(s.customBlocked)
  customAllow = new DomainMatcher(s.customAllowed)
}

/**
 * Spell checking is opt-out but not free: Chromium fetches the `.bdic`
 * dictionary from Google the first time a language is used, which is the only
 * request the browser makes on its own behalf. Hence a setting rather than a
 * hard default.
 */
export function applySpellChecker(ses: Session) {
  const s = settings.get()
  ses.setSpellCheckerEnabled(s.spellcheck)
  if (!s.spellcheck) return
  const available = new Set(ses.availableSpellCheckerLanguages)
  const wanted = s.spellcheckLanguages.filter((code) => available.has(code))
  if (wanted.length > 0) ses.setSpellCheckerLanguages(wanted)
}

function classify(hostname: string, pathname: string): BlockKind | null {
  const s = settings.get()
  if (customAllow.matches(hostname)) return null
  if (customBlock.matches(hostname)) return 'custom'
  if (builtinAllow.matches(hostname, pathname)) return null
  if (s.blockAds && ads.matches(hostname, pathname)) return 'ad'
  if (s.blockTrackers && trackers.matches(hostname, pathname)) return 'tracker'
  if (s.blockCrypto && miners.matches(hostname, pathname)) return 'crypto'
  return null
}

/** Maps a Chromium permission string onto our own policy keys. */
const PERMISSION_MAP: Record<string, keyof PermissionSettings> = {
  media: 'camera',
  audioCapture: 'microphone',
  videoCapture: 'camera',
  geolocation: 'geolocation',
  notifications: 'notifications',
  'clipboard-read': 'clipboard',
  'clipboard-sanitized-write': 'clipboard',
  midi: 'midi',
  midiSysex: 'midi',
  usb: 'usb',
  hid: 'usb',
  serial: 'usb',
  bluetooth: 'usb',
  fullscreen: 'fullscreen',
  pointerLock: 'fullscreen',
  keyboardLock: 'fullscreen',
  'display-capture': 'camera',
  openExternal: 'download'
}

/** Permissions that are never granted, whatever the page asks. */
const NEVER = new Set(['fileSystem', 'window-management', 'storage-access', 'top-level-storage-access', 'speaker-selection'])

type PromptFn = (request: PermissionRequest) => Promise<boolean>
let askUser: PromptFn = async () => false

export function setPermissionPrompt(fn: PromptFn) {
  askUser = fn
}

let hardenedSessions = new WeakSet<Session>()

/**
 * Applies every network- and capability-level protection to a session. Safe to
 * call again when settings change: the request filters read live settings, and
 * the listeners are only installed once per session.
 */
export function hardenSession(ses: Session, onBlocked?: (webContentsId: number) => void) {
  refreshCustomLists()

  // A stock Chrome UA: keeps the fingerprint common and avoids "unsupported
  // browser" walls, without lying about the engine.
  const chromeVersion = process.versions.chrome.split('.')[0]
  ses.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${chromeVersion}.0.0.0 Safari/537.36`
  )
  applySpellChecker(ses)
  // Refuse anything below TLS 1.2 outright.
  ses.setSSLConfig({ minVersion: 'tls1.2' })

  if (hardenedSessions.has(ses)) return
  hardenedSessions.add(ses)

  // ---- request filtering -------------------------------------------------
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const s = settings.get()
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      return callback({})
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return callback({})

    const kind = classify(url.hostname, url.pathname)
    if (kind) {
      if (kind === 'ad') stats.ads++
      else if (kind === 'tracker') stats.trackers++
      else if (kind === 'crypto') stats.crypto++
      else stats.trackers++
      const id = details.webContentsId
      if (id !== undefined) {
        perTabBlocked.set(id, (perTabBlocked.get(id) ?? 0) + 1)
        onBlocked?.(id)
      }
      return callback({ cancel: true })
    }

    if (
      s.httpsOnly &&
      url.protocol === 'http:' &&
      !PRIVATE_HOST.test(url.hostname) &&
      !httpsFallback.has(url.hostname)
    ) {
      url.protocol = 'https:'
      stats.upgrades++
      return callback({ redirectURL: url.toString() })
    }

    if (s.stripTrackingParams && details.resourceType === 'mainFrame') {
      const cleaned = cleanUrl(details.url)
      if (cleaned) {
        stats.params++
        return callback({ redirectURL: cleaned })
      }
    }

    callback({})
  })

  // ---- outgoing headers --------------------------------------------------
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const s = settings.get()
    const headers = { ...details.requestHeaders }

    if (s.doNotTrack) {
      headers['DNT'] = '1'
      headers['Sec-GPC'] = '1'
    }
    delete headers['X-Client-Data'] // Chrome-only build/experiment identifier

    if (s.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
      const target = hostOf(details.url)
      const initiator = hostOf(details.referrer || '')
      if (target && initiator && !sameSite(target, initiator) && !builtinAllow.matches(target)) {
        if (headers['Cookie']) stats.cookies++
        delete headers['Cookie']
      }
    }

    callback({ requestHeaders: headers })
  })

  // ---- incoming headers --------------------------------------------------
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const s = settings.get()
    if (!s.blockThirdPartyCookies || details.resourceType === 'mainFrame') return callback({})

    const target = hostOf(details.url)
    const initiator = hostOf(details.referrer || '')
    if (!target || !initiator || sameSite(target, initiator) || builtinAllow.matches(target)) {
      return callback({})
    }
    const headers = { ...details.responseHeaders }
    let stripped = false
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'set-cookie') {
        delete headers[key]
        stripped = true
      }
    }
    if (stripped) stats.cookies++
    callback({ responseHeaders: headers })
  })

  // ---- capability permissions -------------------------------------------
  const policyFor = (permission: string): PermissionPolicyResult => {
    if (NEVER.has(permission)) return { policy: 'block', key: 'usb' }
    const key = PERMISSION_MAP[permission]
    if (!key) return { policy: 'block', key: 'usb' }
    return { policy: settings.get().permissions[key], key }
  }

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const { policy, key } = policyFor(permission)
    if (policy === 'allow') return callback(true)
    if (policy === 'block') return callback(false)

    const origin = (() => {
      try {
        return new URL(details.requestingUrl || wc?.getURL() || '').host
      } catch {
        return ''
      }
    })()
    void askUser({ id: `${Date.now()}-${permission}`, origin, permission: key }).then(callback)
  })

  // A silent check must never grant more than an explicit request would.
  ses.setPermissionCheckHandler((_wc, permission) => policyFor(permission).policy === 'allow')
  ses.setDevicePermissionHandler(() => false)
  ses.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }))
  ses.setDisplayMediaRequestHandler(() => {
    /* screen capture is never granted silently */
  })
}

interface PermissionPolicyResult {
  policy: 'ask' | 'allow' | 'block'
  key: keyof PermissionSettings
}

export function allowHttpFallback(hostname: string) {
  if (hostname) httpsFallback.add(hostname)
}
export function isHttpsFallback(hostname: string) {
  return httpsFallback.has(hostname)
}

/** Process-wide guards, independent of any session. */
export function hardenApp(app: Electron.App) {
  // An invalid certificate is always fatal: there is no click-through.
  app.on('certificate-error', (event, _wc, _url, _error, _cert, callback) => {
    event.preventDefault()
    callback(false)
  })

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      if (!/^https?:/i.test(params.src ?? '')) event.preventDefault()
    })

    // External protocol handlers are the OS's business, not a page's.
    contents.on('will-navigate', (event, url) => {
      if (/^(https?|file|about|data|blob|nya|devtools|chrome):/i.test(url)) return
      event.preventDefault()
      if (/^(mailto|tel|sms):/i.test(url)) void shell.openExternal(url)
    })

    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

/** Wipes everything a browsing session accumulated. */
export async function clearBrowsingData(ses: Session = session.defaultSession) {
  await ses.clearStorageData({
    storages: [
      'cookies',
      'filesystem',
      'indexdb',
      'localstorage',
      'shadercache',
      'serviceworkers',
      'cachestorage'
    ]
  })
  await ses.clearCache()
  await ses.clearAuthCache()
  await ses.clearHostResolverCache()
  await ses.clearCodeCaches({})
  resetStats()
}

export function resetStats() {
  stats.ads = 0
  stats.trackers = 0
  stats.crypto = 0
  stats.upgrades = 0
  stats.params = 0
  stats.cookies = 0
  stats.since = Date.now()
  perTabBlocked.clear()
}

/** Used by the built-in security self-test page. */
export function blockStatus(hostname: string) {
  return classify(hostname, '/')
}
