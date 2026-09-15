// ---------------------------------------------------------------------------
// Exchange rates for the start page.
//
// The second and last service this browser talks to without being navigated
// to, and it is worth the same sentence as the weather: nothing goes out until
// the widget is switched on, the request carries three currency codes and
// nothing else — no key, no account, no identifier — and the answer is cached
// for an hour, because a rate that moves in the fourth decimal does not need a
// heartbeat. Turning the widget off stops it completely.
//
// The rates are the European Central Bank's own daily reference rates, which
// is why there is no key: they are public.
// ---------------------------------------------------------------------------

import { net } from 'electron'
import { log } from './log'
import type { Rates } from '../shared/types'

const ENDPOINT = 'https://api.frankfurter.app/latest'
const TIMEOUT_MS = 8000
/** The ECB publishes once a working day; an hour is already generous. */
const CACHE_MS = 60 * 60 * 1000

/** What somebody may ask for. Anything else is not sent. */
const CODE = /^[A-Z]{3}$/

const cache = new Map<string, { at: number; value: Rates }>()

/**
 * What one unit of `from` is worth in each of `to`.
 *
 * Returns null rather than throwing: a start page widget that cannot reach the
 * bank should say so quietly and carry on being a start page.
 */
export async function rates(from: string, to: string[]): Promise<Rates | null> {
  const base = String(from ?? '').toUpperCase()
  const wanted = [...new Set(to.map((one) => String(one ?? '').toUpperCase()))]
    .filter((one) => CODE.test(one) && one !== base)
    .slice(0, 6)
  if (!CODE.test(base) || wanted.length === 0) return null

  const key = `${base}>${wanted.join(',')}`
  const known = cache.get(key)
  if (known && Date.now() - known.at < CACHE_MS) return known.value

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = `${ENDPOINT}?from=${base}&to=${wanted.join(',')}`
    // net.fetch rides Chromium's stack, so it follows the proxy the rest of
    // the browser uses instead of quietly going direct.
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { date?: string; rates?: Record<string, unknown> }
    const out: Rates = { base, date: String(body.date ?? ''), rates: {} }
    for (const one of wanted) {
      const value = Number(body.rates?.[one])
      if (Number.isFinite(value) && value > 0) out.rates[one] = value
    }
    if (Object.keys(out.rates).length === 0) return null
    cache.set(key, { at: Date.now(), value: out })
    return out
  } catch (error) {
    log('rates', String(error))
    // The last good answer beats nothing at all, even when it is stale.
    return known?.value ?? null
  } finally {
    clearTimeout(timer)
  }
}
