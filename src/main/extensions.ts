// ---------------------------------------------------------------------------
// Chrome extensions.
//
// Electron implements a real but partial slice of the extension API, and it is
// worth being precise about which slice, because the gap is what surprises
// people:
//
//   works        content scripts, chrome.storage, chrome.runtime, chrome.i18n,
//                chrome.tabs (mostly), devtools panels, background service
//                workers
//   absent       blocking chrome.webRequest and declarativeNetRequest, so ad
//                blockers cannot block anything (ours is built in instead)
//
// Toolbar buttons and their popups are absent from Electron too, because the
// host application draws the toolbar — so this browser draws them itself, out
// of what the manifest asks for (extensionActions below, and the popup in
// browser.ts).
//
// What an extension cannot do here it simply cannot do: an interface that asks
// its background for everything it shows over a long-lived channel gets no
// answer, because Electron carries no channels between an extension's pages
// and its worker. Dark Reader is exactly that kind. So extensions are added
// from a folder or a .crx somebody chose deliberately, and not from the store
// — one click there would promise something the browser cannot keep.
//
// Extensions have to be re-loaded on every launch — Chromium keeps no registry
// of them — so the paths live in extensions.json inside the profile.
// ---------------------------------------------------------------------------

import { app, dialog, session, shell, type Session } from 'electron'
import { createHash } from 'crypto'
import { inflateRawSync } from 'zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join, relative, resolve } from 'path'
import { profiles } from './profiles'
import { log } from './log'
import type { AddExtensionResult, ExtensionAction, InstalledExtension } from '../shared/types'

interface ExtensionsFile {
  /** absolute paths of unpacked extension folders */
  paths: string[]
}

const storeFile = () => join(profiles.dir(), 'extensions.json')
const unpackedDir = () => join(profiles.dir(), 'extensions')

function readStore(): ExtensionsFile {
  try {
    const data = JSON.parse(readFileSync(storeFile(), 'utf8')) as Partial<ExtensionsFile>
    const paths = Array.isArray(data.paths) ? data.paths.filter((p) => typeof p === 'string') : []
    return { paths: [...new Set(paths)].slice(0, 40) }
  } catch {
    return { paths: [] }
  }
}

function writeStore(file: ExtensionsFile) {
  try {
    mkdirSync(dirname(storeFile()), { recursive: true })
    writeFileSync(storeFile(), JSON.stringify(file, null, 2))
  } catch (error) {
    log('extensions: cannot save the list', String(error))
  }
}

/* ------------------------------------------------------------- crx / zip */

/**
 * A .crx is a small signed header followed by an ordinary zip. The signature is
 * not checked: it only proves the file came from the Web Store, and a file the
 * user picked themselves has already been trusted by picking it.
 */
export function zipBodyOf(buffer: Buffer): Buffer {
  if (buffer.length < 16 || buffer.toString('latin1', 0, 4) !== 'Cr24') return buffer
  const version = buffer.readUInt32LE(4)
  if (version === 2) {
    const keyLength = buffer.readUInt32LE(8)
    const signatureLength = buffer.readUInt32LE(12)
    return buffer.subarray(16 + keyLength + signatureLength)
  }
  // crx3: magic, version, header length, protobuf header, then the zip
  return buffer.subarray(12 + buffer.readUInt32LE(8))
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50

/**
 * Just enough of the zip format to unpack an extension: stored and deflated
 * entries, no zip64 (no extension comes close to 4 GB).
 */
export function unzip(buffer: Buffer, target: string) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66_000; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('это не архив: не найден конец каталога zip')

  const entries = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let index = 0; index < entries; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('повреждённый каталог zip')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength

    if (!name || name.endsWith('/')) continue

    // Zip-slip: an entry may not escape the target folder, however it is spelled.
    const destination = resolve(target, name)
    if (relative(target, destination).startsWith('..')) {
      throw new Error(`архив пытается записать за пределы папки: ${name}`)
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressedSize)

    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, method === 0 ? raw : inflateRawSync(raw))
  }
}

