import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  ContentLayout,
  AddExtensionResult,
  DefaultBrowserState,
  DownloadItem,
  AddressFields,
  AddressMeta,
  CardMeta,
  FilterStatus,
  FindState,
  Playing,
  ExtensionAction,
  SplitState,
  InstalledExtension,
  UpdateState,
  UsageSummary,
  BackupCounts,
  PasswordAudit,
  WidevineState,
  HistoryEntry,
  PermissionRequest,
  Place,
  Profile,
  ProfilesState,
  SearchEngine,
  SecurityStats,
  Settings,
  Suggestion,
  InstalledApp,
  TabSpace,
  PrintOptions,
  SiteInfo,
  SiteRules,
  GroupEdit,
  TabGroup,
  TabState,
  WebAppCandidate,
  Weather,
  WindowState
} from '../shared/types'

export interface Credential {
  id: string
  origin: string
  username: string
  created: number
  used: number
  note?: string
  /** true when a one-time code lives with this entry */
  code?: boolean
  /** the attached file, described but not carried */
  file?: { name: string; size: number }
  /** when it was thrown away; absent while it is in use */
  binned?: number
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
  /** a key is put aside for Windows Hello to open */
  hello: boolean
}

export interface AutofillOffer {
  host: string
  locked: boolean
  /** what the field was asking for */
  kind: 'login' | 'card' | 'address' | 'code' | 'new-password'
  entries: Array<{
    id: string
    username: string
    origin: string
    /** saved more than a year ago and never changed since */
    old?: boolean
    /** a one-time code lives with this entry */
    code?: boolean
  }>
  cards: CardMeta[]
  addresses: AddressMeta[]
  /**
   * The site this form posts to, when it is not the site the page is on.
   * Empty in the ordinary case; a warning when it is not.
   */
  postsTo?: string
}

/**
 * A word from the browser. Most are a sentence and nothing else; a few carry
 * the one button that sentence implies — "downloaded" and "open the folder".
 */
export type ToastMessage = string | { message: string; action?: { label: string; id: string } }

/** One thing a page links to or shows that could be kept. */
export interface PageFile {
  url: string
  name: string
  kind: string
}

export interface SavePasswordOffer {
  host: string
  username: string
  /** what the page sent, so the card can show and correct it */
  password: string
  known: boolean
}

// Defined once in shared/types and re-exported here, because the renderer has
// always reached for these through the preload — and because two copies of the
// same shape is how one of them quietly stops matching the other.
import type { ImportResult, ImportSource } from '../shared/types'
export type { ImportResult, ImportSource }

export interface BlockedEntry {
  time: number
  host: string
  page: string
  kind: 'ad' | 'tracker' | 'crypto' | 'param' | 'upgrade'
}

/** A page whose words matched a search in the history. */
export interface TextHit {
  url: string
  title: string
  at: number
  snippet: string
}

export interface ClosedTab {
  url: string
  title: string
  favicon: string | null
  /** set when this entry stands for a whole group rather than one tab */
  group?: { name: string; color: string; tabs: Array<{ url: string; title: string }> }
}

/** What one tab is costing, for the page that lists them. */
export interface TabCost {
  id: number
  title: string
  origin: string
  /** megabytes in the process this tab lives in; tabs can share one */
  memory: number
  audible: boolean
  sleeping: boolean
}

