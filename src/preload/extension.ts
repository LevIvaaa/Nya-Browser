// ---------------------------------------------------------------------------
// The half of the extension API that Electron leaves out.
//
// An extension's popup opens with one question: what page am I looking at?
// Electron answers it with the popup itself — every webContents is a tab to
// it, and the popup is the one in front — so an extension that asks politely
// gets an answer that means nothing, and sits there loading for ever.
//
// This runs inside the popup's own page, before the extension's own scripts,
// and answers that question properly: the browser's real tabs, with the real
// page at the front, and ids that are the very ids Electron's own
// chrome.scripting and chrome.tabs.sendMessage already understand — so the
// extension can act on what it was told.
//
// What is added: chrome.tabs.query / get / getCurrent / getSelected / update /
// create / remove / reload, chrome.windows (enough of it to be asked), and
// chrome.action.setIcon and friends, which have nowhere to draw here and must
// at least not throw.
// ---------------------------------------------------------------------------

import { ipcRenderer } from 'electron'

interface PageTab {
  id: number
  index: number
  windowId: number
  active: boolean
  url: string
  title: string
  favIconUrl: string
  audible: boolean
  muted: boolean
  pinned: boolean
  incognito: boolean
  width: number
  height: number
}

type Chrome = Record<string, unknown>

const WINDOW_ID = 1

/** Chrome's shape for a tab, from ours. */
const asTab = (tab: PageTab) => ({
  id: tab.id,
  index: tab.index,
  windowId: tab.windowId,
  active: tab.active,
  highlighted: tab.active,
  selected: tab.active,
  pinned: tab.pinned,
  audible: tab.audible,
  discarded: false,
  autoDiscardable: true,
  mutedInfo: { muted: tab.muted },
  url: tab.url,
  pendingUrl: tab.url,
  title: tab.title,
  favIconUrl: tab.favIconUrl,
  status: 'complete',
  incognito: tab.incognito,
  width: tab.width,
  height: tab.height,
  groupId: -1
})

/** A url matcher of the kind extensions pass to query(). */
function matches(pattern: string, url: string) {
  if (pattern === '<all_urls>' || pattern === '*://*/*') return true
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/^\.\*:\/\//, '[a-z]+://')
  try {
    return new RegExp('^' + escaped + '$').test(url)
  } catch {
    return false
  }
}

const tabs = (): Promise<PageTab[]> =>
  ipcRenderer.invoke('ext:tabs').then((list: PageTab[]) => (Array.isArray(list) ? list : []))

/**
 * Chrome's callbacks and promises at once: every one of these may be called
 * either way round, and extensions in the wild do both.
 */
function answer<T>(work: Promise<T>, back?: (value: T) => void) {
  if (typeof back === 'function') {
    void work.then(
      (value) => back(value),
      () => back(undefined as T)
    )
    return undefined
  }
  return work
}