/**
 * Unpacks a .crx or .zip into `target` and returns the folder holding the
 * manifest, or null when the archive turns out not to be an extension.
 */
export function unpackArchive(file: string, target: string): string | null {
  mkdirSync(target, { recursive: true })
  unzip(zipBodyOf(readFileSync(file)), target)
  return manifestRoot(target)
}

/** Where an extension's own manifest.json lives, allowing for a wrapper folder. */
export function manifestRoot(dir: string): string | null {
  if (existsSync(join(dir, 'manifest.json'))) return dir
  try {
    const nested = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    if (nested.length === 1) return manifestRoot(join(dir, nested[0].name))
  } catch {
    /* unreadable — treated as "no manifest" below */
  }
  return null
}

/* ------------------------------------------------------------- lifecycle */

/** The session extensions are installed into: the active profile's. */
let current: Session | null = null

export function setExtensionSession(ses: Session) {
  current = ses
}

/** Loads every remembered extension. Missing folders are dropped from the list. */
export async function loadExtensions(ses: Session = current ?? session.defaultSession) {
  current = ses
  const file = readStore()
  const alive: string[] = []

  for (const path of file.paths) {
    const root = existsSync(path) ? manifestRoot(path) : null
    if (!root) {
      log('extensions: forgetting a folder that is gone —', path)
      continue
    }
    try {
      const extension = await ses.extensions.loadExtension(root, { allowFileAccess: false })
      log('extensions: loaded', extension.name, extension.version)
      alive.push(path)
    } catch (error) {
      log('extensions: refused to load', path, String(error))
      alive.push(path) // keep it listed so the failure is visible in settings
    }
  }

  if (alive.length !== file.paths.length) writeStore({ paths: alive })
}

export function listExtensions(): InstalledExtension[] {
  const ses = current ?? session.defaultSession
  const live = new Map(ses.extensions.getAllExtensions().map((e) => [e.path, e]))
  return readStore().paths.map((path) => {
    const root = manifestRoot(path)
    const extension = root ? live.get(root) : undefined
    let name = basename(path)
    let version = ''
    let manifestVersion = 0
    if (extension) {
      name = extension.name
      version = extension.version
      manifestVersion = Number(extension.manifest?.manifest_version ?? 0)
    } else if (root) {
      try {
        const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
        name = String(manifest.name ?? name).slice(0, 80)
        version = String(manifest.version ?? '')
        manifestVersion = Number(manifest.manifest_version ?? 0)
      } catch {
        /* leave the folder name as the label */
      }
    }
    return {
      id: extension?.id ?? createHash('sha256').update(path).digest('hex').slice(0, 32),
      name,
      version,
      path,
      loaded: extension !== undefined,
      manifest: manifestVersion
    }
  })
}

