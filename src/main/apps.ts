// ---------------------------------------------------------------------------
// Installing a site as an app.
//
// Chromium's installability machinery lives in Chrome, not in the engine
// Electron ships: `beforeinstallprompt` never fires here and there is no
// install button to inherit. So the browser does the whole thing itself — read
// the web app manifest, offer to install, write a shortcut, and open what the
// shortcut points at in a window with no tab strip.
//
// Where Chrome also requires a service worker, this does not. That rule exists
// to promise the app works offline; a shortcut into a browser window makes no
// such promise either way, and refusing to install a site that plainly says it
// is an app would be a rule kept for its own sake.
// ---------------------------------------------------------------------------

import { app, nativeImage, shell, type Session } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { JsonStore, track } from './store'
import { log } from './log'
import type { InstalledApp, WebAppCandidate } from '../shared/types'

const VERSION = 1

interface AppsFile {
  apps: InstalledApp[]
}

const empty = (): AppsFile => ({ apps: [] })

const iconDir = () => join(app.getPath('userData'), 'apps')

/* ------------------------------------------------------------- the manifest */

/** Everything of a manifest this browser has any use for. */
interface Manifest {
  name?: string
  short_name?: string
  start_url?: string
  scope?: string
  display?: string
  theme_color?: string
  background_color?: string
  icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>
}

const biggestSize = (sizes?: string) =>
  (sizes ?? '')
    .split(/\s+/)
    .map((pair) => parseInt(pair.split('x')[0], 10))
    .filter((n) => Number.isFinite(n))
    .reduce((top, n) => Math.max(top, n), 0)

/**
 * The icon to give the shortcut: the largest square one that is not larger than
 * Windows can use, and never a maskable-only icon — those are drawn expecting
 * the platform to crop them, and Windows will not.
 */
function pickIcon(manifest: Manifest, base: string): string | null {
  const icons = (manifest.icons ?? [])
    .filter((icon) => typeof icon.src === 'string' && icon.src)
    .filter((icon) => !/maskable/i.test(icon.purpose ?? '') || /any/i.test(icon.purpose ?? ''))
    .map((icon) => ({ ...icon, size: biggestSize(icon.sizes) }))
    .sort((a, b) => {
      // 256 is what a shortcut shows at its largest; bigger is only a download.
      const score = (n: number) => (n > 256 ? 256 - (n - 256) / 100 : n)
      return score(b.size) - score(a.size)
    })
  if (icons.length === 0) return null
  try {
    return new URL(icons[0].src as string, base).toString()
  } catch {
    return null
  }
}

/**
 * Reads the manifest a page points at. Returns null for a page that has none,
 * or one that has one and still does not describe an app: a name and an icon is
 * the least it takes to put something on a desktop.
 */
export async function readManifest(
  ses: Session,
  pageUrl: string,
  manifestUrl: string
): Promise<WebAppCandidate | null> {
  let manifest: Manifest
  try {
    const response = await ses.fetch(manifestUrl)
    if (!response.ok) return null
    const text = await response.text()
    if (text.length > 512 * 1024) return null
    manifest = JSON.parse(text) as Manifest
  } catch {
    return null
  }

  const name = (manifest.name || manifest.short_name || '').trim().slice(0, 120)
  if (!name) return null

  let start: URL
  let scope: URL
  try {
    start = new URL(manifest.start_url || pageUrl, manifestUrl)
    scope = new URL(manifest.scope || './', start)
  } catch {
    return null
  }
  // A start page somewhere else entirely is not this site's app.
  if (start.origin !== new URL(pageUrl).origin) return null

  const icon = pickIcon(manifest, manifestUrl)
  if (!icon) return null

  return {
    id: idFor(start.toString()),
    name,
    startUrl: start.toString(),
    scope: scope.toString(),
    icon,
    themeColor: typeof manifest.theme_color === 'string' ? manifest.theme_color.slice(0, 32) : '',
    backgroundColor:
      typeof manifest.background_color === 'string' ? manifest.background_color.slice(0, 32) : ''
  }
}

/** A stable name for one app, short enough to pass on a command line. */
export const idFor = (startUrl: string) =>
  createHash('sha1').update(startUrl).digest('hex').slice(0, 12)

/* ------------------------------------------------------------------- icons */

/**
 * A Windows .ico holding PNGs at the three sizes the shell asks for.
 *
 * Since Vista an icon directory entry may point at a whole PNG rather than a
 * bitmap, which is the only reason this fits in thirty lines: the header says
 * where each image is and how big, and the images are the PNGs themselves.
 */