/** One step in a tab's own back-and-forward list. */
export interface HistoryStep {
  offset: number
  title: string
  url: string
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
  pinTab: (id: number, pinned?: boolean) => ipcRenderer.invoke('tab:pin', id, pinned),
  newSpace: (name?: string): Promise<number> => ipcRenderer.invoke('space:new', name),
  switchSpace: (id: number) => ipcRenderer.invoke('space:switch', id),
  editSpace: (id: number, patch: { name?: string; colour?: string; pinned?: boolean }) =>
    ipcRenderer.invoke('space:edit', id, patch),
  moveSpace: (id: number, toIndex: number) => ipcRenderer.invoke('space:move', id, toIndex),
  closeSpace: (id: number) => ipcRenderer.invoke('space:close', id),
  onSpaces: (cb: (spaces: TabSpace[]) => void) => on<TabSpace[]>('state:spaces', cb),
  groupTab: (id: number, name?: string) => ipcRenderer.invoke('tab:group-new', id, name),
  addTabToGroup: (id: number, groupId: number) => ipcRenderer.invoke('tab:group-add', id, groupId),
  removeTabFromGroup: (id: number) => ipcRenderer.invoke('tab:group-remove', id),
  renameGroup: (groupId: number, name: string) => ipcRenderer.invoke('group:rename', groupId, name),
  moveGroup: (groupId: number, toIndex: number) => ipcRenderer.invoke('group:move', groupId, toIndex),
  pinGroup: (groupId: number) => ipcRenderer.invoke('group:pin', groupId),
  dropOnGroup: (tabId: number, groupId: number) => ipcRenderer.invoke('group:drop', tabId, groupId),
  onGroupEdit: (cb: (edit: GroupEdit) => void) => on<GroupEdit>('state:group-edit', cb),
  setGroupColour: (groupId: number, colour: string) => ipcRenderer.invoke('group:colour', groupId, colour),
  toggleGroup: (groupId: number, collapsed?: boolean) => ipcRenderer.invoke('group:toggle', groupId, collapsed),
  ungroup: (groupId: number) => ipcRenderer.invoke('group:ungroup', groupId),
  closeGroup: (groupId: number) => ipcRenderer.invoke('group:close', groupId),
  groupMenu: (groupId: number) => ipcRenderer.invoke('group:menu', groupId),
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
  proceedPastCertificate: () => ipcRenderer.invoke('nav:proceed-certificate'),
  printers: (): Promise<Array<{ name: string; description: string; isDefault: boolean }>> =>
    ipcRenderer.invoke('nav:printers'),
  printTo: (name: string, options: PrintOptions): Promise<void> =>
    ipcRenderer.invoke('nav:print-to', name, options),
  printPreview: (options: PrintOptions): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('nav:print-preview', options),
  printPdf: (options: PrintOptions): Promise<boolean> =>
    ipcRenderer.invoke('nav:print-pdf', options),
  zoomTo: (percent: number) => ipcRenderer.invoke('nav:zoom-percent', percent),
  savePage: (): Promise<boolean> => ipcRenderer.invoke('nav:save-page'),
  uiAction: (action: 'find'): Promise<void> => ipcRenderer.invoke('ui:action', action),
  translatePage: (): Promise<boolean> => ipcRenderer.invoke('nav:translate'),
  toggleReader: () => ipcRenderer.invoke('nav:reader'),
  playing: (): Promise<Playing[]> => ipcRenderer.invoke('media:list'),
  splitWith: (id: number | null) => ipcRenderer.invoke('tab:split', id),
  splitState: (): Promise<SplitState | null> => ipcRenderer.invoke('tab:split-state'),
  extensionActions: (): Promise<ExtensionAction[]> => ipcRenderer.invoke('ext:actions'),
  openExtension: (id: string, x: number): Promise<boolean> =>
    ipcRenderer.invoke('ext:open', id, x),
  closeExtension: (): Promise<boolean> => ipcRenderer.invoke('ext:close'),
  setSplitRatio: (ratio: number) => ipcRenderer.invoke('tab:split-ratio', ratio),
  mediaCommand: (
    tabId: number,
    what:
      | 'toggle'
      | 'play'
      | 'pause'
      | 'mute'
      | 'seek'
      | 'skip'
      | 'volume'
      | 'rate'
      | 'next'
      | 'prev'
      | 'pip',
    to?: number
  ): Promise<boolean> => ipcRenderer.invoke('media:command', tabId, what, to),
  capture: (kind: 'view' | 'full' | 'area'): Promise<boolean> =>
    ipcRenderer.invoke('nav:capture', kind),
  /**
   * Asks the window to stop answering shortcuts while the settings page is
   * listening for one. Without it, binding Ctrl+T would open a tab.
   */
  captureShortcut: (on: boolean): Promise<void> => ipcRenderer.invoke('shortcuts:capture', on),
  /** The screenshot, on its way to the editor and back. */
  onShot: (cb: (data: string) => void) => on<string>('shot:open', cb),
  keepShot: (data: string): Promise<boolean> => ipcRenderer.invoke('shot:keep', data),
  copyShot: (data: string): Promise<boolean> => ipcRenderer.invoke('shot:copy', data),
  addToHome: (): Promise<boolean> => ipcRenderer.invoke('nav:add-to-home'),

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

