import { JsonStore, track } from './store'

/**
 * What was typed into a form and never sent.
 *
 * A long comment, a support ticket, a job application — typed over twenty
 * minutes, then a misclick on Back, a crash, or a session that expired, and it
 * is gone. Every browser loses this and every browser is forgiven for it,
 * which does not make the loss smaller.
 *
 * What is kept is deliberately narrow. Password boxes are never here: the page
 * side refuses to read them, and so does this. Neither are card numbers or
 * one-time codes. What remains is ordinary text, kept under the address it was
 * typed on, for a day, and offered back once — after which it is dropped
 * whether it was taken or not.
 */
interface Draft {
  /** field key → what was in it */
  fields: Record<string, string>
  at: number
}

interface DraftData {
  pages: Record<string, Draft>
}

/** A day is long enough to come back after a crash and short enough to forget. */
const KEEP_MS = 24 * 60 * 60 * 1000
/** Fifty pages; the oldest goes when the fifty-first arrives. */
const KEEP_PAGES = 50
/** Per field, and in total — a draft is a form, not a file. */
const FIELD_MAX = 20_000
const DRAFT_MAX = 60_000

function sanitize(data: Partial<DraftData>): DraftData {
  const pages: DraftData['pages'] = {}
  const raw = data.pages
  if (raw && typeof raw === 'object') {
    for (const [url, value] of Object.entries(raw)) {
      const draft = value as Partial<Draft>
      const at = Number(draft?.at)
      if (!url || url.length > 2000 || !Number.isFinite(at) || at <= 0) continue
      const fields: Record<string, string> = {}
      let total = 0
      for (const [key, text] of Object.entries((draft.fields ?? {}) as Record<string, unknown>)) {
        if (typeof text !== 'string' || !text || key.length > 200) continue
        const kept = text.slice(0, FIELD_MAX)
        if (total + kept.length > DRAFT_MAX) break
        total += kept.length
        fields[key.slice(0, 200)] = kept
      }
      if (Object.keys(fields).length > 0) pages[url] = { fields, at }
    }
  }
  return { pages }
}

/** The page, without the fragment: the same form either way. */
function keyOf(url: string): string {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    parsed.hash = ''
    return parsed.toString().slice(0, 2000)
  } catch {
    return ''
  }
}

class Drafts {
  private store = track(
    new JsonStore<DraftData>(
      'drafts.json',
      () => ({ pages: {} }),
      1,
      (d) => d as Partial<DraftData>,
      sanitize
    )
  )

  /**
   * The clock, but never twice the same. Two forms saved in the same
   * millisecond would otherwise be in no defined order, and which of them the
   * fifty-first save throws away would depend on how fast the machine is.
   */
  private last = 0

  load(dir: string) {
    this.store.open(dir)
    this.forget()
  }

  /** What the page reports it is holding right now. */
  keep(url: string, fields: Record<string, string>) {
    const key = keyOf(url)
    if (!key) return
    this.last = Math.max(Date.now(), this.last + 1)
    const clean = sanitize({ pages: { [key]: { fields, at: this.last } } }).pages[key]
    const data = this.store.get()
    if (!clean) {
      if (!data.pages[key]) return
      const { [key]: _gone, ...rest } = data.pages
      this.store.replace({ pages: rest })
      return
    }
    const pages = { ...data.pages, [key]: clean }
    // Oldest out first, so a browser left open for a month does not keep a
    // year of half-written comments.
    const keys = Object.keys(pages).sort((a, b) => pages[b].at - pages[a].at)
    this.store.replace({
      pages: Object.fromEntries(keys.slice(0, KEEP_PAGES).map((k) => [k, pages[k]]))
    })
  }

  /** What was left here last time, if it is still worth offering. */
  find(url: string): Record<string, string> | null {
    const key = keyOf(url)
    if (!key) return null
    const draft = this.store.get().pages[key]
    if (!draft || Date.now() - draft.at > KEEP_MS) return null
    return draft.fields
  }

  /** Taken, or turned down, or submitted: either way it is finished with. */
  drop(url: string) {
    const key = keyOf(url)
    const data = this.store.get()
    if (!key || !data.pages[key]) return
    const { [key]: _gone, ...rest } = data.pages
    this.store.replace({ pages: rest })
    this.store.flush()
  }

  /** Everything, for the "clear data" button. */
  clear() {
    this.store.replace({ pages: {} })
    this.store.flush()
  }

  private forget() {
    const edge = Date.now() - KEEP_MS
    const data = this.store.get()
    const pages = Object.fromEntries(
      Object.entries(data.pages).filter(([, draft]) => draft.at > edge)
    )
    if (Object.keys(pages).length !== Object.keys(data.pages).length) this.store.replace({ pages })
  }

  flush() {
    this.store.flush()
  }
}

export const drafts = new Drafts()
