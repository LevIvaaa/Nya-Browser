// ---------------------------------------------------------------------------
// Desktop integration on Linux: being a browser the system knows about.
//
// Where Windows keeps this in the registry and refuses to let an application
// make itself the default, Linux keeps it in a .desktop file and lets whoever
// asks set the default outright. So the shape of the answer is the same and the
// mechanics are not: there is no "register, then send them to Settings" dance —
// `xdg-settings set` either works or says why it did not.
//
// The .desktop file itself is installed by the package, so on an installed copy
// there is nothing to write. A copy run from a build directory has none, and
// writes one under ~/.local/share/applications so the browser can still be
// chosen — the same file, in the place a single user owns.
// ---------------------------------------------------------------------------

import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { log } from './log'
import type { DefaultBrowserState } from '../shared/types'

export const isLinux = process.platform === 'linux'

/** The name of our entry, as the desktop database knows it. */
export const DESKTOP_ID = 'nya-browser.desktop'

/** Everything a browser should be offered for. */
const MIME_TYPES = [
  'text/html',
  'text/xml',
  'application/xhtml+xml',
  'application/pdf',
  'image/svg+xml',
  'x-scheme-handler/http',
  'x-scheme-handler/https'
]

const userApps = () => join(homedir(), '.local', 'share', 'applications')

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 8000 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout))
    })
  })
}

/** Runs a command and does not care whether it was there to run. */
async function tryRun(command: string, args: string[]): Promise<boolean> {
  try {
    await run(command, args)
    return true
  } catch (error) {
    log('linux:', command, 'failed', String(error))
    return false
  }
}

const systemEntry = () => `/usr/share/applications/${DESKTOP_ID}`
const userEntry = () => join(userApps(), DESKTOP_ID)

/**
 * The entry a package would have installed, written for the user alone. Only
 * for copies run from a build directory: an installed one already has it, and
 * a user-level file shadowing the system one would go stale on upgrade.
 */
function writeUserEntry(): boolean {
  try {
    mkdirSync(userApps(), { recursive: true })
    const exec = process.execPath
    writeFileSync(
      userEntry(),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Nya Browser',
        'GenericName=Web Browser',
        'Comment=Быстрый приватный браузер',
        `Exec="${exec}" %U`,
        'Icon=nya-browser',
        'Terminal=false',
        'Categories=Network;WebBrowser;',
        'StartupWMClass=Nya Browser',
        `MimeType=${MIME_TYPES.join(';')};`,
        ''
      ].join('\n'),
      'utf8'
    )
    return true
  } catch (error) {
    log('linux: could not write the desktop entry', String(error))
    return false
  }
}

/** Whether there is an entry for the desktop to point at. */
const hasEntry = () => existsSync(systemEntry()) || existsSync(userEntry())

export const canRegister = () => isLinux

/**
 * Makes sure the system has an entry for us, and that it is indexed. Called on
 * every launch: a copy moved to another directory would otherwise leave an
 * entry pointing at where it used to be.
 */
export async function registerAsBrowser(): Promise<boolean> {
  if (!isLinux) return false
  // The package owns the system-wide entry; only a loose copy writes its own.
  if (!existsSync(systemEntry())) writeUserEntry()
  await tryRun('update-desktop-database', [userApps()])
  return hasEntry()
}

export async function unregisterAsBrowser(): Promise<void> {
  if (!isLinux) return
  // Only ever our own file; the package's entry belongs to the package.
  try {
    if (existsSync(userEntry())) writeFileSync(userEntry(), '')
  } catch {
    /* nothing to undo */
  }
  await tryRun('update-desktop-database', [userApps()])
}

export async function defaultBrowserState(): Promise<DefaultBrowserState> {
  if (!isLinux) return { isDefault: false, registered: false, canRegister: false }
  let current = ''
  try {
    current = (await run('xdg-settings', ['get', 'default-web-browser'])).trim()
  } catch {
    /* xdg-utils not installed, or no desktop session */
  }
  return {
    isDefault: current === DESKTOP_ID,
    registered: hasEntry(),
    canRegister: canRegister()
  }
}

/**
 * On Linux this really does what it says: the default is ours to set, so it is
 * set, and the file types are claimed at the same time. Windows only lets us
 * ask; here asking is doing.
 */
export async function requestDefaultBrowser(): Promise<DefaultBrowserState> {
  if (!isLinux) return defaultBrowserState()
  await registerAsBrowser()
  await tryRun('xdg-settings', ['set', 'default-web-browser', DESKTOP_ID])
  for (const type of MIME_TYPES) {
    await tryRun('xdg-mime', ['default', DESKTOP_ID, type])
  }
  return defaultBrowserState()
}

/* ------------------------------------------------------------------- apps */

/**
 * A site installed as an app, as a launcher entry. The Windows side writes a
 * .lnk and an .ico; here it is a .desktop file and a PNG, in the two folders a
 * single user owns.
 */
export function writeAppEntry(id: string, name: string, iconPath: string): string {
  const file = join(userApps(), `nya-app-${id}.desktop`)
  mkdirSync(userApps(), { recursive: true })
  const args = app.isPackaged ? `--nya-app=${id}` : `"${app.getAppPath()}" --nya-app=${id}`
  writeFileSync(
    file,
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${name.replace(/\n/g, ' ')}`,
      `Exec="${process.execPath}" ${args}`,
      `Icon=${iconPath}`,
      'Terminal=false',
      'Categories=Network;',
      `StartupWMClass=${name.replace(/\n/g, ' ')}`,
      ''
    ].join('\n'),
    'utf8'
  )
  void tryRun('update-desktop-database', [userApps()])
  return file
}

export const appEntryPath = (id: string) => join(userApps(), `nya-app-${id}.desktop`)

/** Where an installed app's icon lives, at the size launchers look for. */
export function appIconPath(id: string): string {
  const dir = join(homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps')
  mkdirSync(dir, { recursive: true })
  return join(dir, `nya-app-${id}.png`)
}
