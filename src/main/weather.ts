// ---------------------------------------------------------------------------
// Weather for the start page.
//
// Open-Meteo is the only service this browser talks to that the user did not
// navigate to, so it is worth saying what that costs: nothing goes out until
// the picker is opened or a place is set, the requests are a city name and a
// rounded coordinate with no key, account or identifier, and the answer is
// cached so an open start page is not a heartbeat. Turning the widget off
// stops it completely.
// ---------------------------------------------------------------------------

import { app, net } from 'electron'
import { log } from './log'
import { settings } from './settings'
import type { Place, Weather } from '../shared/types'

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

/** Long enough that the widget is not a heartbeat, short enough to be true. */
const CACHE_MS = 15 * 60 * 1000
const TIMEOUT_MS = 8000

const cache = new Map<string, { at: number; value: Weather }>()

async function ask(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // net.fetch rides Chromium's stack, so it follows the proxy the rest of the
    // browser uses instead of quietly going direct.
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Which languages a name could be written in, judged by the letters used.
 * Nothing clever: enough to tell Georgian from Greek from Thai, because the
 * alphabet a person types in narrows the answer more than anything else does.
 */
const SCRIPTS: Array<[RegExp, string[]]> = [
  [/[Ѐ-ӿ]/, ['ru', 'uk', 'bg', 'sr']],
  [/[Ͱ-Ͽ]/, ['el']],
  [/[԰-֏]/, ['hy']],
  [/[א-ת]/, ['he']],
  [/[؀-ۿ]/, ['ar', 'fa', 'ur']],
  [/[ऀ-ॿ]/, ['hi', 'mr', 'ne']],
  [/[฀-๿]/, ['th']],
  [/[Ⴀ-ჿ]/, ['ka']],
  [/[가-힯]/, ['ko']],
  [/[぀-ヿ]/, ['ja']],
  [/[一-鿿]/, ['zh', 'ja']],
  [/[a-z]/i, ['en', 'de', 'fr', 'es', 'it', 'pl', 'tr']]
]

/**
 * The names are indexed one language at a time, and the language asked for
 * decides which of them can be found at all: with Russian asked for, «Київ»,
 * «თბილისი» and «أبوظبي» are no such place — measured against the service
 * itself. So the search is made in the language of the browser first, then in
 * the languages the letters could belong to, and it stops at the first answer
 * that has something in it. Five tries at most, and only a search that came
 * back empty ever gets past the first.
 */
function searchLanguages(query: string): string[] {
  const mine = (settings.get().language || app.getLocale() || 'en').toLowerCase().split('-')[0]
  const byLetters = SCRIPTS.find(([letters]) => letters.test(query))?.[1] ?? []
  return [...new Set([mine, ...byLetters, 'en'])].slice(0, 5)
}

/**
 * Cities matching what the user typed, best match first — or null, which
 * means the service could not be reached. Empty and unreachable are
 * different answers: one of them is not the person's fault.
 */
export async function searchPlaces(query: string): Promise<Place[] | null> {
  const q = query.trim()
  if (q.length < 2) return []
  let reached = false
  for (const language of searchLanguages(q)) {
    try {
      const url = `${GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=${language}&format=json`
      const data = (await ask(url)) as { results?: Record<string, unknown>[] }
      reached = true
      const found = (data.results ?? []).map((r) => ({
        name: String(r.name ?? ''),
        region: String(r.admin1 ?? ''),
        country: String(r.country ?? ''),
        lat: Number(r.latitude ?? 0),
        lon: Number(r.longitude ?? 0)
      }))
      // The place actually named first: the service ranks by how big a thing
      // is, so «Warszawa Neighborhood Historic District» can come before the
      // city somebody plainly typed the name of.
      const named = q.toLocaleLowerCase()
      found.sort(
        (a, b) =>
          Number(b.name.toLocaleLowerCase() === named) -
          Number(a.name.toLocaleLowerCase() === named)
      )
      if (found.length > 0) return found
    } catch (error) {
      log('weather: search failed', String(error))
    }
  }
  return reached ? [] : null
}

/**
 * The city this computer's clock is set by. A timezone is named after one,
 * it is already on the machine, and reading it tells nobody anything — the
 * search it leads to is the same search typing that name would make. It is
 * a suggestion in the picker, not a decision: nothing is chosen by it.
 */
export async function guessPlace(): Promise<Place | null> {
  let zone = ''
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return null
  }
  // Europe/Kyiv, America/Argentina/Buenos_Aires — the city is the last part.
  const city = (zone.split('/').pop() ?? '').replace(/_/g, ' ')
  if (city.length < 2) return null
  const found = await searchPlaces(city)
  return found?.[0] ?? null
}

export async function currentWeather(lat: number, lon: number): Promise<Weather | null> {
  // Three decimals is about a hundred metres — plenty for a temperature, and
  // it keeps the exact address out of the request.
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  try {
    const url =
      `${FORECAST}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=5'
    const data = (await ask(url)) as {
      current?: Record<string, number>
      daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] }
    }
    const c = data.current ?? {}
    const d = data.daily ?? {}
    const value: Weather = {
      temperature: Math.round(Number(c.temperature_2m ?? 0)),
      feels: Math.round(Number(c.apparent_temperature ?? c.temperature_2m ?? 0)),
      code: Number(c.weather_code ?? 0),
      wind: Math.round(Number(c.wind_speed_10m ?? 0)),
      day: Number(c.is_day ?? 1) === 1,
      high: Math.round(Number(d.temperature_2m_max?.[0] ?? 0)),
      low: Math.round(Number(d.temperature_2m_min?.[0] ?? 0)),
      forecast: (d.time ?? []).slice(1, 5).map((day, i) => ({
        day,
        code: Number(d.weather_code?.[i + 1] ?? 0),
        high: Math.round(Number(d.temperature_2m_max?.[i + 1] ?? 0)),
        low: Math.round(Number(d.temperature_2m_min?.[i + 1] ?? 0))
      })),
      fetched: Date.now()
    }
    cache.set(key, { at: Date.now(), value })
    return value
  } catch (error) {
    log('weather: forecast failed', String(error))
    // A stale reading beats an empty widget when the network blinks.
    return hit?.value ?? null
  }
}
