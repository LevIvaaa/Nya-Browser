import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DownloadItem,
  PermissionRequest,
  ProfilesState,
  SearchEngine,
  SecurityStats,
  Settings,
  TabState,
  WindowState
} from '../../../shared/types'
import type { AutofillOffer, Bookmark, ClosedTab, SavePasswordOffer } from '../../../preload/index'

const FALLBACK_ENGINE: SearchEngine = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  template: 'https://duckduckgo.com/?q=%s',
  privacy: 'high',
  hint: ''
}

export interface Toast {
  id: number
  message: string
}

/** One place for every piece of state the main process pushes to the UI. */
export function useBrowser() {
  const [tabs, setTabs] = useState<TabState[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [engines, setEngines] = useState<SearchEngine[]>([])
  const [profiles, setProfiles] = useState<ProfilesState | null>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [closed, setClosed] = useState<ClosedTab[]>([])
  const [stats, setStats] = useState<SecurityStats>({
    ads: 0, trackers: 0, crypto: 0, upgrades: 0, params: 0, cookies: 0, since: Date.now()
  })
  const [win, setWin] = useState<WindowState>({
    maximized: false, fullscreen: false, focused: true, platform: 'win32', incognito: false
  })
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const [autofill, setAutofill] = useState<AutofillOffer | null>(null)
  const [savePassword, setSavePassword] = useState<SavePasswordOffer | null>(null)
  const [edge, setEdge] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const pushToast = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list, { id, message }].slice(-3))
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200)
  }, [])

  useEffect(() => {
    const api = window.browser
    const off = [
      api.onTabs(setTabs),
      api.onSettings(setSettings),
      api.onWindow(setWin),
      api.onProfiles(setProfiles),
      api.onBookmarks(setBookmarks),
      api.onDownloads(setDownloads),
      api.onClosedTabs(setClosed),
      api.onSecurity(setStats),
      api.onPermission(setPermission),
      api.onAutofill(setAutofill),
      api.onSavePassword(setSavePassword),
      api.onEdge(setEdge),
      api.onToast(pushToast)
    ]

    void api.getSettings().then(setSettings)
    void api.getEngines().then(setEngines)
    void api.profiles().then(setProfiles)
    void api.bookmarks().then(setBookmarks)
    void api.downloads().then(setDownloads)
    void api.closedTabs().then(setClosed)

    return () => off.forEach((fn) => fn())
  }, [pushToast])

  const active = useMemo(() => tabs.find((tab) => tab.active), [tabs])
  const engine = useMemo(
    () => engines.find((item) => item.id === settings?.searchEngine) ?? FALLBACK_ENGINE,
    [engines, settings?.searchEngine]
  )
  const profile = useMemo(
    () => profiles?.profiles.find((p) => p.id === profiles.activeId) ?? null,
    [profiles]
  )
  const activeDownloads = useMemo(
    () => downloads.filter((d) => d.state === 'progressing' || d.state === 'paused').length,
    [downloads]
  )
  const bookmarked = useMemo(
    () => Boolean(active?.url && bookmarks.some((b) => b.url === active.url)),
    [active?.url, bookmarks]
  )

  const patch = useCallback((next: Partial<Settings>) => {
    void window.browser.setSettings(next)
  }, [])

  const refreshBookmarks = useCallback(() => {
    void window.browser.bookmarks().then(setBookmarks)
  }, [])

  return {
    tabs, active, settings, engines, engine, profiles, profile, bookmarks, bookmarked,
    downloads, activeDownloads, closed, stats, win, permission, autofill, savePassword,
    edge, toasts, patch, pushToast, refreshBookmarks,
    setPermission, setAutofill, setSavePassword, setToasts
  }
}