  /* ---- installed apps ---- */
  appCandidate: (): Promise<WebAppCandidate | null> => ipcRenderer.invoke('apps:candidate'),
  installApp: (): Promise<InstalledApp | null> => ipcRenderer.invoke('apps:install'),
  installedApps: (): Promise<InstalledApp[]> => ipcRenderer.invoke('apps:list'),
  removeApp: (id: string): Promise<InstalledApp[]> => ipcRenderer.invoke('apps:remove', id),
  openApp: (id: string): Promise<boolean> => ipcRenderer.invoke('apps:open', id),
  onAppCandidate: (cb: (found: WebAppCandidate | null) => void) =>
    on<WebAppCandidate | null>('state:app-candidate', cb),

  /* ---- one site ---- */
  siteInfo: (): Promise<SiteInfo | null> => ipcRenderer.invoke('site:info'),
  setSite: (host: string, patch: Partial<SiteRules>, reload?: boolean) =>
    ipcRenderer.invoke('site:set', host, patch, reload),
  clearSite: (host: string) => ipcRenderer.invoke('site:clear', host),
  siteList: (): Promise<Array<{ host: string; rules: SiteRules }>> => ipcRenderer.invoke('site:list'),

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

  /* ---- weather ---- */
  searchPlaces: (query: string): Promise<Place[] | null> =>
    ipcRenderer.invoke('weather:search', query),
  guessPlace: (): Promise<Place | null> => ipcRenderer.invoke('weather:guess'),
  weather: (lat: number, lon: number): Promise<Weather | null> =>
    ipcRenderer.invoke('weather:current', lat, lon),

