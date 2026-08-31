// ---------------------------------------------------------------------------
// Updates from this project's own GitHub releases.
//
// Only the NSIS build can update itself: electron-updater replaces the
// installation, and a portable exe has none. The portable target is kept for
// carrying the browser around on a stick, but "Проверить обновления" will tell
// you plainly that it cannot update in place.
// ---------------------------------------------------------------------------

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from './log'
import type { UpdateState } from '../shared/types'

/** Long enough that a launch is never slowed by a network round trip. */
const FIRST_CHECK_DELAY = 25_000
const RECHECK_EVERY = 6 * 60 * 60 * 1000

let state: UpdateState = {
  stage: 'idle',
  version: app.getVersion(),
  available: null,
  percent: 0,
  error: '',
  supported: false,
  checkedAt: 0
}

type Listener = (state: UpdateState) => void
const listeners = new Set<Listener>()

const emit = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export const updateState = () => state

export function onUpdateState(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * A portable build has nothing to replace, and an unpackaged one has no
 * update-config at all; in both cases electron-updater would only throw.
 */
function canUpdate(): boolean {
  if (!app.isPackaged) return false
  // electron-builder sets this for the portable target only.
  return !process.env.PORTABLE_EXECUTABLE_DIR
}

let wired = false

export function initUpdates() {
  state = { ...state, supported: canUpdate() }
  if (!canUpdate()) {
    log('updates: not supported for this build')
    return
  }
  if (wired) return
  wired = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => undefined }

  autoUpdater.on('checking-for-update', () => emit({ stage: 'checking', error: '' }))
  autoUpdater.on('update-not-available', () =>
    emit({ stage: 'current', available: null, checkedAt: Date.now() })
  )
  autoUpdater.on('update-available', (info) =>
    emit({ stage: 'downloading', available: info.version, percent: 0, checkedAt: Date.now() })
  )
  autoUpdater.on('download-progress', (progress) =>
    emit({ stage: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    log('updates: ready to install', info.version)
    emit({ stage: 'ready', available: info.version, percent: 100 })
  })
  autoUpdater.on('error', (error) => {
    log('updates: failed —', String(error))
    emit({ stage: 'error', error: String(error instanceof Error ? error.message : error) })
  })

  setTimeout(() => void check(), FIRST_CHECK_DELAY)
  setInterval(() => void check(), RECHECK_EVERY)
}

export async function check(): Promise<UpdateState> {
  if (!canUpdate()) {
    return {
      ...state,
      stage: 'unsupported',
      error: app.isPackaged
        ? 'Портативная сборка не может обновить себя — нужен установщик'
        : 'Обновления работают только в собранной версии'
    }
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    emit({ stage: 'error', error: String(error instanceof Error ? error.message : error) })
  }
  return state
}

/** Quits and lets the downloaded installer take over. */
export function installNow(): boolean {
  if (state.stage !== 'ready') return false
  log('updates: restarting to install')
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
}
