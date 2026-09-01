// ---------------------------------------------------------------------------
// Weather for the start page.
//
// Open-Meteo is the only service this browser talks to that the user did not
// navigate to, so it is worth saying what that costs: nothing goes out until
// the user picks a place, the request carries a rounded coordinate and no key,
// account or identifier, and the answer is cached so an open start page is not
// a heartbeat. Turning the widget off stops it completely.
// ---------------------------------------------------------------------------

import { net } from 'electron'
import { log } from './log'
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

/** Cities matching what the user typed, best match first. */
export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const url = `${GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=ru&format=json`
    const data = (await ask(url)) as { results?: Record<string, unknown>[] }
    return (data.results ?? []).map((r) => ({
      name: String(r.name ?? ''),
      region: String(r.admin1 ?? ''),
      country: String(r.country ?? ''),
      lat: Number(r.latitude ?? 0),
      lon: Number(r.longitude ?? 0)
    }))
  } catch (error) {
    log('weather: search failed', String(error))
    return []
  }
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
