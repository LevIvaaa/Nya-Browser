import { app } from 'electron'
import { appendFileSync, statSync, renameSync } from 'fs'
import { join } from 'path'

let file = ''
const MAX_BYTES = 512 * 1024

/** Minimal on-disk log: startup problems in a packaged app are invisible otherwise. */
export function initLog() {
  file = join(app.getPath('userData'), 'nya.log')
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, file + '.old')
  } catch {
    /* no log yet */
  }
  log('--- start', app.getVersion(), process.versions.electron, process.platform)

  process.on('uncaughtException', (err) => log('uncaught:', err?.stack ?? String(err)))
  process.on('unhandledRejection', (err) => log('unhandled:', String(err)))
}

export function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] ${parts.map(String).join(' ')}\n`
  try {
    if (file) appendFileSync(file, line, 'utf8')
  } catch {
    /* never let logging break the app */
  }
  if (!app.isPackaged) console.log(...parts)
}

/** Mirrors a web contents' console and failures into the log file. */
export function attachLog(wc: Electron.WebContents, label: string) {
  wc.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      log(`${label}/console`, details.level, details.message, details.lineNumber ? `@${details.lineNumber}` : '')
    }
  })
  wc.on('did-fail-load', (_e, code, desc, url) => log(`${label}/fail`, code, desc, url))
  wc.on('preload-error', (_e, path, error) => log(`${label}/preload-error`, path, error?.message))
  wc.on('render-process-gone', (_e, details) => log(`${label}/gone`, details.reason, details.exitCode))
  wc.on('unresponsive', () => log(`${label}/unresponsive`))
}
