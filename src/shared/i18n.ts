// ---------------------------------------------------------------------------
// Languages the browser speaks.
//
// The source language of the code is Russian: every t() key IS the Russian
// string, so untranslated text degrades to readable Russian instead of to a
// bare identifier. Each locale file maps those strings to one language.
//
// `name` is the language's own name for itself — a picker where every entry
// is legible to the person who needs it is the whole point of one.
// ---------------------------------------------------------------------------

export interface Language {
  code: string
  name: string
}

/** '' in settings means "follow the system"; everything else must be here. */
export const LANGUAGES: Language[] = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'cs', name: 'Čeština' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'sr', name: 'Српски' },
  { code: 'bg', name: 'Български' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'sv', name: 'Svenska' },
  { code: 'no', name: 'Norsk' },
  { code: 'da', name: 'Dansk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'et', name: 'Eesti' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'be', name: 'Беларуская' },
  { code: 'kk', name: 'Қазақша' },
  { code: 'ky', name: 'Кыргызча' },
  { code: 'uz', name: 'Oʻzbekcha' },
  { code: 'az', name: 'Azərbaycanca' },
  { code: 'ka', name: 'ქართული' },
  { code: 'hy', name: 'Հայերեն' },
  { code: 'he', name: 'עברית' },
  { code: 'ar', name: 'العربية' },
  { code: 'fa', name: 'فارسی' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ur', name: 'اردو' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'mr', name: 'मराठी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'fil', name: 'Filipino' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-CN', name: '中文（简体）' },
  { code: 'zh-TW', name: '中文（繁體）' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'ca', name: 'Català' },
  { code: 'gl', name: 'Galego' },
  { code: 'sq', name: 'Shqip' },
  { code: 'mk', name: 'Македонски' },
  { code: 'bs', name: 'Bosanski' },
  { code: 'is', name: 'Íslenska' },
  { code: 'mn', name: 'Монгол' },
  { code: 'ne', name: 'नेपाली' },
  { code: 'si', name: 'සිංහල' },
  { code: 'km', name: 'ខ្មែរ' },
  { code: 'am', name: 'አማርኛ' }
]

const KNOWN = new Set(LANGUAGES.map((l) => l.code))

export function isKnownLanguage(code: string): boolean {
  return KNOWN.has(code)
}

/**
 * The locale to use for a setting value: the setting itself when it names a
 * language we have, otherwise the closest match for the system locale,
 * otherwise English. Russian needs no dictionary — it is the source.
 */
export function resolveLanguage(setting: string, systemLocale: string): string {
  if (setting && KNOWN.has(setting)) return setting
  const system = systemLocale.replace('_', '-')
  if (KNOWN.has(system)) return system
  const base = system.split('-')[0]
  if (base === 'zh') return system.toLowerCase().includes('tw') || system.toLowerCase().includes('hant') ? 'zh-TW' : 'zh-CN'
  if (base === 'pt') return system.toLowerCase().includes('pt') ? 'pt-PT' : 'pt-BR'
  if (KNOWN.has(base)) return base
  return 'en'
}

/** Fills {placeholders} in an already-translated string. */
export function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole
  )
}
