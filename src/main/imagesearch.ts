/**
 * Поиск по картинке: отправляет снимок области в поисковик.
 *
 * Обычный «найти по картинке» умеет только то, что уже лежит на странице
 * отдельным изображением, и ищет его целиком. А искать чаще надо вещь на
 * картинке — товар в углу витрины, здание за спиной, шрифт на вывеске.
 * Поэтому здесь отправляется кусок, который человек обвёл сам.
 *
 * Приёмники загрузки у поисковиков не описаны нигде и меняются без
 * предупреждения. Поэтому у каждого способа есть запасной ход, и он не
 * «ничего не произошло»: картинка кладётся в буфер, открывается страница
 * поиска по изображению, и человеку говорят, что осталось нажать вставку.
 * Так функция не может сломаться молча.
 */
import { net, clipboard, nativeImage } from 'electron'
import type { SearchEngineId } from '../shared/types'

/** Куда отправлять и что открывать, если отправить не вышло. */
type Uploader = {
  /** Отправляет картинку и возвращает адрес страницы с результатами. */
  upload(png: Buffer): Promise<string | null>
  /** Страница поиска по изображению — туда же ведёт запасной ход. */
  page: string
  name: string
}

/** Тело multipart-запроса с одним файлом. */
function multipart(field: string, png: Buffer, filename = 'area.png') {
  const boundary = '----nya' + Math.random().toString(36).slice(2)
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      'Content-Type: image/png\r\n\r\n',
    'utf8'
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return { body: Buffer.concat([head, png, tail]), boundary }
}

/**
 * Google Lens. Приёмник отвечает перенаправлением на страницу результатов,
 * поэтому перенаправление не проходим, а читаем.
 */
const lens: Uploader = {
  name: 'Google Lens',
  page: 'https://lens.google.com/',
  async upload(png) {
    const { body, boundary } = multipart('encoded_image', png)
    const response = await net.fetch('https://lens.google.com/v3/upload?stcs=' + Date.now(), {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      redirect: 'manual'
    })
    const to = response.headers.get('location')
    if (to && /^https?:/i.test(to)) return to
    // Иногда приёмник отвечает страницей, а адрес результатов лежит в ней.
    if (response.ok) {
      const html = await response.text()
      const found = html.match(/https:\/\/lens\.google\.com\/[^"'\s<>]+/)
      if (found) return found[0].replace(/&amp;/g, '&')
    }
    return null
  }
}

/** Яндекс. Тот же приём: файл в upfile, адрес — в перенаправлении. */
const yandex: Uploader = {
  name: 'Яндекс',
  page: 'https://yandex.ru/images/',
  async upload(png) {
    const { body, boundary } = multipart('upfile', png)
    const response = await net.fetch(
      'https://yandex.ru/images/search?rpt=imageview&format=json&request=' +
        encodeURIComponent('{"blocks":[{"block":"b-page_type_search-by-image__link"}]}'),
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      }
    )
    if (!response.ok) return null
    const data = (await response.json()) as { blocks?: { html?: string }[] }
    const html = data.blocks?.[0]?.html ?? ''
    const found = html.match(/\/images\/search\?[^"'\s<>]+/)
    return found ? 'https://yandex.ru' + found[0].replace(/&amp;/g, '&') : null
  }
}

/** Bing. */
const bing: Uploader = {
  name: 'Bing',
  page: 'https://www.bing.com/images',
  async upload(png) {
    const { body, boundary } = multipart('imageBin', png)
    const response = await net.fetch('https://www.bing.com/images/search?view=detailv2&iss=sbiupload', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      redirect: 'manual'
    })
    const to = response.headers.get('location')
    if (to) return to.startsWith('http') ? to : 'https://www.bing.com' + to
    return null
  }
}

/**
 * Кто ищет по картинке у этого поисковика.
 *
 * DuckDuckGo, Startpage, Mojeek и Ecosia поиска по изображению не имеют
 * вовсе — не «плохо умеют», а не умеют. Для них берём Lens и говорим об этом
 * вслух, чтобы человек не гадал, почему открылся не его поисковик.
 */
export function uploaderFor(engine: SearchEngineId): { how: Uploader; substituted: boolean } {
  switch (engine) {
    case 'yandex':
      return { how: yandex, substituted: false }
    case 'bing':
      return { how: bing, substituted: false }
    case 'google':
      return { how: lens, substituted: false }
    default:
      return { how: lens, substituted: true }
  }
}

export type ImageSearchResult =
  | { ok: true; url: string; substituted: boolean; name: string }
  | { ok: false; url: string; name: string }

/**
 * Ищет по картинке. Возвращает адрес, который надо открыть, и то, удалось ли
 * отправить: при неудаче картинка уже лежит в буфере обмена, а адрес — это
 * страница поиска по изображению, где её остаётся вставить.
 */
export async function searchByImage(
  png: Buffer,
  engine: SearchEngineId
): Promise<ImageSearchResult> {
  const { how, substituted } = uploaderFor(engine)
  try {
    const url = await how.upload(png)
    if (url) return { ok: true, url, substituted, name: how.name }
  } catch {
    /* сеть или изменившийся приёмник — идём запасным ходом */
  }
  clipboard.writeImage(nativeImage.createFromBuffer(png))
  return { ok: false, url: how.page, name: how.name }
}
