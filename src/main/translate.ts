// ---------------------------------------------------------------------------
// Translating the page that is open.
//
// The engine has no translator: the one in Chrome is Chrome's, talking to a
// Google service with Chrome's own key. This asks the same public endpoint the
// web translator uses, from the main process rather than from the page — the
// page's own rules about what it may contact have nothing to do with a request
// the reader asked the browser to make, and doing it here keeps the request out
// of the site's sight as well.
//
// What that means, and the browser says so before it starts: the text of the
// page goes to Google. Nothing else does — no address, no cookies, no headers
// of the site's, and nothing is sent until somebody asks for a translation.
// ---------------------------------------------------------------------------

import { net } from 'electron'
import { log } from './log'

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single'

/**
 * Text goes over in one piece with a marker in front of each item, because the
 * service splits what it is given into sentences of its own choosing and hands
 * back a list that lines up with neither the lines nor the items. The markers
 * survive translation, which is what makes it possible to put the answer back
 * into the right places.
 */
const MARK = (index: number) => `@@${index}@@`

/** Whatever the service made of one request, as one string. */
function joinSegments(body: unknown): string {
  if (!Array.isArray(body) || !Array.isArray(body[0])) return ''
  return (body[0] as unknown[])
    .map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
    .join('')
}

/**
 * Translates a batch of separate strings, and returns exactly as many strings
 * as it was given: anything the service did not answer for comes back as it
 * went in, so a half-answered page keeps the half it had.
 */
export async function translateBatch(items: string[], to: string): Promise<string[]> {
  if (items.length === 0) return []
  const query = items.map((text, index) => `${MARK(index)} ${text}`).join('\n')

  let text: string
  try {
    const response = await net.fetch(
      `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams({ q: query }).toString()
      }
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    text = joinSegments(await response.json())
  } catch (error) {
    log('translate', String(error))
    return items
  }
  if (!text) return items

  // Split on the markers rather than on lines: a single item can come back as
  // several sentences, and two items can come back joined.
  const out = [...items]
  const pattern = /@@\s*(\d+)\s*@@/g
  const found: Array<{ index: number; at: number; end: number }> = []
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    found.push({ index: Number(match[1]), at: match.index, end: pattern.lastIndex })
  }
  found.forEach((mark, i) => {
    if (!Number.isInteger(mark.index) || mark.index < 0 || mark.index >= items.length) return
    const stop = i + 1 < found.length ? found[i + 1].at : text.length
    const piece = text.slice(mark.end, stop).trim()
    if (piece) out[mark.index] = piece
  })
  return out
}

/** How much text one request carries, in characters. */
export const TRANSLATE_CHUNK = 1400