/** The picture a manifest points at, read off disk as something a page can show. */
function iconData(root: string, icons: unknown): string {
  if (typeof icons === 'string') return iconData(root, { '0': icons })
  if (!icons || typeof icons !== 'object') return ''
  // The largest one that exists: these are drawn at 16 or 18 points on a
  // screen that may have two or three pixels to the point.
  const sizes = Object.entries(icons as Record<string, string>)
    .map(([size, path]) => ({ size: Number(size) || 0, path }))
    .sort((a, b) => b.size - a.size)
  for (const { path } of sizes) {
    if (typeof path !== 'string' || !path) continue
    const file = join(root, path.replace(/^\//, ''))
    if (!existsSync(file)) continue
    try {
      const kind = /\.svg$/i.test(file) ? 'image/svg+xml' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png'
      return `data:${kind};base64,${readFileSync(file).toString('base64')}`
    } catch {
      /* an icon that cannot be read is an icon we do without */
    }
  }
  return ''
}

/**
 * The buttons the loaded extensions ask for.
 *
 * Chromium puts these in its own toolbar; this browser draws its toolbar
 * itself, which is exactly why extensions looked dead here even when they were
 * running. The manifest says what the button should be, so the browser can put
 * it there.
 */
export function extensionActions(): ExtensionAction[] {
  const ses = current ?? session.defaultSession
  const out: ExtensionAction[] = []
  for (const extension of ses.extensions.getAllExtensions()) {
    const manifest = (extension.manifest ?? {}) as Record<string, unknown>
    const action = (manifest.action ?? manifest.browser_action ?? null) as Record<string, unknown> | null
    // An extension with no button of its own is still worth a button, if only
    // to reach its own page: but one that asks for nothing gets nothing.
    if (!action) continue
    const popup = typeof action.default_popup === 'string' ? action.default_popup : ''
    out.push({
      id: extension.id,
      name: extension.name,
      title: typeof action.default_title === 'string' ? action.default_title : extension.name,
      icon: iconData(extension.path, action.default_icon ?? manifest.icons),
      popup: popup ? `chrome-extension://${extension.id}/${popup.replace(/^\//, '')}` : ''
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Asks for a .crx, .zip or an unpacked folder, unpacks the archive into the
 * profile if needed, and loads it straight away.
 */
export async function addExtension(): Promise<AddExtensionResult> {
  const picked = await dialog.showOpenDialog({
    title: 'Расширение: папка, .crx или .zip',
    buttonLabel: 'Установить',
    filters: [{ name: 'Расширение Chrome', extensions: ['crx', 'zip'] }],
    properties: ['openFile', 'openDirectory']
  })
  if (picked.canceled || picked.filePaths.length === 0) return {}

  const source = picked.filePaths[0]
  let folder = source

  if (/\.(crx|zip)$/i.test(source)) {
    const name = basename(source).replace(/\.(crx|zip)$/i, '').replace(/[^\w.-]+/g, '-')
    folder = join(unpackedDir(), `${name}-${Date.now().toString(36)}`)
    try {
      unpackArchive(source, folder)
    } catch (error) {
      rmSync(folder, { recursive: true, force: true })
      return { error: `Не удалось распаковать: ${(error as Error).message}` }
    }
  }

  const root = manifestRoot(folder)
  if (!root) {
    if (folder !== source) rmSync(folder, { recursive: true, force: true })
    return { error: 'В папке нет manifest.json — это не расширение' }
  }

  const ses = current ?? session.defaultSession
  try {
    await ses.extensions.loadExtension(root, { allowFileAccess: false })
  } catch (error) {
    if (folder !== source) rmSync(folder, { recursive: true, force: true })
    return { error: `Electron отказался загрузить: ${(error as Error).message}` }
  }

  const file = readStore()
  if (!file.paths.includes(folder)) writeStore({ paths: [...file.paths, folder] })

  const added = listExtensions().find((item) => item.path === folder)
  log('extensions: installed', root)
  return added ? { added } : { error: 'Установлено, но не удалось прочитать данные' }
}

export function removeExtension(path: string): boolean {
  const file = readStore()
  if (!file.paths.includes(path)) return false

  const ses = current ?? session.defaultSession
  const root = manifestRoot(path)
  const live = root ? ses.extensions.getAllExtensions().find((e) => e.path === root) : undefined
  if (live) ses.extensions.removeExtension(live.id)

  writeStore({ paths: file.paths.filter((item) => item !== path) })

  // Only ours to delete: anything under the profile's own extensions folder.
  if (!relative(unpackedDir(), path).startsWith('..')) {
    rmSync(path, { recursive: true, force: true })
  }
  log('extensions: removed', path)
  return true
}

/** Opens the folder an extension lives in, for a look at what it contains. */
export function revealExtension(path: string) {
  if (existsSync(path)) void shell.openPath(path)
}
