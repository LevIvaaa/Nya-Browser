import { JsonStore, track } from './store'

/**
 * Where you stopped watching.
 *
 * Sites that remember this are the ones with an account and a player of their
 * own; everything else — a lecture on a university page, a film on a small
 * host, a recording linked from a forum — starts from the beginning every
 * time. The browser is in a position to remember, so it does: the address, the
 * second, and how long the whole thing was.
 *
 * Two hundred entries and sixty days, which covers everything anybody means by
 * "where was I". Nothing is kept for a private window, nothing for anything
 * under two minutes, and nothing once it has been watched to the end.
 */
interface Spot {
  at: number
  of: number
  when: number
}

interface PlayData {
  spots: Record<string, Spot>
}

const KEEP = 200
const KEEP_MS = 60 * 24 * 60 * 60 * 1000

function sanitize(data: Partial<PlayData>): PlayData {
  const spots: PlayData['spots'] = {}
  const raw = data.spots
  if (raw && typeof raw === 'object') {
    for (const [url, value] of Object.entries(raw)) {
      const spot = value as Partial<Spot>
      const at = Number(spot?.at)
      const of = Number(spot?.of)
      const when = Number(spot?.when)
      if (!url || url.length > 2000) continue
      if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(when) || when <= 0) continue
      spots[url] = { at: Math.round(at), of: Number.isFinite(of) ? Math.round(of) : 0, when }
    }
  }
  const kept = Object.entries(spots)
    .sort((a, b) => b[1].when - a[1].when)
    .slice(0, KEEP)
  return { spots: Object.fromEntries(kept) }
}

const keyOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    // The fragment is where the reader is on the page, not which video this is.
    parsed.hash = ''
    return parsed.toString().slice(0, 2000)
  } catch {
    return ''
  }
}

class Playback {
  private store = track(
    new JsonStore<PlayData>('playback.json', () => ({ spots: {} }), 1, (d) => d as Partial<PlayData>, sanitize)
  )
  private last = 0

  load(dir: string) {
    this.store.open(dir)
    this.forget()
  }

  keep(url: string, at: number, of: number) {
    const key = keyOf(url)
    if (!key || at < 20) return
    this.last = Math.max(Date.now(), this.last + 1)
    const spots = { ...this.store.get().spots, [key]: { at: Math.round(at), of: Math.round(of), when: this.last } }
    const kept = Object.entries(spots)
      .sort((a, b) => b[1].when - a[1].when)
      .slice(0, KEEP)
    this.store.replace({ spots: Object.fromEntries(kept) })
  }

  /** The second to come back to, or zero. */
  find(url: string): number {
    const key = keyOf(url)
    if (!key) return 0
    const spot = this.store.get().spots[key]
    if (!spot || Date.now() - spot.when > KEEP_MS) return 0
    return spot.at
  }

  /** Watched to the end, or started again from the top. */
  drop(url: string) {
    const key = keyOf(url)
    const spots = { ...this.store.get().spots }
    if (!key || !spots[key]) return
    delete spots[key]
    this.store.replace({ spots })
  }

  clear() {
    this.store.replace({ spots: {} })
    this.store.flush()
  }

  private forget() {
    const edge = Date.now() - KEEP_MS
    const data = this.store.get()
    const spots = Object.fromEntries(Object.entries(data.spots).filter(([, spot]) => spot.when > edge))
    if (Object.keys(spots).length !== Object.keys(data.spots).length) this.store.replace({ spots })
  }

  flush() {
    this.store.flush()
  }
}

export const playback = new Playback()
