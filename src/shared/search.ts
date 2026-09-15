import type { SearchEngine, SearchEngineId, Settings } from './types'

export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    template: 'https://duckduckgo.com/?q=%s',
    privacy: 'high',
    hint: 'Не сохраняет историю поиска и не строит профиль'
  },
  {
    id: 'startpage',
    name: 'Startpage',
    template: 'https://www.startpage.com/sp/search?query=%s',
    privacy: 'high',
    hint: 'Результаты Google без трекинга и cookies'
  },
  {
    id: 'brave',
    name: 'Brave Search',
    template: 'https://search.brave.com/search?q=%s',
    privacy: 'high',
    hint: 'Собственный индекс, без профилирования'
  },
  {
    id: 'mojeek',
    name: 'Mojeek',
    template: 'https://www.mojeek.com/search?q=%s',
    privacy: 'high',
    hint: 'Независимый индекс, полностью без трекеров'
  },
  {
    id: 'ecosia',
    name: 'Ecosia',
    template: 'https://www.ecosia.org/search?q=%s',
    privacy: 'medium',
    hint: 'Результаты Bing, доходы идут на посадку деревьев'
  },
  {
    id: 'google',
    name: 'Google',
    template: 'https://www.google.com/search?q=%s',
    privacy: 'low',
    hint: 'Лучшее качество выдачи, максимум трекинга'
  },
  {
    id: 'bing',
    name: 'Bing',
    template: 'https://www.bing.com/search?q=%s',
    privacy: 'low',
    hint: 'Поиск Microsoft, привязка к аккаунту и рекламе'
  },
  {
    id: 'yandex',
    name: 'Яндекс',
    template: 'https://yandex.ru/search/?text=%s',
    privacy: 'low',
    hint: 'Сильная выдача по рунету, собирает профиль пользователя'
  },
  {
    id: 'custom',
    name: 'Свой поисковик',
    template: '',
    privacy: 'medium',
    hint: 'Любой URL с %s на месте запроса — например, свой SearXNG'
  }
]

export const engineById = (id: SearchEngineId): SearchEngine =>
  SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES[0]

/**
 * The built-in words: one for every engine the browser ships with.
 *
 * "g кошки" goes to Google whatever the default is, "ddg кошки" to DuckDuckGo.
 * They cost nothing, they are the fastest way to search somewhere other than
 * your default, and every browser that had them and dropped them was wrong to.
 */
export const ENGINE_KEYS: Record<string, SearchEngineId> = {
  g: 'google',
  google: 'google',
  d: 'duckduckgo',
  ddg: 'duckduckgo',
  b: 'bing',
  y: 'yandex',
  ya: 'yandex',
  sp: 'startpage',
  br: 'brave',
  mj: 'mojeek',
  ec: 'ecosia'
}

/** A query aimed somewhere in particular by the word in front of it. */
export interface Aimed {
  /** where it is going, as a full address */
  url: string
  /** the name of the place, for the row that says so */
  where: string
  /** what is being searched for, without the word */
  query: string
}

/**
 * "w Тьюринг" — the word, a space, the question.
 *
 * Both the built-in engine words and anything somebody added themselves. The
 * word has to be followed by a space and something to search for: "go" on its
 * own is a search for "go", not an empty search somewhere else.
 */
export function aimed(
  raw: string,
  settings: Pick<Settings, 'searchEngine' | 'customSearchUrl' | 'customEngines'>
): Aimed | null {
  const input = raw.trim()
  const at = input.indexOf(' ')
  if (at < 1) return null
  const key = input.slice(0, at).toLowerCase()
  const query = input.slice(at + 1).trim()
  if (!query) return null

  const own = (settings.customEngines ?? []).find((engine) => engine.key === key)
  if (own) {
    return { url: own.template.replace('%s', encodeURIComponent(query)), where: own.name, query }
  }
  const id = ENGINE_KEYS[key]
  if (!id) return null
  const engine = engineById(id)
  if (!engine.template) return null
  return { url: engine.template.replace('%s', encodeURIComponent(query)), where: engine.name, query }
}

export function searchUrl(query: string, settings: Pick<Settings, 'searchEngine' | 'customSearchUrl'>) {
  const engine = engineById(settings.searchEngine)
  const template =
    engine.id === 'custom' && /^https:\/\/\S+%s/i.test(settings.customSearchUrl)
      ? settings.customSearchUrl
      : engineById('duckduckgo').template
  return (engine.id === 'custom' ? template : engine.template).replace('%s', encodeURIComponent(query))
}

const SCHEME_OK = /^(https?|file|about|data|blob|nya):/i
const HOSTLIKE =
  /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|\[[0-9a-f:]+\](:\d+)?|[\w-]+(\.[\w-]+)+(:\d+)?)(\/\S*)?$/i

/** Decide whether typed text is a URL or a search query (Safari-style smart field). */
export function normalizeInput(
  raw: string,
  settings: Pick<Settings, 'searchEngine' | 'customSearchUrl' | 'customEngines'>
): string {
  const input = raw.trim()
  if (!input) return 'nya://start'
  if (SCHEME_OK.test(input)) return input
  if (!/\s/.test(input) && HOSTLIKE.test(input)) return 'https://' + input
  // A word in front aims it somewhere else; everything else goes to the
  // engine this browser is set to.
  const elsewhere = aimed(input, settings)
  if (elsewhere) return elsewhere.url
  return searchUrl(input, settings)
}
