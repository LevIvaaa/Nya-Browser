// ---------------------------------------------------------------------------
// Which system this copy is talking to.
//
// Being a browser means being known to the desktop: listed among the browsers,
// offered for a link, and settable as the default. Every system means something
// different by that — Windows keeps it in the registry and reserves the choice
// for the person at the keyboard, Linux keeps it in a .desktop file and lets
// whoever asks set it — so the two live apart, and the rest of the browser asks
// here rather than knowing which it is on.
// ---------------------------------------------------------------------------

import * as windows from './windows-integration'
import * as linux from './linux-integration'
import type { DefaultBrowserState } from '../shared/types'

const NOWHERE: DefaultBrowserState = { isDefault: false, registered: false, canRegister: false }

export const canRegister = (): boolean =>
  windows.isWindows ? windows.canRegister() : linux.isLinux ? linux.canRegister() : false

export const registerAsBrowser = (): Promise<boolean> =>
  windows.isWindows
    ? windows.registerAsBrowser()
    : linux.isLinux
      ? linux.registerAsBrowser()
      : Promise.resolve(false)

export const unregisterAsBrowser = (): Promise<void> =>
  windows.isWindows
    ? windows.unregisterAsBrowser()
    : linux.isLinux
      ? linux.unregisterAsBrowser()
      : Promise.resolve()

export const defaultBrowserState = (): Promise<DefaultBrowserState> =>
  windows.isWindows
    ? windows.defaultBrowserState()
    : linux.isLinux
      ? linux.defaultBrowserState()
      : Promise.resolve(NOWHERE)

export const requestDefaultBrowser = (): Promise<DefaultBrowserState> =>
  windows.isWindows
    ? windows.requestDefaultBrowser()
    : linux.isLinux
      ? linux.requestDefaultBrowser()
      : Promise.resolve(NOWHERE)

// The command line is the command line everywhere.
export { urlFromArgv } from './windows-integration'
