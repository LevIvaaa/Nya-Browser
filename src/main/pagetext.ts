import { JsonStore, track } from './store'

/**
 * What the pages you visited actually said.
 *
 * History remembers titles and addresses, which is enough to find a page you
 * remember the name of and useless for the far more common case: you remember
 * a sentence. So a trimmed copy of the words on each page is kept here, and
 * the history page searches it.
 *
 * Deliberately modest. Four kilobytes a page — the opening of an article, not
 * the whole of it — a thousand pages, and ninety days. That is a few megabytes
 * on disk and it answers the question people actually ask. Nothing is kept for
 * a private window, and clearing history clears this with it.
 */
interface Page {
  /** the beginning of the page's text, with runs of space collapsed */
  text: string
  title: string
  at: number
}

interface TextData {
  pages: Record<string, Page>
}

const KEEP_PAGES = 1000
const KEEP_MS = 90 * 24 * 60 * 60 * 1000
const MAX_CHARS = 4000

function sanitize(data: Partial<TextData>): TextData {
  const pages: TextData['pages'] = {}
  const raw = data.pages
  if (raw && typeof raw === 'object') {
    for (const [url, value] of Object.entries(raw)) {
      const page = value as Partial<Page>
      const at = Number(page?.at)
      if (!url || url.length > 2000 || !Number.isFinite(at) || at <= 0) continue
      const text = typeof page.text === 'string' ? page.text.slice(0, MAX_CHARS) : ''
      if (!text.trim()) continue
      pages[url] = { text, title: String(page.title ?? '').slice(0, 300), at }
    }
  }
  const kept = Object.entries(pages)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, KEEP_PAGES)
  return { pages: Object.fromEntries(kept) }
}

export interface TextHit {
  url: string
  title: string
  at: number
  /** the words around the match, for the list to show */
  snippet: string
}

class PageText {
  private store = track(
    new JsonStore<TextData>(
      'pagetext.json',
      () => ({ pages: {} }),
      1,
      (d) => d as Partial<TextData>,
      sanitize
    )
  )
  private last = 0

  load(dir: string) {
    this.store.open(dir)
    this.forget()
  }

  /** What a page said, as the page itself reported it. */
  keep(url: string, title: string, text: string) {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
    if (!clean || clean.length < 80) return
    if (!/^https?:/i.test(url)) return
    this.last = Math.max(Date.now(), this.last + 1)
    const pages = { ...this.store.get().pages, [url.slice(0, 2000)]: { text: clean, title: title.slice(0, 300), at: this.last } }
    const kept = Object.entries(pages)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, KEEP_PAGES)
    this.store.replace({ pages: Object.fromEntries(kept) })
  }

  /**
   * Pages whose words contain this.
   *
   * A plain substring search over a few megabytes, which on any machine made
   * this century is instant and needs no index to go stale.
   */
  find(query: string, limit = 60): TextHit[] {
    const needle = query.trim().toLowerCase()
    if (needle.length < 3) return []
    const out: TextHit[] = []
    for (const [url, page] of Object.entries(this.store.get().pages)) {
      const at = page.text.toLowerCase().indexOf(needle)
      if (at < 0) continue
      const from = Math.max(0, at - 60)
      const snippet =
        (from > 0 ? '…' : '') +
        page.text.slice(from, at + needle.length + 90).trim() +
        (at + needle.length + 90 < page.text.length ? '…' : '')
      out.push({ url, title: page.title, at: page.at, snippet })
      if (out.length >= limit) break
    }
    return out.sort((a, b) => b.at - a.at)
  }

  clear() {
    this.store.replace({ pages: {} })
    this.store.flush()
  }

  /** One page forgotten, when its history entry is. */
  forgetUrl(url: string) {
    const pages = { ...this.store.get().pages }
    if (!pages[url]) return
    delete pages[url]
    this.store.replace({ pages })
  }

  private forget() {
    const edge = Date.now() - KEEP_MS
    const data = this.store.get()
    const pages = Object.fromEntries(Object.entries(data.pages).filter(([, page]) => page.at > edge))
    if (Object.keys(pages).length !== Object.keys(data.pages).length) this.store.replace({ pages })
  }

  flush() {
    this.store.flush()
  }
}

export const pageText = new PageText()