function install() {
  const api = (window as unknown as { chrome?: Chrome }).chrome
  if (!api) return
  const nativeTabs = (api.tabs ?? {}) as Record<string, unknown>

  const query = (filter: Record<string, unknown> = {}, back?: (list: unknown[]) => void) =>
    answer(
      tabs().then((list) => {
        let found = list
        if (filter.active === true) found = found.filter((tab) => tab.active)
        if (filter.active === false) found = found.filter((tab) => !tab.active)
        if (filter.pinned === true) found = found.filter((tab) => tab.pinned)
        if (filter.audible === true) found = found.filter((tab) => tab.audible)
        if (typeof filter.index === 'number') found = found.filter((tab) => tab.index === filter.index)
        const patterns =
          typeof filter.url === 'string' ? [filter.url] : Array.isArray(filter.url) ? filter.url : null
        if (patterns) {
          found = found.filter((tab) => patterns.some((one) => matches(String(one), tab.url)))
        }
        return found.map(asTab)
      }),
      back
    )

  const get = (id: number, back?: (tab: unknown) => void) =>
    answer(
      tabs().then((list) => {
        const found = list.find((tab) => tab.id === id)
        return found ? asTab(found) : undefined
      }),
      back
    )

  const active = () => tabs().then((list) => list.find((tab) => tab.active))

  const patched: Record<string, unknown> = {
    ...nativeTabs,
    query,
    get,
    // In a popup «the current tab» is the page behind it, not the popup: that
    // mistake is the whole reason this file exists.
    getCurrent: (back?: (tab: unknown) => void) =>
      answer(
        active().then((tab) => (tab ? asTab(tab) : undefined)),
        back
      ),
    getSelected: (_windowId?: unknown, back?: (tab: unknown) => void) =>
      answer(
        active().then((tab) => (tab ? asTab(tab) : undefined)),
        back
      ),
    create: (options: { url?: string; active?: boolean } = {}, back?: (tab: unknown) => void) =>
      answer(
        ipcRenderer
          .invoke('ext:tab-create', String(options.url ?? ''), options.active !== false)
          .then((tab: PageTab | null) => (tab ? asTab(tab) : undefined)),
        back
      ),
    update: (
      idOrOptions: number | Record<string, unknown>,
      maybeOptions?: Record<string, unknown> | ((tab: unknown) => void),
      maybeBack?: (tab: unknown) => void
    ) => {
      const id = typeof idOrOptions === 'number' ? idOrOptions : 0
      const options = (typeof idOrOptions === 'number' ? maybeOptions : idOrOptions) as
        | Record<string, unknown>
        | undefined
      const back = (typeof maybeOptions === 'function' ? maybeOptions : maybeBack) as
        | ((tab: unknown) => void)
        | undefined
      return answer(
        ipcRenderer
          .invoke('ext:tab-update', id, {
            url: typeof options?.url === 'string' ? options.url : '',
            active: options?.active === true,
            muted: typeof (options?.muted ?? null) === 'boolean' ? options?.muted : null
          })
          .then((tab: PageTab | null) => (tab ? asTab(tab) : undefined)),
        back
      )
    },
    remove: (id: number | number[], back?: () => void) =>
      answer(ipcRenderer.invoke('ext:tab-remove', ([] as number[]).concat(id)), back),
    reload: (id?: number, _options?: unknown, back?: () => void) =>
      answer(ipcRenderer.invoke('ext:tab-reload', typeof id === 'number' ? id : 0), back)
  }

  try {
    api.tabs = patched
  } catch {
    /* an API that refuses to be helped is left as it was */
  }

  // Enough of chrome.windows to answer the questions popups actually ask.
  if (!api.windows) {
    const asWindow = () => ({
      id: WINDOW_ID,
      focused: true,
      incognito: false,
      type: 'normal',
      state: 'normal',
      alwaysOnTop: false
    })
    api.windows = {
      WINDOW_ID_CURRENT: -2,
      WINDOW_ID_NONE: -1,
      getCurrent: (_o?: unknown, back?: (w: unknown) => void) => answer(Promise.resolve(asWindow()), back),
      getLastFocused: (_o?: unknown, back?: (w: unknown) => void) =>
        answer(Promise.resolve(asWindow()), back),
      getAll: (_o?: unknown, back?: (w: unknown[]) => void) => answer(Promise.resolve([asWindow()]), back),
      get: (_id?: unknown, _o?: unknown, back?: (w: unknown) => void) =>
        answer(Promise.resolve(asWindow()), back),
      update: (_id?: unknown, _o?: unknown, back?: (w: unknown) => void) =>
        answer(Promise.resolve(asWindow()), back),
      onFocusChanged: { addListener: () => undefined, removeListener: () => undefined },
      onRemoved: { addListener: () => undefined, removeListener: () => undefined },
      onCreated: { addListener: () => undefined, removeListener: () => undefined }
    }
  }

  // The button belongs to this browser's toolbar, so an extension asking to
  // repaint it is answered rather than left to throw.
  const action = (api.action ?? api.browserAction) as Record<string, unknown> | undefined
  const quiet = (back?: () => void) => answer(Promise.resolve(undefined), back)
  const shim = {
    setIcon: (_o?: unknown, back?: () => void) => quiet(back),
    setTitle: (_o?: unknown, back?: () => void) => quiet(back),
    setBadgeText: (_o?: unknown, back?: () => void) => quiet(back),
    setBadgeBackgroundColor: (_o?: unknown, back?: () => void) => quiet(back),
    setPopup: (_o?: unknown, back?: () => void) => quiet(back),
    getPopup: (_o?: unknown, back?: (v: string) => void) => answer(Promise.resolve(''), back),
    enable: (_o?: unknown, back?: () => void) => quiet(back),
    disable: (_o?: unknown, back?: () => void) => quiet(back),
    onClicked: { addListener: () => undefined, removeListener: () => undefined }
  }
  try {
    api.action = { ...shim, ...(action ?? {}) }
    api.browserAction = api.action
  } catch {
    /* left as it was */
  }
}

install()