function writeIco(png: Buffer, file: string) {
  const image = nativeImage.createFromBuffer(png)
  if (image.isEmpty()) throw new Error('the icon is not an image')

  const sizes = [256, 48, 32]
  const images = sizes.map((size) => ({
    size,
    data: image.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }))

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // colours in palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })

  mkdirSync(iconDir(), { recursive: true })
  writeFileSync(file, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]))
}

/* ------------------------------------------------------------------- store */

class Apps {
  private store = track(
    new JsonStore<AppsFile>(
      'apps.json',
      empty,
      VERSION,
      (data) => data as Partial<AppsFile>,
      (data) => ({
        apps: (Array.isArray(data?.apps) ? data.apps : [])
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.startUrl === 'string'
          )
          .slice(0, 200)
      })
    )
  )

  load(dir: string) {
    this.store.open(dir)
  }

  list(): InstalledApp[] {
    return [...this.store.get().apps].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): InstalledApp | undefined {
    return this.store.get().apps.find((item) => item.id === id)
  }

  has(id: string) {
    return this.get(id) !== undefined
  }

  /**
   * Writes the icon, puts a shortcut on the desktop and in the Start menu, and
   * remembers the app. The shortcut launches this browser with the app's id,
   * which is what opens it in a window of its own.
   */
  async install(candidate: WebAppCandidate, ses: Session): Promise<InstalledApp | null> {
    if (process.platform !== 'win32') return null
    const file = join(iconDir(), `${candidate.id}.ico`)
    try {
      const response = await ses.fetch(candidate.icon)
      if (!response.ok) throw new Error(`icon HTTP ${response.status}`)
      writeIco(Buffer.from(await response.arrayBuffer()), file)
    } catch (error) {
      log('apps: icon failed', String(error))
      return null
    }

    const record: InstalledApp = {
      id: candidate.id,
      name: candidate.name,
      startUrl: candidate.startUrl,
      scope: candidate.scope,
      themeColor: candidate.themeColor,
      backgroundColor: candidate.backgroundColor,
      icon: file,
      installed: Date.now()
    }

    // In development the executable is Electron itself, which needs to be told
    // which app to run before it is told which web app to open.
    const args = app.isPackaged
      ? `--nya-app=${record.id}`
      : `"${app.getAppPath()}" --nya-app=${record.id}`
    const safeName = record.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'App'

    for (const dir of [app.getPath('desktop'), startMenuDir()]) {
      if (!dir) continue
      try {
        mkdirSync(dir, { recursive: true })
        shell.writeShortcutLink(join(dir, `${safeName}.lnk`), 'create', {
          target: process.execPath,
          args,
          icon: file,
          iconIndex: 0,
          description: record.name,
          appUserModelId: `com.nya.browser.app.${record.id}`
        })
      } catch (error) {
        log('apps: shortcut failed', dir, String(error))
      }
    }

    const apps = this.store.get().apps.filter((item) => item.id !== record.id)
    this.store.set({ apps: [...apps, record] })
    this.store.flush()
    return record
  }

  /** Forgets an app and takes its shortcuts and icon away with it. */
  remove(id: string) {
    const record = this.get(id)
    if (!record) return
    const safeName = record.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'App'
    for (const dir of [app.getPath('desktop'), startMenuDir()]) {
      if (!dir) continue
      try {
        rmSync(join(dir, `${safeName}.lnk`), { force: true })
      } catch {
        /* the shortcut may have been moved or deleted by hand */
      }
    }
    try {
      if (existsSync(record.icon)) rmSync(record.icon, { force: true })
    } catch {
      /* leaving an icon behind is not worth failing over */
    }
    this.store.set({ apps: this.store.get().apps.filter((item) => item.id !== id) })
    this.store.flush()
  }
}

/** Our own folder in the Start menu, so removing an app leaves no strays. */
function startMenuDir(): string {
  try {
    return join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Nya Browser')
  } catch {
    return ''
  }
}

/** The app id a shortcut launched us with, if any. */
export function appIdFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const match = /^--nya-app=([0-9a-f]{6,32})$/.exec(arg)
    if (match) return match[1]
  }
  return null
}

/** Whether a URL still belongs to the app, or has left for the open web. */
export function inScope(record: InstalledApp, url: string): boolean {
  try {
    const target = new URL(url)
    const scope = new URL(record.scope)
    if (target.origin !== scope.origin) return false
    return target.pathname.startsWith(scope.pathname)
  } catch {
    return false
  }
}

export const apps = new Apps()
