/**
 * Working out what encoding a file is in.
 *
 * A .txt or .csv served without a charset is a coin toss, and getting it wrong
 * gives the reader a page of «Ð¿ÑÐ¸Ð²ÐµÑ» — which is the single most common way
 * a browser makes a perfectly good file unreadable. Chromium guesses for HTML
 * and does not for a plain download.
 *
 * Nothing clever here and nothing statistical: a byte-order mark if there is
 * one, the server's own word if it gave one, and otherwise a decode as UTF-8
 * that is checked for the replacement character. If UTF-8 comes back damaged,
 * the file is one of the two eight-bit encodings that actually turn up in the
 * wild for Russian text, and the one that produces more plausible letters wins.
 */

/** The encodings worth trying, in the order they are worth trying. */
export const FALLBACKS = ['windows-1251', 'koi8-r', 'windows-1252'] as const

/** What a byte-order mark says, when there is one. */
export function markedCharset(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return null
}

/** The charset named in a content-type header, if it named one. */
export function declaredCharset(contentType: string): string | null {
  const found = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')
  return found ? found[1].toLowerCase() : null
}

/**
 * How badly a decode went.
 *
 * U+FFFD is what a decoder writes when the bytes were not what it expected,
 * so counting them is counting mistakes. Control characters that no text file
 * contains count too — they are what a Cyrillic byte looks like when read as
 * the wrong eight-bit encoding.
 */
function damage(text: string): number {
  let bad = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '�') bad += 1
    else if (code < 9 || (code > 13 && code < 32)) bad += 1
  }
  return bad
}

/**
 * The encoding a file is most likely in.
 *
 * `declared` is whatever the server said, which is believed when it says
 * anything at all: a server that names its charset is almost never wrong, and
 * second-guessing it breaks the files that are correct.
 */
export function sniffCharset(bytes: Uint8Array, declared = ''): string {
  const marked = markedCharset(bytes)
  if (marked) return marked

  const named = declaredCharset(declared)
  if (named) return named

  // UTF-8 first: it is what almost everything is, and a valid UTF-8 decode is
  // proof rather than a guess — the encoding is self-checking.
  const asUtf8 = new TextDecoder('utf-8').decode(bytes)
  const utf8Damage = damage(asUtf8)
  if (utf8Damage === 0) return 'utf-8'

  let best = 'utf-8'
  let fewest = utf8Damage
  for (const charset of FALLBACKS) {
    try {
      const decoded = new TextDecoder(charset).decode(bytes)
      const bad = damage(decoded)
      if (bad < fewest) {
        fewest = bad
        best = charset
      }
    } catch {
      /* a decoder this runtime does not have is simply not tried */
    }
  }
  return best
}

/** The text of a file, in whatever encoding it turns out to be in. */
export function decodeText(bytes: Uint8Array, declared = ''): string {
  const charset = sniffCharset(bytes, declared)
  try {
    // The mark itself is not text: leaving it in puts an invisible character
    // at the top of every file, which breaks the first JSON parse and the
    // first CSV heading.
    return new TextDecoder(charset, { ignoreBOM: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}
