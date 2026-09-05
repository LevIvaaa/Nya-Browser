// ---------------------------------------------------------------------------
// Windows shell integration: everything needed for "Open with Nya Browser" and
// for the app to show up in Settings → Default apps.
//
// Windows only lets the *user* pick the default browser (the UserChoice hash is
// signed by the OS), so all we can do is register properly and then send them to
// the right settings page. Everything is written under HKCU, so no elevation is
// needed and nothing leaks into other accounts.
// ---------------------------------------------------------------------------

import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { statSync } from 'fs'
import { pathToFileURL } from 'url'
import { log } from './log'
import type { DefaultBrowserState } from '../shared/types'

/** ProgIDs we own. Windows keys the association off these. */
const PROG_ID_URL = 'NyaBrowserURL'
const PROG_ID_HTML = 'NyaBrowserHTM'
/** Name under Clients\StartMenuInternet — this is what "browser" means to Windows. */
const CLIENT = 'NyaBrowser'
const CAPABILITIES = `Software\\Clients\\StartMenuInternet\\${CLIENT}\\Capabilities`

const URL_SCHEMES = ['http', 'https'] as const
const FILE_TYPES = ['.htm', '.html', '.shtml', '.xht', '.xhtml', '.pdf', '.svg'] as const

export const isWindows = process.platform === 'win32'

function reg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** `reg add` for a single value. `name` of null writes the key's default value. */
const set = (key: string, name: string | null, value: string, type = 'REG_SZ') =>
  reg(['add', `HKCU\\${key}`, ...(name === null ? ['/ve'] : ['/v', name]), '/t', type, '/d', value, '/f'])

async function read(key: string, name: string | null): Promise<string | null> {
  try {
    const out = await reg(['query', `HKCU\\${key}`, ...(name === null ? ['/ve'] : ['/v', name])])
    // "    ValueName    REG_SZ    the value" — the value may itself contain spaces.
    const match = out.match(/REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)/)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

/**
 * The executable Windows should launch. In development this is electron.exe
 * running our sources, which is useless as a system-wide browser, so the caller
 * is expected to check `canRegister` first.
 */
const exePath = () => process.execPath

export const canRegister = () => isWindows && app.isPackaged

/** Writes the full StartMenuInternet registration. Idempotent. */
export async function registerAsBrowser(): Promise<boolean> {
  if (!canRegister()) return false
  const exe = exePath()
  const icon = `${exe},0`
  // `--` stops Chromium from reading an attacker-supplied "%1" as a switch.
  const openUrl = `"${exe}" -- "%1"`

  try {
    for (const progId of [PROG_ID_URL, PROG_ID_HTML]) {
      const isUrl = progId === PROG_ID_URL
      await set(`Software\\Classes\\${progId}`, null, isUrl ? 'Nya Browser URL' : 'Nya Browser HTML Document')
      if (isUrl) await set(`Software\\Classes\\${progId}`, 'URL Protocol', '')
      await set(`Software\\Classes\\${progId}\\DefaultIcon`, null, icon)
      await set(`Software\\Classes\\${progId}\\shell\\open\\command`, null, openUrl)
    }

    const client = `Software\\Clients\\StartMenuInternet\\${CLIENT}`
    await set(client, null, 'Nya Browser')
    await set(`${client}\\DefaultIcon`, null, icon)
    await set(`${client}\\shell\\open\\command`, null, `"${exe}"`)
    await set(`${client}\\InstallInfo`, 'IconsVisible', '1', 'REG_DWORD')

    await set(`${client}\\Capabilities`, 'ApplicationName', 'Nya Browser')
    await set(`${client}\\Capabilities`, 'ApplicationIcon', icon)
    await set(
      `${client}\\Capabilities`,
      'ApplicationDescription',
      'Быстрый и приватный браузер со встроенной блокировкой рекламы и трекеров'
    )
    await set(`${client}\\Capabilities\\StartMenu`, 'StartMenuInternet', CLIENT)
    for (const scheme of URL_SCHEMES) {
      await set(`${client}\\Capabilities\\URLAssociations`, scheme, PROG_ID_URL)
    }
    for (const ext of FILE_TYPES) {
      await set(`${client}\\Capabilities\\FileAssociations`, ext, PROG_ID_HTML)
    }

    // Makes the app appear in Settings → Default apps.
    await set('Software\\RegisteredApplications', CLIENT, CAPABILITIES)

    // Belt and braces: also claim the protocols the Electron way, which is what
    // makes "open link" work before the user has picked a default.
    for (const scheme of URL_SCHEMES) app.setAsDefaultProtocolClient(scheme)

    log('registered as a browser:', exe)
    return true
  } catch (error) {
    log('browser registration failed:', String(error))
    return false
  }
}

/** Removes every key `registerAsBrowser` wrote. */
export async function unregisterAsBrowser(): Promise<void> {
  if (!isWindows) return
  const keys = [
    `Software\\Classes\\${PROG_ID_URL}`,
    `Software\\Classes\\${PROG_ID_HTML}`,
    `Software\\Clients\\StartMenuInternet\\${CLIENT}`
  ]
  for (const key of keys) {
    await reg(['delete', `HKCU\\${key}`, '/f']).catch(() => undefined)
  }
  await reg(['delete', 'HKCU\\Software\\RegisteredApplications', '/v', CLIENT, '/f']).catch(() => undefined)
  for (const scheme of URL_SCHEMES) app.removeAsDefaultProtocolClient(scheme)
}

export async function defaultBrowserState(): Promise<DefaultBrowserState> {
  if (!isWindows) return { isDefault: false, registered: false, canRegister: false }
  const [registered, progId] = await Promise.all([
    read('Software\\RegisteredApplications', CLIENT),
    read('Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId')
  ])
  return {
    isDefault: progId === PROG_ID_URL,
    registered: registered !== null,
    canRegister: canRegister()
  }
}

/**
 * Registers, then opens the page where the user makes the actual choice —
 * Windows deliberately offers no API to set it for them.
 */
export async function requestDefaultBrowser(): Promise<DefaultBrowserState> {
  await registerAsBrowser()
  if (isWindows) await shell.openExternal('ms-settings:defaultapps')
  return defaultBrowserState()
}

/**
 * What Windows handed us on launch, if anything. Three shapes reach here:
 * `app.exe https://…`, the `app.exe -- https://…` form we register for URL
 * schemes, and `app.exe C:\path\to\file.pdf` — which is what every
 * "Open with" and every double-clicked file looks like. Only the first two
 * used to be understood, so opening a file with the browser opened a blank
 * window and nothing else.
 *
 * In development argv carries the path to our own entry script, which is a
 * real file and would otherwise be opened as a page on every start.
 */
export function urlFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (arg === '--' || arg.startsWith('--')) continue
    if (/^(https?|file):\/\//i.test(arg)) return arg
    // A path, not a switch and not an address. It has to be a file that is
    // actually there: Chromium passes positional arguments of its own, and
    // a browser that opens them is a browser that opens surprises.
    try {
      if (statSync(arg).isFile()) return pathToFileURL(arg).toString()
    } catch {
      /* not a path we can open */
    }
  }
  return null
}
