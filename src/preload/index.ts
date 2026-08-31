import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  ContentLayout,
  AddExtensionResult,
  DefaultBrowserState,
  DownloadItem,
  FilterStatus,
  InstalledExtension,
  UpdateState,
  WidevineState,
  HistoryEntry,
  PermissionRequest,
  Profile,
  ProfilesState,
  SearchEngine,
  SecurityStats,
  Settings,
  Suggestion,
  TabState,
  WindowState
} from '../shared/types'

export interface Credential {
  id: string
  origin: string
  username: string
  created: number
  used: number
  note?: string
}

export interface Bookmark {
  id: string
  title: string
  url: string
  folder: string
  added: number
  pinned: boolean
}

export interface VaultState {
  mode: 'os' | 'password'
  locked: boolean
  count: number
  osEncryption: boolean
}

export interface AutofillOffer {
  host: string
  locked: boolean
  entries: Array<{ id: string; username: string }>
}

export interface SavePasswordOffer {
  host: string
  username: string
  known: boolean
}

export interface ImportSource {
  id: string
  browser: string
  profile: string
  bookmarks: number
}

export interface ImportResult {
  added: number
  skipped: number
  error?: string
}

export interface ClosedTab {
  url: string
  title: string
  favicon: string | null
}

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  /* ---- tabs ---- */
  newTab: (url?: string, background?: boolean): Promise<number> => ipcRenderer.invoke('tab:new', url, background),
  closeTab: (id: number) => ipcRenderer.invoke('tab:close', id),
  closeOthers: (id: number) => ipcRenderer.invoke('tab:close-others', id),
  closeToRight: (id: number) => ipcRenderer.invoke('tab:close-right', id),
  switchTab: (id: number) => ipcRenderer.invoke('tab:switch', id),
  moveTab: (id: number, index: number) => ipcRenderer.invoke('tab:move', id, index),
  duplicateTab: (id: number) => ipcRenderer.invoke('tab:duplicate', id),
  toggleMute: (id: number) => ipcRenderer.invoke('tab:mute', id),
  sleepTab: (id: number) => ipcRenderer.invoke('tab:sleep', id),
  reloadTab: (id: number) => ipcRenderer.invoke('tab:reload', id),
  tabMenu: (id: number) => ipcRenderer.invoke('tab:menu', id),
  reopenTab: () => ipcRenderer.invoke('tab:reopen'),
  closedTabs: (): Promise<ClosedTab[]> => ipcRenderer.invoke('tab:closed-list'),
  navigate: (url: string, id?: number) => ipcRenderer.invoke('tab:navigate', url, id),

  /* ---- navigation ---- */
  back: () => ipcRenderer.invoke('nav:back'),
  forward: () => ipcRenderer.invoke('nav:forward'),
  reload: (hard?: boolean) => ipcRenderer.invoke('nav:reload', hard),
  stop: () => ipcRenderer.invoke('nav:stop'),
  home: () => ipcRenderer.invoke('nav:home'),
  zoom: (delta: number | 'reset') => ipcRenderer.invoke('nav:zoom', delta),
  continueOverHttp: () => ipcRenderer.invoke('nav:http-fallback'),
  print: () => ipcRenderer.invoke('nav:print'),

  /* ---- find ---- */
  find: (text: string, forward?: boolean) => ipcRenderer.invoke('find:query', text, forward),
  stopFind: () => ipcRenderer.invoke('find:stop'),

  /* ---- window ---- */
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  setLayout: (rect: ContentLayout) => ipcRenderer.invoke('ui:layout', rect),
  setOverlay: (mode: string | null) => ipcRenderer.invoke('ui:overlay', mode),
  openChromePage: (page: string) => ipcRenderer.invoke('ui:page', page),

  /* ---- settings ---- */
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
  resetSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:reset'),
  exportSettings: (): Promise<string> => ipcRenderer.invoke('settings:export'),
  importSettings: (json: string): Promise<boolean> => ipcRenderer.invoke('settings:import', json),
  getEngines: (): Promise<SearchEngine[]> => ipcRenderer.invoke('settings:engines'),
  pickWallpaper: (): Promise<string | null> => ipcRenderer.invoke('settings:wallpaper'),
  openDataFolder: () => ipcRenderer.invoke('settings:open-data'),
  pickDownloadDir: (): Promise<string | null> => ipcRenderer.invoke('settings:download-dir'),

  /* ---- profiles ---- */
  profiles: (): Promise<ProfilesState> => ipcRenderer.invoke('profiles:list'),
  profileChoices: (): Promise<{ avatars: string[]; colors: string[] }> => ipcRenderer.invoke('profiles:choices'),
  createProfile: (name: string): Promise<Profile> => ipcRenderer.invoke('profiles:create', name),
  updateProfile: (id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'color'>>): Promise<ProfilesState> =>
    ipcRenderer.invoke('profiles:update', id, patch),
  removeProfile: (id: string): Promise<ProfilesState> => ipcRenderer.invoke('profiles:remove', id),
  switchProfile: (id: string): Promise<ProfilesState> => ipcRenderer.invoke('profiles:switch', id),

  /* ---- bookmarks ---- */
  bookmarks: (): Promise<Bookmark[]> => ipcRenderer.invoke('bookmarks:list'),
  bookmarkFolders: (): Promise<string[]> => ipcRenderer.invoke('bookmarks:folders'),
  addBookmark: (input: { title: string; url: string; folder?: string; pinned?: boolean }): Promise<Bookmark | null> =>
    ipcRenderer.invoke('bookmarks:add', input),
  updateBookmark: (id: string, patch: Partial<Bookmark>): Promise<boolean> =>
    ipcRenderer.invoke('bookmarks:update', id, patch),
  removeBookmark: (id: string): Promise<boolean> => ipcRenderer.invoke('bookmarks:remove', id),
  toggleBookmark: () => ipcRenderer.invoke('bookmarks:toggle-current'),

  /* ---- history ---- */
  history: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:all'),
  recentHistory: (limit?: number): Promise<Suggestion[]> => ipcRenderer.invoke('history:recent', limit),
  removeHistory: (url: string) => ipcRenderer.invoke('history:remove', url),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  /* ---- passwords ---- */
  vaultState: (): Promise<VaultState> => ipcRenderer.invoke('vault:state'),
  vaultList: (): Promise<Credential[]> => ipcRenderer.invoke('vault:list'),
  vaultUnlock: (password: string): Promise<boolean> => ipcRenderer.invoke('vault:unlock', password),
  vaultLock: () => ipcRenderer.invoke('vault:lock'),
  vaultSave: (input: { origin: string; username: string; password: string; note?: string }): Promise<boolean> =>
    ipcRenderer.invoke('vault:save', input),
  vaultReveal: (id: string): Promise<string | null> => ipcRenderer.invoke('vault:reveal', id),
  vaultRemove: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:remove', id),
  vaultGenerate: (length?: number): Promise<string> => ipcRenderer.invoke('vault:generate', length),
  vaultSetMaster: (current: string | null, next: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:set-master', current, next),
  vaultDropMaster: (current: string): Promise<boolean> => ipcRenderer.invoke('vault:drop-master', current),
  vaultFill: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:fill', id),
  vaultConfirmSave: (save: boolean): Promise<boolean> => ipcRenderer.invoke('vault:confirm-save', save),
  vaultCipherSample: (): Promise<{ file: string; sample: string; mode: string }> =>
    ipcRenderer.invoke('vault:cipher-sample'),

  /* ---- downloads ---- */
  downloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke('downloads:list'),
  pauseDownload: (id: string) => ipcRenderer.invoke('downloads:pause', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('downloads:cancel', id),
  openDownload: (id: string) => ipcRenderer.invoke('downloads:open', id),
  revealDownload: (id: string) => ipcRenderer.invoke('downloads:reveal', id),
  removeDownload: (id: string) => ipcRenderer.invoke('downloads:remove', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),

  /* ---- permissions ---- */
  answerPermission: (id: string, allow: boolean) => ipcRenderer.invoke('permission:answer', id, allow),

  /* ---- misc ---- */
  suggest: (query: string): Promise<Suggestion[]> => ipcRenderer.invoke('suggest:query', query),
  preconnect: (query: string) => ipcRenderer.invoke('suggest:preconnect', query),
  securityStats: (): Promise<SecurityStats> => ipcRenderer.invoke('privacy:stats'),
  resetStats: () => ipcRenderer.invoke('privacy:reset-stats'),
  clearBrowsingData: () => ipcRenderer.invoke('privacy:clear'),
  clearAllProfiles: () => ipcRenderer.invoke('privacy:clear-all-profiles'),
  drmState: (): Promise<WidevineState & { needsRestart: boolean }> => ipcRenderer.invoke('drm:state'),
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke('updates:state'),
  checkUpdates: (): Promise<UpdateState> => ipcRenderer.invoke('updates:check'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('updates:install'),
  extensions: (): Promise<InstalledExtension[]> => ipcRenderer.invoke('ext:list'),
  addExtension: (): Promise<AddExtensionResult> => ipcRenderer.invoke('ext:add'),
  removeExtension: (path: string): Promise<boolean> => ipcRenderer.invoke('ext:remove', path),
  revealExtension: (path: string) => ipcRenderer.invoke('ext:reveal', path),
  filterStatus: (): Promise<FilterStatus> => ipcRenderer.invoke('filters:status'),
  refreshFilters: (): Promise<FilterStatus> => ipcRenderer.invoke('filters:refresh'),
  importSources: (): Promise<ImportSource[]> => ipcRenderer.invoke('import:sources'),
  importBookmarksFrom: (id: string): Promise<ImportResult> => ipcRenderer.invoke('import:bookmarks', id),
  importPasswordsCsv: (): Promise<ImportResult> => ipcRenderer.invoke('import:passwords'),
  defaultBrowser: (): Promise<DefaultBrowserState> => ipcRenderer.invoke('app:default-browser'),
  makeDefaultBrowser: (): Promise<DefaultBrowserState> => ipcRenderer.invoke('app:make-default'),
  dropDefaultBrowser: (): Promise<DefaultBrowserState> => ipcRenderer.invoke('app:drop-default'),
  openDevTools: () => ipcRenderer.invoke('dev:tools'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  /* ---- subscriptions ---- */
  onTabs: (cb: (tabs: TabState[]) => void) => on<TabState[]>('state:tabs', cb),
  onWindow: (cb: (state: WindowState) => void) => on<WindowState>('state:window', cb),
  onSettings: (cb: (settings: Settings) => void) => on<Settings>('state:settings', cb),
  onSecurity: (cb: (stats: SecurityStats) => void) => on<SecurityStats>('state:security', cb),
  onProfiles: (cb: (state: ProfilesState) => void) => on<ProfilesState>('state:profiles', cb),
  onBookmarks: (cb: (items: Bookmark[]) => void) => on<Bookmark[]>('state:bookmarks', cb),
  onDownloads: (cb: (items: DownloadItem[]) => void) => on<DownloadItem[]>('state:downloads', cb),
  onClosedTabs: (cb: (items: ClosedTab[]) => void) => on<ClosedTab[]>('state:closed', cb),
  onPermission: (cb: (request: PermissionRequest) => void) => on<PermissionRequest>('state:permission', cb),
  onAutofill: (cb: (offer: AutofillOffer) => void) => on<AutofillOffer>('state:autofill', cb),
  onSavePassword: (cb: (offer: SavePasswordOffer) => void) => on<SavePasswordOffer>('state:save-password', cb),
  onEdge: (cb: (near: boolean) => void) => on<boolean>('state:edge', cb),
  onOverlay: (cb: (mode: string | null) => void) => on<string | null>('state:overlay', cb),
  onPage: (cb: (page: string) => void) => on<string>('state:page', cb),
  onUpdate: (cb: (state: UpdateState) => void) => on<UpdateState>('state:update', cb),
  onToast: (cb: (message: string) => void) => on<string>('toast', cb),
  onShortcut: (cb: (action: string) => void) => on<string>('shortcut', cb)
}

contextBridge.exposeInMainWorld('browser', api)

export type BrowserApi = typeof api