  /* ---- profiles ---- */
  profiles: (): Promise<ProfilesState> => ipcRenderer.invoke('profiles:list'),
  profileChoices: (): Promise<{ avatars: string[]; colors: string[] }> => ipcRenderer.invoke('profiles:choices'),
  createProfile: (name: string): Promise<Profile> => ipcRenderer.invoke('profiles:create', name),
  updateProfile: (
    id: string,
    patch: Partial<Pick<Profile, 'name' | 'avatar' | 'crop' | 'color'>>
  ): Promise<ProfilesState> =>
    ipcRenderer.invoke('profiles:update', id, patch),
  pickProfileAvatar: (id: string): Promise<ProfilesState> =>
    ipcRenderer.invoke('profiles:pick-avatar', id),
  clearProfileAvatar: (id: string, emoji: string): Promise<ProfilesState> =>
    ipcRenderer.invoke('profiles:clear-avatar', id, emoji),
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
  vaultHelloAvailable: (): Promise<boolean> => ipcRenderer.invoke('vault:hello-available'),
  vaultHelloUnlock: (): Promise<boolean> => ipcRenderer.invoke('vault:hello-unlock'),
  vaultHelloEnable: (on: boolean): Promise<boolean> => ipcRenderer.invoke('vault:hello-enable', on),
  vaultLock: () => ipcRenderer.invoke('vault:lock'),
  vaultDismissNotice: (): Promise<void> => ipcRenderer.invoke('vault:dismiss-notice'),
  /** Turns the offer into a search over the whole vault, keyboard and all. */
  offerSearch: (): Promise<void> => ipcRenderer.invoke('autofill:search'),
  closeOffer: (): Promise<void> => ipcRenderer.invoke('autofill:close'),
  /** Puts a freshly made password into every password box on the form. */
  fillNewPassword: (password: string): Promise<boolean> =>
    ipcRenderer.invoke('autofill:new-password', password),
  vaultSave: (input: { origin: string; username: string; password: string; note?: string }): Promise<boolean> =>
    ipcRenderer.invoke('vault:save', input),
  vaultReveal: (id: string): Promise<string | null> => ipcRenderer.invoke('vault:reveal', id),
  /** Vault → clipboard, without the password passing through the interface. */
  vaultCopy: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:copy', id),
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text),
  /** The clipboard, for "paste and go" in the address bar and nothing else. */
  readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  vaultRemove: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:remove', id),
  /** The bin: what was thrown away, putting one back, and emptying it. */
  vaultBinned: (): Promise<Credential[]> => ipcRenderer.invoke('vault:binned'),
  vaultRestore: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:restore', id),
  vaultEmptyBin: (): Promise<number> => ipcRenderer.invoke('vault:empty-bin'),
  /** Verdicts on the saved passwords; the passwords themselves never leave. */
  vaultAudit: (): Promise<PasswordAudit[]> => ipcRenderer.invoke('vault:audit'),
  vaultStolen: (): Promise<string[]> => ipcRenderer.invoke('vault:stolen'),
  /** One-time codes, kept beside the password they belong to. */
  vaultSetCode: (id: string, secret: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:set-code', id, secret),
  /* ---- tabs ---- */
  /** Sends this tab out into a window of its own. */
  detachTab: (id: number): Promise<void> => ipcRenderer.invoke('tab:detach', id),
  /** Moves a tab from another window into this one. */
  moveTabHere: (fromWindow: number, id: number): Promise<boolean> =>
    ipcRenderer.invoke('tab:move-window', fromWindow, id),
  windowId: (): Promise<number> => ipcRenderer.invoke('window:id'),
  markUnread: (id: number, on: boolean): Promise<void> => ipcRenderer.invoke('tab:unread', id, on),
  tabCosts: (): Promise<TabCost[]> => ipcRenderer.invoke('tab:costs'),
  /** Puts a handful of gathered tabs into one new group. */
  groupTabs: (ids: number[]): Promise<void> => ipcRenderer.invoke('tab:group-many', ids),
  /** A shortcut on the desktop that opens this page. */
  tabShortcut: (id: number): Promise<boolean> => ipcRenderer.invoke('tab:shortcut', id),
  /** This tab's own back-and-forward list, for a long press on Back. */
  tabHistory: (id: number): Promise<HistoryStep[]> => ipcRenderer.invoke('tab:history', id),
  goToOffset: (id: number, offset: number): Promise<void> =>
    ipcRenderer.invoke('tab:go', id, offset),
  /** A picture of what a tab is showing, for the preview under the cursor. */
  tabPreview: (id: number): Promise<string> => ipcRenderer.invoke('tab:preview', id),
  /** Ctrl+Tab: the tab looked at before this one. */
  recentTab: (back: boolean): Promise<void> => ipcRenderer.invoke('tab:recent', back),
  alwaysOnTop: (on: boolean): Promise<void> => ipcRenderer.invoke('window:on-top', on),

  /* ---- downloads ---- */
  pauseAllDownloads: (resume: boolean): Promise<void> =>
    ipcRenderer.invoke('downloads:pause-all', resume),
  limitDownload: (id: string, kbs: number): Promise<void> =>
    ipcRenderer.invoke('downloads:limit', id, kbs),
  startDownloadAt: (id: string, at: number): Promise<void> =>
    ipcRenderer.invoke('downloads:start-at', id, at),
  resumeDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('downloads:resume', id),
  /** Yes to a download the page started by itself. */
  allowDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:allow', id),
  /** Hands a finished file to the system's own drag, out of the window. */
  dragDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:drag', id),
  /** Asks the page for every file on it; the list arrives through onFiles. */
  harvestFiles: (): Promise<void> => ipcRenderer.invoke('page:harvest'),
  onFiles: (cb: (files: PageFile[]) => void) => on<PageFile[]>('state:files', cb),
  /** Shows what each translated paragraph said before, on hover. */
  compareTranslation: (on: boolean): Promise<void> =>
    ipcRenderer.invoke('translate:compare', on),
  /** One suggestion off the list for good. */
  forgetSuggestion: (url: string): Promise<void> => ipcRenderer.invoke('suggest:forget', url),
  /** Every search this profile made, forgotten. */
  forgetSearches: (): Promise<number> => ipcRenderer.invoke('suggest:forget-searches'),

  /* ---- media ---- */
  /** One of the player's own commands, into whichever tab is playing. */
  player: (what: 'panel' | 'replay' | 'frame-now' | 'subtitles' | 'chapters', to?: number): Promise<boolean> =>
    ipcRenderer.invoke('media:player', what, to),
  /** Stop whatever is playing in so many minutes; zero calls it off. */
  sleepTimer: (minutes: number): Promise<void> => ipcRenderer.invoke('media:sleep', minutes),
  /** One tab finishing starts the next. */
  mediaQueue: (on: boolean): Promise<void> => ipcRenderer.invoke('media:queue', on),
  /** Pages whose text contains this, for the history search. */
  searchPageText: (query: string): Promise<TextHit[]> =>
    ipcRenderer.invoke('history:search-text', query),
  /** The words read out of a picture. */
  onPictureText: (cb: (data: { text: string }) => void) =>
    on<{ text: string }>('state:picture-text', cb),
  /** A few lines through the translator, for the picture card. */
  translateLines: (lines: string[]): Promise<string[]> =>
    ipcRenderer.invoke('translate:batch', lines, 'auto'),
  downloadMany: (urls: string[]): Promise<void> => ipcRenderer.invoke('downloads:many', urls),
  /** A link dropped on the browser: fetch it. */
  downloadUrl: (url: string): Promise<void> => ipcRenderer.invoke('downloads:url', url),

  vaultSetNote: (id: string, text: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:set-note', id, text),
  /** Anything in the vault that matches a few typed letters. */
  vaultSearch: (query: string): Promise<Credential[]> => ipcRenderer.invoke('vault:search', query),
  vaultAttach: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:attach', id),
  vaultSaveAttachment: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:save-attachment', id),
  vaultDetach: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:detach', id),
  /** Puts the six digits of a one-time code into the page. */
  vaultFillCode: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:fill-code', id),
  /** Fills a credential found by searching, which may belong to another host. */
  vaultFillFound: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:fill-found', id),
  vaultCode: (id: string): Promise<{ digits: string; left: number } | null> =>
    ipcRenderer.invoke('vault:code', id),
  vaultExportCsv: (): Promise<boolean> => ipcRenderer.invoke('vault:export-csv'),
  vaultImportCsv: (): Promise<number> => ipcRenderer.invoke('vault:import-csv'),

  /* ---- cards and addresses ---- */
  vaultCards: (): Promise<CardMeta[]> => ipcRenderer.invoke('vault:cards'),
  vaultSaveCard: (input: {
    id?: string
    label: string
    number: string
    holder: string
    month: number
    year: number
  }): Promise<boolean> => ipcRenderer.invoke('vault:save-card', input),
  vaultRevealCard: (id: string): Promise<string | null> =>
    ipcRenderer.invoke('vault:reveal-card', id),
  vaultCopyCard: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:copy-card', id),
  vaultRemoveCard: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:remove-card', id),
  vaultFillCard: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:fill-card', id),
  vaultAddresses: (): Promise<AddressMeta[]> => ipcRenderer.invoke('vault:addresses'),
  vaultSaveAddress: (input: { id?: string; label: string; fields: AddressFields }): Promise<boolean> =>
    ipcRenderer.invoke('vault:save-address', input),
  vaultRevealAddress: (id: string): Promise<AddressFields | null> =>
    ipcRenderer.invoke('vault:reveal-address', id),
  vaultRemoveAddress: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:remove-address', id),
  vaultFillAddress: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:fill-address', id),
  vaultGenerate: (length?: number): Promise<string> => ipcRenderer.invoke('vault:generate', length),
  vaultSetMaster: (current: string | null, next: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:set-master', current, next),
  vaultDropMaster: (current: string): Promise<boolean> => ipcRenderer.invoke('vault:drop-master', current),
  vaultFill: (id: string): Promise<boolean> => ipcRenderer.invoke('vault:fill', id),
  vaultConfirmSave: (save: boolean, username?: string, password?: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:confirm-save', save, username, password),
  vaultCipherSample: (): Promise<{ file: string; sample: string; mode: string }> =>
    ipcRenderer.invoke('vault:cipher-sample'),

  /* ---- downloads ---- */
  /** The whole profile in one sealed file, and back again. */
  makeBackup: (password: string): Promise<BackupCounts | null> =>
    ipcRenderer.invoke('backup:make', password),
  restoreBackup: (password: string): Promise<BackupCounts | null> =>
    ipcRenderer.invoke('backup:restore', password),
  usage: (): Promise<UsageSummary> => ipcRenderer.invoke('usage:summary'),
  clearUsage: (): Promise<void> => ipcRenderer.invoke('usage:clear'),
  downloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke('downloads:list'),
  pauseDownload: (id: string) => ipcRenderer.invoke('downloads:pause', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('downloads:cancel', id),
  openDownload: (id: string) => ipcRenderer.invoke('downloads:open', id),
  revealDownload: (id: string) => ipcRenderer.invoke('downloads:reveal', id),
  removeDownload: (id: string) => ipcRenderer.invoke('downloads:remove', id),
  downloadAgain: (id: string) => ipcRenderer.invoke('downloads:again', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),

  /* ---- permissions ---- */
  answerPermission: (id: string, allow: boolean) => ipcRenderer.invoke('permission:answer', id, allow),

  /* ---- misc ---- */
  suggest: (query: string): Promise<Suggestion[]> => ipcRenderer.invoke('suggest:query', query),
  preconnect: (query: string) => ipcRenderer.invoke('suggest:preconnect', query),
  securityStats: (): Promise<SecurityStats> => ipcRenderer.invoke('privacy:stats'),
  blockedLog: (): Promise<BlockedEntry[]> => ipcRenderer.invoke('privacy:blocked-log'),
  resetStats: () => ipcRenderer.invoke('privacy:reset-stats'),
  clearBrowsingData: () => ipcRenderer.invoke('privacy:clear'),
  clearAllProfiles: () => ipcRenderer.invoke('privacy:clear-all-profiles'),
  drmState: (): Promise<WidevineState & { needsRestart: boolean }> => ipcRenderer.invoke('drm:state'),
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke('updates:state'),
  checkUpdates: (): Promise<UpdateState> => ipcRenderer.invoke('updates:check'),
  newWindow: (incognito = false): Promise<boolean> => ipcRenderer.invoke('window:new', incognito),
  favicons: (): Promise<Record<string, string>> => ipcRenderer.invoke('favicons:all'),
  /** Goes and gets one for a site that has not been visited in this profile. */
  fetchFavicon: (host: string): Promise<string | undefined> =>
    ipcRenderer.invoke('favicons:fetch', host),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('updates:install'),
  extensions: (): Promise<InstalledExtension[]> => ipcRenderer.invoke('ext:list'),
  addExtension: (): Promise<AddExtensionResult> => ipcRenderer.invoke('ext:add'),
  removeExtension: (path: string): Promise<boolean> => ipcRenderer.invoke('ext:remove', path),
  revealExtension: (path: string) => ipcRenderer.invoke('ext:reveal', path),
  filterStatus: (): Promise<FilterStatus> => ipcRenderer.invoke('filters:status'),
  refreshFilters: (): Promise<FilterStatus> => ipcRenderer.invoke('filters:refresh'),
  importSources: (): Promise<ImportSource[]> => ipcRenderer.invoke('import:sources'),
  importBookmarksFrom: (id: string): Promise<ImportResult> => ipcRenderer.invoke('import:bookmarks', id),
  importHistoryFrom: (id: string): Promise<ImportResult> => ipcRenderer.invoke('import:history', id),
  importPasswordsCsv: (): Promise<ImportResult> => ipcRenderer.invoke('import:passwords'),
  defaultBrowser: (): Promise<DefaultBrowserState> => ipcRenderer.invoke('app:default-browser'),
  makeDefaultBrowser: (): Promise<DefaultBrowserState> => ipcRenderer.invoke('app:make-default'),
  dropDefaultBrowser: (): Promise<DefaultBrowserState> => ipcRenderer.invoke('app:drop-default'),
  openDevTools: () => ipcRenderer.invoke('dev:tools'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  /* ---- subscriptions ---- */
  /** What a window that has just loaded needs before the first push. */
  snapshot: (): Promise<{ tabs: TabState[]; groups: TabGroup[]; spaces: TabSpace[] }> =>
    ipcRenderer.invoke('state:snapshot'),
  onTabs: (cb: (tabs: TabState[]) => void) => on<TabState[]>('state:tabs', cb),
  onGroups: (cb: (groups: TabGroup[]) => void) => on<TabGroup[]>('state:groups', cb),
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
  onPageSection: (cb: (page: string) => void) => on<string>('state:page-section', cb),
  onUpdate: (cb: (state: UpdateState) => void) => on<UpdateState>('state:update', cb),
  onFind: (cb: (state: FindState) => void) => on<FindState>('state:find', cb),
  onMedia: (cb: (list: Playing[]) => void) => on<Playing[]>('state:media', cb),
  onSplit: (cb: (state: SplitState | null) => void) => on<SplitState | null>('state:split', cb),
  onExtensions: (cb: (list: ExtensionAction[]) => void) =>
    on<ExtensionAction[]>('state:extensions', cb),
  onToast: (cb: (message: ToastMessage) => void) => on<ToastMessage>('toast', cb),
  /** The button on a toast was pressed. */
  toastAction: (id: string): Promise<void> => ipcRenderer.invoke('toast:action', id),
  onShortcut: (cb: (action: string) => void) => on<string>('shortcut', cb)
}

contextBridge.exposeInMainWorld('browser', api)

export type BrowserApi = typeof api
