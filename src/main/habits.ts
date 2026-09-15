import { JsonStore, track } from './store'

/**
 * What you open at this hour.
 *
 * The morning is mail and a news site; the evening is something else entirely.
 * A start page that offers the same eight tiles at eight in the morning and at
 * eleven at night is offering the average of two different people.
 *
 * What is kept is far less than the history already holds: a host, an hour of
 * the day, and a count. No addresses, no titles, no times — "github.com, 09,
 * 42 times" cannot say which repository or when. It is also the only thing
 * here that survives clearing the history, so it is cleared with it.
 */

interface HabitData {
  /** hour of the day (0–23) → host → how often it was opened then */
  hours: Record<string, Record<string, number>>
}

const HABITS_VERSION = 1

/** Enough hosts per hour to find the handful that matter, and no more. */
const HOSTS_PER_HOUR = 40
/**
 * Counts fade rather than pile up for ever: when an hour's biggest count
 * passes this, everything in that hour is halved. What somebody opened every
 * morning two years ago stops outvoting what they open every morning now.
 */
const FADE_ABOVE = 200

function sanitize(data: Partial<HabitData>): HabitData {
  const hours: HabitData['hours'] = {}
  const raw = data.hours
  if (raw && typeof raw === 'object') {
    for (const [hour, value] of Object.entries(raw)) {
      if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23) continue
      const hosts: Record<string, number> = {}
      for (const [host, count] of Object.entries((value ?? {}) as Record<string, unknown>)) {
        const n = Number(count)
        if (!/^[a-z0-9.-]{1,120}$/i.test(host) || !Number.isFinite(n) || n <= 0) continue
        hosts[host.toLowerCase()] = Math.min(10_000, Math.round(n))
      }
      hours[String(Number(hour))] = hosts
    }
  }
  return { hours }
}

class Habits {
  private store = track(
    new JsonStore<HabitData>(
      'habits.json',
      () => ({ hours: {} }),
      HABITS_VERSION,
      (data) => data as HabitData,
      (data) => sanitize((data ?? {}) as Partial<HabitData>)
    )
  )

  load(dir: string) {
    this.store.open(dir)
  }

  /** One visit, counted under the hour it happened in. */
  record(url: string, now = new Date()) {
    let host = ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
      host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      return
    }
    if (!host) return

    const data = this.store.get()
    const key = String(now.getHours())
    const hosts = { ...(data.hours[key] ?? {}) }
    hosts[host] = (hosts[host] ?? 0) + 1

    // Fade, then trim: the oldest habits lose to the newest ones rather than
    // being remembered for ever.
    const highest = Math.max(...Object.values(hosts))
    if (highest > FADE_ABOVE) {
      for (const one of Object.keys(hosts)) hosts[one] = Math.floor(hosts[one] / 2)
    }
    const kept = Object.entries(hosts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, HOSTS_PER_HOUR)

    this.store.set({ hours: { ...data.hours, [key]: Object.fromEntries(kept) } })
  }

  /**
   * The hosts most often opened around this time.
   *
   * The hour either side counts too, at half weight: somebody who reads the
   * news at 08:55 one day and 09:05 the next has one habit, not two.
   */
  atThisHour(now = new Date(), want = 6): Array<{ host: string; count: number }> {
    const data = this.store.get()
    const hour = now.getHours()
    const score = new Map<string, number>()
    for (const [offset, weight] of [
      [0, 1],
      [-1, 0.5],
      [1, 0.5]
    ] as const) {
      const hosts = data.hours[String((hour + offset + 24) % 24)] ?? {}
      for (const [host, count] of Object.entries(hosts)) {
        score.set(host, (score.get(host) ?? 0) + count * weight)
      }
    }
    return [...score.entries()]
      .map(([host, count]) => ({ host, count: Math.round(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, want)
  }

  /** Cleared along with the history, because it is made of the same visits. */
  clear() {
    this.store.set({ hours: {} })
  }

  flush() {
    this.store.flush()
  }
}

export const habits = new Habits()
