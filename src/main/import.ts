// ---------------------------------------------------------------------------
// Bringing an existing browser's data across.
//
// Bookmarks come straight out of the Chromium "Bookmarks" file, which is plain
// JSON — no database, no decryption, works for every Chromium fork.
//
// Passwords deliberately do *not*: Chrome encrypts "Login Data" with a DPAPI
// key, and since Chrome 127 that key is behind App-Bound Encryption, which is
// specifically designed to stop another process reading it. So passwords are
// imported from the CSV the browser itself exports, which is supported, stable
// and honest about what is happening.
// ---------------------------------------------------------------------------

import { app, dialog } from 'electron'
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { bookmarks } from './bookmarks'
import { history } from './history'
import { vault } from './vault'
import { log } from './log'

import type { ImportResult, ImportSource } from '../shared/types'

interface Candidate {
  name: string
  /** the "User Data" root that holds the profile folders */
  root: string
  /** some builds (Opera) keep one profile directly in the root */
  flat?: boolean
}

function candidates(): Candidate[] {
  if (process.platform === 'linux') return linuxCandidates()
  const local = process.env.LOCALAPPDATA ?? ''
  const roaming = process.env.APPDATA ?? ''
  if (!local) return []
  return [
    { name: 'Google Chrome', root: join(local, 'Google', 'Chrome', 'User Data') },
    { name: 'Microsoft Edge', root: join(local, 'Microsoft', 'Edge', 'User Data') },
    { name: 'Brave', root: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { name: 'Vivaldi', root: join(local, 'Vivaldi', 'User Data') },
    { name: 'Yandex', root: join(local, 'Yandex', 'YandexBrowser', 'User Data') },
    { name: 'Opera', root: join(roaming, 'Opera Software', 'Opera Stable'), flat: true }
  ]
}

/**
 * The same browsers on Linux, where the profile folder is the config folder and
 * there is no "User Data" level in between. Flatpak keeps its own copy of that
 * folder under ~/.var/app, so both are looked at: someone can have Chrome from
 * the .deb and Chromium from Flathub, and both are real.
 */
function linuxCandidates(): Candidate[] {
  const config = join(homedir(), '.config')
  const flatpak = join(homedir(), '.var', 'app')
  return [
    { name: 'Google Chrome', root: join(config, 'google-chrome') },
    { name: 'Chromium', root: join(config, 'chromium') },
    { name: 'Microsoft Edge', root: join(config, 'microsoft-edge') },
    { name: 'Brave', root: join(config, 'BraveSoftware', 'Brave-Browser') },
    { name: 'Vivaldi', root: join(config, 'vivaldi') },
    { name: 'Yandex', root: join(config, 'yandex-browser') },
    { name: 'Opera', root: join(config, 'opera'), flat: true },
    { name: 'Google Chrome', root: join(flatpak, 'com.google.Chrome', 'config', 'google-chrome') },
    { name: 'Chromium', root: join(flatpak, 'org.chromium.Chromium', 'config', 'chromium') },
    { name: 'Brave', root: join(flatpak, 'com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser') }
  ]
}

/* --------------------------------------------------------------- bookmarks */

interface ChromeNode {
  type?: string
  name?: string
  url?: string
  children?: ChromeNode[]
}

/** Flattens Chromium's bookmark tree; the toolbar keeps its "pinned" meaning. */
function flatten(node: ChromeNode, folder: string, pinned: boolean, out: ParsedBookmark[]) {
  if (node.type === 'url' && typeof node.url === 'string') {
    out.push({ title: node.name ?? node.url, url: node.url, folder, pinned })
    return
  }
  for (const child of node.children ?? []) {
    const nested = node.type === 'folder' && node.name ? node.name : folder
    // Only links sitting *directly* on the toolbar belong on our bookmarks bar.
    flatten(child, nested, pinned && node.type !== 'folder', out)
  }
}

interface ParsedBookmark {
  title: string
  url: string
  folder: string
  pinned: boolean
}

function parseBookmarksFile(file: string): ParsedBookmark[] {
  try {
    const roots = (JSON.parse(readFileSync(file, 'utf8')) as { roots?: Record<string, ChromeNode> }).roots
    if (!roots) return []
    const out: ParsedBookmark[] = []
    for (const [key, node] of Object.entries(roots)) {
      if (!node || typeof node !== 'object') continue
      flatten(node, '', key === 'bookmark_bar', out)
    }
    return out.filter((b) => /^https?:\/\//i.test(b.url))
  } catch (error) {
    log('import: unreadable bookmarks file', file, String(error))
    return []
  }
}

function profileDirs(candidate: Candidate): string[] {
  if (candidate.flat) return existsSync(candidate.root) ? [candidate.root] : []
  if (!existsSync(candidate.root)) return []
  try {
    return readdirSync(candidate.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || entry.name.startsWith('Profile ')))
      .map((entry) => join(candidate.root, entry.name))
  } catch {
    return []
  }
}

/** Every browser profile on this machine that has bookmarks worth importing. */
export function detectSources(): ImportSource[] {
  const sources: ImportSource[] = []
  for (const candidate of candidates()) {
    for (const dir of profileDirs(candidate)) {
      const file = join(dir, 'Bookmarks')
      const marks = existsSync(file) ? parseBookmarksFile(file).length : 0
      const visits = countHistory(dir)
      // A profile with neither is a profile nobody used.
      if (marks === 0 && visits === 0) continue
      sources.push({
        id: `${candidate.name}::${dir}`,
        browser: candidate.name,
        profile: candidate.flat ? 'Основной' : dir.split(/[\\/]/).pop() ?? '',
        bookmarks: marks,
        history: visits,
        passwords: existsSync(join(dir, 'Login Data'))
      })
    }
  }
  return sources
}


export function importBookmarks(sourceId: string): ImportResult {
  const dir = sourceId.split('::')[1]
  if (!dir) return { added: 0, skipped: 0, error: 'Источник не найден' }
  const file = join(dir, 'Bookmarks')
  if (!existsSync(file)) return { added: 0, skipped: 0, error: 'Файл закладок не найден' }

  let added = 0
  let skipped = 0
  for (const item of parseBookmarksFile(file)) {
    if (bookmarks.find(item.url)) {
      skipped++
      continue
    }
    bookmarks.add(item) ? added++ : skipped++
  }
  log('import: bookmarks', sourceId, added, 'added', skipped, 'skipped')
  return { added, skipped }
}

/* ----------------------------------------------------------------- history */

/**
 * Chromium keeps history in SQLite and holds the file open, so it is copied
 * before it is read. The copy goes next to our own data and is deleted
 * afterwards; the original is never opened for writing.
 */
function withHistoryDb<T>(dir: string, use: (db: DatabaseSync) => T, fallback: T): T {
  const file = join(dir, 'History')
  if (!existsSync(file)) return fallback
  const copy = join(app.getPath('userData'), `import-history-${Date.now()}.db`)
  let db: DatabaseSync | null = null
  try {
    copyFileSync(file, copy)
    db = new DatabaseSync(copy, { readOnly: true })
    return use(db)
  } catch (error) {
    log('import: history unreadable', dir, String(error))
    return fallback
  } finally {
    try {
      db?.close()
    } catch {
      /* already closed */
    }
    try {
      rmSync(copy, { force: true })
    } catch {
      /* the copy outlives us at worst */
    }
  }
}

/**
 * Chromium counts microseconds from 1601; everyone else counts milliseconds
 * from 1970. The conversion is done in the query rather than here on purpose:
 * a raw Chromium timestamp is about 1.3e16, which is past the largest integer
 * JavaScript can hold exactly, and node:sqlite refuses to hand one over rather
 * than quietly rounding it — `Value is too large to be represented as a
 * JavaScript number`, which is the right thing to do and took a real history
 * file to discover. Divided and shifted in SQL it comes back an ordinary date.
 */
const CHROME_EPOCH_OFFSET = 11644473600000

interface HistoryRow {
  url: string
  title: string
  visit_count: number
  /** already milliseconds since 1970 */
  last_ms: number
}

function readHistory(dir: string, limit: number): HistoryRow[] {
  return withHistoryDb(
    dir,
    (db) =>
      db
        .prepare(
          `SELECT url, title, visit_count,
                  last_visit_time / 1000 - ${CHROME_EPOCH_OFFSET} AS last_ms
           FROM urls
           WHERE hidden = 0 AND url LIKE 'http%'
           ORDER BY last_visit_time DESC LIMIT ?`
        )
        .all(limit) as unknown as HistoryRow[],
    []
  )
}

function countHistory(dir: string): number {
  return withHistoryDb(
    dir,
    (db) => {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM urls WHERE hidden = 0 AND url LIKE 'http%'")
        .get() as { n?: number } | undefined
      return Number(row?.n ?? 0)
    },
    0
  )
}

/** The most recent 20 000 pages: enough to make the address bar useful. */
const HISTORY_LIMIT = 20_000

export function importHistory(sourceId: string): ImportResult {
  const dir = sourceId.split('::')[1]
  if (!dir) return { added: 0, skipped: 0, error: 'Источник не найден' }
  let added = 0
  let skipped = 0
  for (const row of readHistory(dir, HISTORY_LIMIT)) {
    const last = Number(row.last_ms)
    const ok = history.adopt({
      url: String(row.url),
      title: String(row.title || row.url),
      visits: Math.max(1, Number(row.visit_count) || 1),
      last: last > 0 ? last : Date.now()
    })
    ok ? added++ : skipped++
  }
  log('import: history', sourceId, added, 'added', skipped, 'skipped')
  return { added, skipped }
}

/* --------------------------------------------------------------- passwords */

/** RFC-4180 enough: handles quoted fields, embedded commas, quotes and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (text[i + 1] === '"') (field += '"'), i++
      else quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') (row.push(field), (field = ''))
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
    } else field += char
  }
  row.push(field)
  if (row.some((cell) => cell !== '')) rows.push(row)
  return rows
}

/** Column names used by Chrome, Edge, Firefox, Bitwarden and 1Password exports. */
const COLUMNS = {
  url: ['url', 'login_uri', 'website', 'web site', 'hostname', 'site'],
  username: ['username', 'login_username', 'user', 'login', 'email'],
  password: ['password', 'login_password', 'pass'],
  note: ['note', 'notes', 'comment']
}

const pick = (header: string[], names: string[]) =>
  header.findIndex((cell) => names.includes(cell.trim().toLowerCase().replace(/^"|"$/g, '')))

export async function importPasswordsCsv(): Promise<ImportResult> {
  if (vault.locked) return { added: 0, skipped: 0, error: 'Хранилище паролей заблокировано' }

  const picked = await dialog.showOpenDialog({
    title: 'Выберите CSV с паролями',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { added: 0, skipped: 0 }

  let rows: string[][]
  try {
    rows = parseCsv(readFileSync(picked.filePaths[0], 'utf8'))
  } catch (error) {
    return { added: 0, skipped: 0, error: `Файл не читается: ${String(error)}` }
  }
  if (rows.length < 2) return { added: 0, skipped: 0, error: 'В файле нет записей' }

  const header = rows[0]
  const urlAt = pick(header, COLUMNS.url)
  const userAt = pick(header, COLUMNS.username)
  const passAt = pick(header, COLUMNS.password)
  const noteAt = pick(header, COLUMNS.note)
  if (urlAt === -1 || passAt === -1) {
    return { added: 0, skipped: 0, error: 'Не найдены колонки url и password' }
  }

  let added = 0
  let skipped = 0
  for (const row of rows.slice(1)) {
    const rawUrl = row[urlAt] ?? ''
    const password = row[passAt] ?? ''
    if (!rawUrl || !password) {
      skipped++
      continue
    }
    let origin: string
    try {
      origin = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).host
    } catch {
      skipped++
      continue
    }
    const saved = vault.save(origin, userAt === -1 ? '' : row[userAt] ?? '', password, noteAt === -1 ? '' : row[noteAt] ?? '')
    saved ? added++ : skipped++
  }

  log('import: passwords', added, 'added', skipped, 'skipped')
  return { added, skipped }
}
