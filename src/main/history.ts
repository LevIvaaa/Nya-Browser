import { URL } from 'url'
import { JsonStore, track } from './store'
import type { HistoryEntry, Suggestion } from '../shared/types'

const MAX_ENTRIES = 8000
const HISTORY_VERSION = 1

interface HistoryFile {
  entries: HistoryEntry[]
}

/**
 * Local visit history for the active profile. It never leaves the machine: the
 * address bar builds its suggestions from this file, so typing does not send
 * keystrokes to any search API.
 */
class History {
  private store = track(
    new JsonStore<HistoryFile>(
      'history.json',
      () => ({ entries: [] }),
      HISTORY_VERSION,
      (data) => (Array.isArray(data) ? { entries: data as HistoryEntry[] } : (data as HistoryFile)),
      (data) => ({
        entries: Array.isArray(data?.entries)
          ? data.entries
              .filter((e) => e && typeof e.url === 'string' && /^https?:/i.test(e.url))
              .slice(-MAX_ENTRIES)
              .map((e) => ({
                url: String(e.url).slice(0, 2048),
                title: String(e.title ?? e.url).slice(0, 300),
                visits: Number.isFinite(e.visits) ? Math.max(1, Math.floor(e.visits)) : 1,
                last: Number.isFinite(e.last) ? e.last : 0
              }))
          : []
      })
    )
  )
  private index = new Map<string, HistoryEntry>()
  private enabled = true

  load(dir: string) {
    this.store.open(dir)
    this.index = new Map(this.store.get().entries.map((e) => [e.url, e]))
  }

  setEnabled(on: boolean) {
    this.enabled = on
  }

  record(url: string, title: string) {
    if (!this.enabled || !/^https?:/i.test(url)) return
    const prev = this.index.get(url)
    const entry: HistoryEntry = {
      url,
      title: title || prev?.title || url,
      visits: (prev?.visits ?? 0) + 1,
      last: Date.now()
    }
    this.index.set(url, entry)
    if (this.index.size > MAX_ENTRIES) {
      const oldest = [...this.index.values()].sort((a, b) => a.last - b.last)
      for (const e of oldest.slice(0, this.index.size - MAX_ENTRIES)) this.index.delete(e.url)
    }
    this.persist()
  }

  updateTitle(url: string, title: string) {
    const entry = this.index.get(url)
    if (entry && title && entry.title !== title) {
      entry.title = title
      this.persist()
    }
  }

  remove(url: string) {
    if (this.index.delete(url)) this.persist()
  }

  all(): HistoryEntry[] {
    return [...this.index.values()].sort((a, b) => b.last - a.last)
  }

  recent(limit = 60): Suggestion[] {
    return this.all()
      .slice(0, limit)
      .map((e) => ({ kind: 'history' as const, title: e.title, url: e.url, visits: e.visits }))
  }

  /** Ranked match over host, path and title, newest and most visited first. */
  search(query: string, limit = 8): Suggestion[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const now = Date.now()
    const scored: Array<{ entry: HistoryEntry; score: number }> = []

    for (const entry of this.index.values()) {
      let host = ''
      try {
        host = new URL(entry.url).hostname.replace(/^www\./, '')
      } catch {
        continue
      }
      const title = entry.title.toLowerCase()
      const url = entry.url.toLowerCase()
      let score = 0
      if (host.startsWith(q)) score += 120
      else if (host.includes(q)) score += 60
      if (title.startsWith(q)) score += 70
      else if (title.includes(q)) score += 35
      if (url.includes(q)) score += 20
      if (!score) continue
      score += Math.min(40, entry.visits * 4)
      score -= Math.min(45, ((now - entry.last) / 86_400_000) * 1.5)
      scored.push({ entry, score })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry }) => ({
        kind: 'history' as const,
        title: entry.title,
        url: entry.url,
        visits: entry.visits
      }))
  }

  clear() {
    this.index.clear()
    this.persist()
    this.store.flush()
  }

  flush() {
    this.store.flush()
  }

  private persist() {
    this.store.replace({ entries: [...this.index.values()] })
  }
}

export const history = new History()
