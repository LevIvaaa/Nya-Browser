import { randomUUID } from 'crypto'
import { JsonStore, track } from './store'

const BOOKMARKS_VERSION = 1

export interface Bookmark {
  id: string
  title: string
  url: string
  folder: string
  added: number
  /** shown on the bookmarks bar */
  pinned: boolean
}

interface BookmarksFile {
  items: Bookmark[]
  folders: string[]
}

const sanitizeItem = (raw: Partial<Bookmark>): Bookmark | null => {
  if (!raw || typeof raw.url !== 'string' || !/^https?:\/\//i.test(raw.url)) return null
  return {
    id: typeof raw.id === 'string' && raw.id.length >= 8 ? raw.id : randomUUID(),
    title: String(raw.title ?? raw.url).slice(0, 300),
    url: raw.url.slice(0, 2048),
    folder: String(raw.folder ?? '').slice(0, 60),
    added: Number.isFinite(raw.added) ? Number(raw.added) : Date.now(),
    pinned: raw.pinned === true
  }
}

/** Saved bookmarks for the active profile, with optional folders and a bar. */
class Bookmarks {
  private store = track(
    new JsonStore<BookmarksFile>(
      'bookmarks.json',
      () => ({ items: [], folders: [] }),
      BOOKMARKS_VERSION,
      (data) => data as Partial<BookmarksFile>,
      (data) => {
        const items = Array.isArray(data?.items)
          ? data.items.map(sanitizeItem).filter((b): b is Bookmark => b !== null).slice(0, 5000)
          : []
        const folders = Array.isArray(data?.folders)
          ? [...new Set(data.folders.filter((f): f is string => typeof f === 'string').map((f) => f.slice(0, 60)))]
          : []
        for (const item of items) if (item.folder && !folders.includes(item.folder)) folders.push(item.folder)
        return { items, folders }
      }
    )
  )

  load(dir: string) {
    this.store.open(dir)
  }

  all(): Bookmark[] {
    return [...this.store.get().items].sort((a, b) => b.added - a.added)
  }

  bar(): Bookmark[] {
    return this.all().filter((b) => b.pinned)
  }

  folders(): string[] {
    return this.store.get().folders
  }

  find(url: string): Bookmark | undefined {
    return this.store.get().items.find((b) => b.url === url)
  }

  add(input: { title: string; url: string; folder?: string; pinned?: boolean }): Bookmark | null {
    const item = sanitizeItem({ ...input, added: Date.now() })
    if (!item) return null
    const file = this.store.get()
    const existing = file.items.find((b) => b.url === item.url)
    if (existing) {
      const updated = { ...existing, title: item.title || existing.title, folder: item.folder || existing.folder }
      this.store.replace({
        items: file.items.map((b) => (b.id === existing.id ? updated : b)),
        folders: this.withFolder(file.folders, updated.folder)
      })
      this.store.flush()
      return updated
    }
    this.store.replace({
      items: [...file.items, item],
      folders: this.withFolder(file.folders, item.folder)
    })
    this.store.flush()
    return item
  }

  update(id: string, patch: Partial<Pick<Bookmark, 'title' | 'url' | 'folder' | 'pinned'>>): boolean {
    const file = this.store.get()
    const current = file.items.find((b) => b.id === id)
    if (!current) return false
    const next = sanitizeItem({ ...current, ...patch })
    if (!next) return false
    this.store.replace({
      items: file.items.map((b) => (b.id === id ? next : b)),
      folders: this.withFolder(file.folders, next.folder)
    })
    this.store.flush()
    return true
  }

  toggle(input: { title: string; url: string }): { added: boolean; bookmark?: Bookmark } {
    const existing = this.find(input.url)
    if (existing) {
      this.remove(existing.id)
      return { added: false }
    }
    const bookmark = this.add(input)
    return { added: bookmark !== null, bookmark: bookmark ?? undefined }
  }

  remove(id: string): boolean {
    const file = this.store.get()
    const items = file.items.filter((b) => b.id !== id)
    if (items.length === file.items.length) return false
    this.store.replace({ items, folders: file.folders })
    this.store.flush()
    return true
  }

  removeFolder(name: string): void {
    const file = this.store.get()
    this.store.replace({
      items: file.items.map((b) => (b.folder === name ? { ...b, folder: '' } : b)),
      folders: file.folders.filter((f) => f !== name)
    })
    this.store.flush()
  }

  flush() {
    this.store.flush()
  }

  private withFolder(folders: string[], folder: string) {
    if (!folder || folders.includes(folder)) return folders
    return [...folders, folder]
  }
}

export const bookmarks = new Bookmarks()
