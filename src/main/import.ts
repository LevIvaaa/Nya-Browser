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

import { dialog } from 'electron'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { bookmarks } from './bookmarks'
import { vault } from './vault'
import { log } from './log'

export interface ImportSource {
  /** stable id: "<browser>:<profile dir>" */
  id: string
  browser: string
  profile: string
  bookmarks: number
}

interface Candidate {
  name: string
  /** the "User Data" root that holds the profile folders */
  root: string
  /** some builds (Opera) keep one profile directly in the root */
  flat?: boolean
}

function candidates(): Candidate[] {
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
      if (!existsSync(file)) continue
      const count = parseBookmarksFile(file).length
      if (count === 0) continue
      sources.push({
        id: `${candidate.name}::${dir}`,
        browser: candidate.name,
        profile: candidate.flat ? 'Основной' : dir.split(/[\\/]/).pop() ?? '',
        bookmarks: count
      })
    }
  }
  return sources
}

export interface ImportResult {
  added: number
  skipped: number
  error?: string
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
