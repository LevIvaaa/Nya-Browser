import { createHmac } from 'crypto'

/**
 * The six digits an authenticator app would show.
 *
 * A one-time code is not a secret of a different kind — it is the same shared
 * string every authenticator holds, and the code is a function of it and the
 * clock. Keeping it beside the password is a real trade: one stolen vault
 * gives up both factors. It is offered anyway, because the alternative people
 * actually choose is a screenshot of the QR code in their gallery.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Base32 as authenticator apps write it: no padding, spaces and case ignored. */
export function fromBase32(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (!clean || /[^A-Z2-7]/.test(clean)) return null
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return out.length > 0 ? Buffer.from(out) : null
}

/**
 * Accepts either the bare secret or the whole otpauth:// line an app offers,
 * because people paste whichever one the site gave them.
 */
export function secretOf(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^otpauth:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      const secret = url.searchParams.get('secret')
      return secret && fromBase32(secret) ? secret : null
    } catch {
      return null
    }
  }
  return fromBase32(text) ? text : null
}

export interface Code {
  digits: string
  /** seconds left on this one */
  left: number
}

/** The code for right now, and how long it has. */
export function codeFor(secret: string, when = Date.now()): Code | null {
  const key = fromBase32(secret)
  if (!key) return null
  const step = 30
  const counter = Math.floor(when / 1000 / step)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buffer.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return {
    digits: String(binary % 1_000_000).padStart(6, '0'),
    left: step - Math.floor((when / 1000) % step)
  }
}
