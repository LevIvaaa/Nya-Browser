import { JsonStore, track } from './store'
import type { UsageSpan, UsageSummary } from '../shared/types'

/**
 * How long this browser is looked at, and where.
 *
 * Only two things are written down: the day, and the site. No addresses, no
 * titles, no order — a row says "ozon.ru, forty minutes, Tuesday" and nothing
 * else, and nothing leaves the profile folder. Ninety days are kept, which is
 * enough to see a month and short enough that it cannot become a diary.
 */
interface UsageData {
  /** 'YYYY-MM-DD' → host → seconds */
  days: Record<string, Record<string, number>>
}

const KEEP_DAYS = 90

/** Local days, not UTC ones: a night at the browser belongs to that night. */
function dayKey(when: Date): string {
  const year = when.getFullYear()
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const day = String(when.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sanitize(data: Partial<UsageData>): UsageData {
  const days: UsageData['days'] = {}
  const raw = data.days
  if (raw && typeof raw === 'object') {
    for (const [day, hosts] of Object.entries(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hosts || typeof hosts !== 'object') continue
      const kept: Record<string, number> = {}
      for (const [host, seconds] of Object.entries(hosts as Record<string, unknown>)) {
        const value = Number(seconds)
        if (!host || host.length > 120 || !Number.isFinite(value) || value <= 0) continue
        // A day is 86 400 seconds; anything above that is a broken clock.
        kept[host] = Math.min(Math.round(value), 86_400)
      }
      if (Object.keys(kept).length > 0) days[day] = kept
    }
  }
  return { days }
}

class Usage {
  private store = track(
    new JsonStore<UsageData>('usage.json', () => ({ days: {} }), 1, (d) => d as Partial<UsageData>, sanitize)
  )

  load(dir: string) {
    this.store.open(dir)
    this.forget()
  }

  /** One more tick of attention on one site. */
  add(host: string, seconds: number) {
    if (!host || seconds <= 0) return
    const data = this.store.get()
    const day = dayKey(new Date())
    const today = { ...(data.days[day] ?? {}) }
    today[host] = Math.min(86_400, (today[host] ?? 0) + Math.round(seconds))
    this.store.set({ days: { ...data.days, [day]: today } })
  }

  summary(): UsageSummary {
    const days = this.store.get().days
    const now = new Date()
    const span = (back: number): UsageSpan => {
      const totals = new Map<string, number>()
      for (let i = 0; i < back; i += 1) {
        const when = new Date(now)
        when.setDate(now.getDate() - i)
        const hosts = days[dayKey(when)]
        if (!hosts) continue
        for (const [host, seconds] of Object.entries(hosts)) {
          totals.set(host, (totals.get(host) ?? 0) + seconds)
        }
      }
      const sites = [...totals.entries()]
        .map(([host, seconds]) => ({ host, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 20)
      return { seconds: [...totals.values()].reduce((sum, n) => sum + n, 0), sites }
    }
    // The last thirty days as a row of numbers: the chart takes whichever
    // slice of it the chosen period needs.
    const trend: Array<{ day: string; seconds: number }> = []
    for (let i = 29; i >= 0; i -= 1) {
      const when = new Date(now)
      when.setDate(now.getDate() - i)
      const key = dayKey(when)
      const hosts = days[key]
      trend.push({
        day: key,
        seconds: hosts ? Object.values(hosts).reduce((sum, n) => sum + n, 0) : 0
      })
    }
    return { today: span(1), week: span(7), month: span(30), trend }
  }

  clear() {
    this.store.set({ days: {} })
  }

  flush() {
    this.store.flush()
  }

  /** Older than ninety days is nobody's business, including ours. */
  private forget() {
    const days = this.store.get().days
    const edge = new Date()
    edge.setDate(edge.getDate() - KEEP_DAYS)
    const cutoff = dayKey(edge)
    const kept: UsageData['days'] = {}
    let dropped = false
    for (const [day, hosts] of Object.entries(days)) {
      if (day < cutoff) dropped = true
      else kept[day] = hosts
    }
    if (dropped) this.store.set({ days: kept })
  }
}

export const usage = new Usage()
