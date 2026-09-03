// ---------------------------------------------------------------------------
// Translation runtime for the main process: context menus, dialogs, the
// strings a tab is born with. Same contract as the renderer's — the Russian
// source string is the key, a miss falls back to it — but the locale comes
// from the settings plus app.getLocale() instead of navigator.language.
// ---------------------------------------------------------------------------

import { app } from 'electron'
import { fill, resolveLanguage } from '../shared/i18n'
import { log } from './log'

type Dict = Record<string, string>

const loaders = import.meta.glob<{ default: Dict }>('../shared/locales/*.json')

let dict: Dict = {}
let active = 'ru'

export function mainLanguage(): string {
  return active
}

/** Switches the main process to the language a setting names ('' = system). */
export async function applyMainLanguage(setting: string): Promise<void> {
  let system = 'ru'
  try {
    system = app.getLocale() || 'ru'
  } catch {
    /* before ready — keep the fallback */
  }
  const next = resolveLanguage(setting, system)
  if (next === active) return
  if (next === 'ru') {
    dict = {}
  } else {
    const load = loaders[`../shared/locales/${next}.json`] ?? loaders['../shared/locales/en.json']
    try {
      dict = load ? (await load()).default : {}
    } catch (error) {
      log('i18n: could not load', next, String(error))
      dict = {}
    }
  }
  active = next
}

/** The Russian string in, its translation out; {placeholders} filled. */
export function t(key: string, values?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, values)
}

/**
 * The Accept-Language list this language implies, for sites: the exact code
 * first, its base second, English as the fallback everyone serves. YouTube in
 * the browser's language is this header, nothing else.
 */
export function acceptLanguages(setting: string, systemLocale: string): string {
  const code = resolveLanguage(setting, systemLocale)
  const base = code.split('-')[0]
  const list = [code]
  if (base !== code) list.push(base)
  if (base !== 'en') list.push('en-US', 'en')
  return [...new Set(list)].join(',')
}
