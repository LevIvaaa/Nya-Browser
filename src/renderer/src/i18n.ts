// ---------------------------------------------------------------------------
// Translation runtime for the interface.
//
// t() looks a Russian source string up in the active dictionary and returns
// it untouched when there is none — so a missing translation shows Russian,
// never a bare key. Dictionaries are lazy: only the active language is loaded.
// ---------------------------------------------------------------------------

import { fill, resolveLanguage } from '../../shared/i18n'

type Dict = Record<string, string>

const loaders = import.meta.glob<{ default: Dict }>('../../shared/locales/*.json')

let dict: Dict = {}
let active = 'ru'
const listeners = new Set<() => void>()

export function currentLanguage(): string {
  return active
}

/** Codes that actually have a dictionary on disk (Russian is the source). */
export function availableLanguages(): Set<string> {
  const codes = new Set(['ru'])
  for (const key of Object.keys(loaders)) {
    const m = /\/([\w-]+)\.json$/.exec(key)
    if (m) codes.add(m[1])
  }
  return codes
}

/** Re-render hooks: App bumps a key on this, remounting the whole tree. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Switches the interface to the language a setting names ('' = system).
 * Resolves once the dictionary is in memory.
 */
export async function applyLanguage(setting: string): Promise<void> {
  const next = resolveLanguage(setting, navigator.language || 'ru')
  if (next === active) return
  if (next === 'ru') {
    dict = {}
  } else {
    // A language we list but have no dictionary for degrades to English, not
    // to the source Russian — English is the fallback everyone half-reads.
    const load =
      loaders[`../../shared/locales/${next}.json`] ?? loaders['../../shared/locales/en.json']
    dict = load ? (await load()).default : {}
  }
  active = next
  for (const listener of listeners) listener()
}

/** The Russian string in, its translation out; {placeholders} filled. */
export function t(key: string, values?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, values)
}
