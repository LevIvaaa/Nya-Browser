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
  settings: Pick<Settings, 'searchEngine' | 'customSearchUrl'>
): string {
  const input = raw.trim()
  if (!input) return 'nya://start'
  if (SCHEME_OK.test(input)) return input
  if (!/\s/.test(input) && HOSTLIKE.test(input)) return 'https://' + input
  return searchUrl(input, settings)
}
