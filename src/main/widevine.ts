// ---------------------------------------------------------------------------
// Widevine, for services that will not play video without DRM.
//
// Stock Electron ships no CDM at all, so this build uses the castlabs fork
// (github:castlabs/electron-releases), which adds Chromium's component updater
// and the `components` API. The CDM itself is still not bundled: it is fetched
// from Google's component server the first time it is needed.
//
// That fetch is the reason this is a setting and defaults to off. A browser that
// otherwise makes no requests of its own should not quietly start talking to
// Google on first launch; the user turns it on when they want Netflix to work.
//
// Two further things are outside the browser's control and worth knowing:
//
//   * Playback of most commercial content also needs the packaged app to carry a
//     VMP signature from castlabs' EVS service. Without it the CDM loads but
//     licence servers may refuse. See docs/widevine.md.
//   * Only L3 (software) protection is available, so services cap quality —
//     typically 480p–720p, never 4K. That is true of every Electron browser.
// ---------------------------------------------------------------------------

import { app, components } from 'electron'
import { settings } from './settings'
import { log } from './log'
import type { WidevineState } from '../shared/types'

let state: WidevineState = {
  enabled: false,
  ready: false,
  version: '',
  error: '',
  /** the fork is what makes any of this possible; a stock build cannot */
  supported: false
}

export const widevineState = () => state

/**
 * Waits for the CDM when the user has asked for DRM. Called before the first
 * window exists, so a page can never start loading protected media before the
 * component is in place.
 */
export async function initWidevine(): Promise<WidevineState> {
  const available = typeof components?.whenReady === 'function'
  state = { ...state, supported: available, enabled: settings.get().drm }

  if (!available) {
    state = { ...state, error: 'Эта сборка Electron без поддержки Widevine' }
    log('widevine: unsupported build')
    return state
  }
  if (!state.enabled) {
    log('widevine: disabled in settings, CDM not requested')
    return state
  }

  try {
    const results = await components.whenReady([components.WIDEVINE_CDM_ID])
    const cdm = results.find((item) => item.id === components.WIDEVINE_CDM_ID)
    state = { ...state, ready: true, version: cdm?.version ?? '', error: '' }
    log('widevine: ready', state.version)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state = { ...state, ready: false, error: message }
    log('widevine: failed to install the CDM —', message)
  }
  return state
}

/**
 * The CDM can only be brought in before any content loads, so switching the
 * setting on takes effect on the next launch. Reported rather than pretended.
 */
export const needsRestart = () => settings.get().drm && !state.ready && state.supported

/** Where the CDM ends up, so the user can see and delete it if they want. */
export const cdmDirectory = () => app.getPath('userData')
