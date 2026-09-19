/**
 * Telling a bad address from a good one, on this machine.
 *
 * Every browser that checks for phishing does it by asking a server, which
 * means telling that server every address you visit. Google's Safe Browsing
 * sends a hash prefix and calls it private; it is still a request per site to a
 * company whose business is knowing where people go.
 *
 * This does none of that. Everything here is worked out from the address
 * itself and from the places this profile has already been — no list to
 * download, no server to ask, nothing sent anywhere. That makes it weaker than
 * a real blocklist at catching brand-new campaigns and much stronger at the
 * thing those lists are worst at: the address that looks almost exactly like
 * one you use.
 */

/** What is wrong with an address, in the order a person cares about it. */
export type WarningKind =
  /** letters from another alphabet dressed as Latin ones — раypal.com */
  | 'homograph'
  /** one edit away from a place this profile actually visits */
  | 'lookalike'
  /** a name somebody trusts, used as a subdomain of somewhere else */
  | 'brand-subdomain'
  /** "https://apple.com@evil.example" — the part before the @ is decoration */
  | 'credentials'
  /** a bare address with no name at all */
  | 'raw-ip'
  /** a password box on a page that is not encrypted */
  | 'insecure-form'

export interface Warning {
  kind: WarningKind
  /** the host this is about */
  host: string
  /** what it is pretending to be, when that is known */
  looksLike?: string
}

/* ------------------------------------------------------------- alphabets */

/**
 * Letters that are drawn the same in more than one alphabet.
 *
 * This is the whole trick behind a homograph address: раypal.com with a
 * Cyrillic а and р is a different name to every computer and the same name to
 * every person. Mixing alphabets inside one label is the tell, and it is one
 * that almost never happens by accident in a real domain.
 */
const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', ԁ: 'd',
  ν: 'v', ο: 'o', ρ: 'p', α: 'a', ε: 'e', ι: 'i', κ: 'k', μ: 'm', τ: 't', υ: 'u'
}

const LATIN = /[a-z]/
const CYRILLIC = /[Ѐ-ӿ]/
const GREEK = /[Ͱ-Ͽ]/

/*
 * Punycode, decoded here rather than imported.
 *
 * Every URL parser hands back the ASCII form — xn--pypal-4ve.com — and every
 * person sees the other one. A check that looks at letters has to look at the
 * letters that were shown, so the name is turned back first. Node's own
 * punycode module is deprecated and the browser has none; the algorithm is
 * RFC 3492 and it is thirty lines.
 */
const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128

const adapt = (delta: number, count: number, first: boolean) => {
  let value = first ? Math.floor(delta / DAMP) : delta >> 1
  value += Math.floor(value / count)
  let k = 0
  while (value > ((BASE - T_MIN) * T_MAX) >> 1) {
    value = Math.floor(value / (BASE - T_MIN))
    k += BASE
  }
  return k + Math.floor(((BASE - T_MIN + 1) * value) / (value + SKEW))
}

/** One punycode label, back to the letters it stands for. */
function decodeLabel(input: string): string {
  const mark = input.lastIndexOf('-')
  const basic = mark > 0 ? input.slice(0, mark) : ''
  const rest = mark > 0 ? input.slice(mark + 1) : input
  const output = [...basic].map((one) => one.codePointAt(0) as number)

  let n = INITIAL_N
  let bias = INITIAL_BIAS
  let i = 0
  for (let at = 0; at < rest.length; ) {
    const old = i
    for (let weight = 1, k = BASE; ; k += BASE) {
      if (at >= rest.length) return input
      const code = rest.charCodeAt(at++)
      const digit =
        code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : BASE
      if (digit >= BASE) return input
      i += digit * weight
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias
      if (digit < t) break
      weight *= BASE - t
    }
    bias = adapt(i - old, output.length + 1, old === 0)
    n += Math.floor(i / (output.length + 1))
    i %= output.length + 1
    output.splice(i, 0, n)
    i += 1
  }
  return String.fromCodePoint(...output)
}

/** A host as a person sees it, however the parser handed it over. */
export function unicodeHost(host: string): string {
  if (!host.includes('xn--')) return host
  return host
    .split('.')
    .map((label) => {
      if (!label.startsWith('xn--')) return label
      try {
        return decodeLabel(label.slice(4))
      } catch {
        return label
      }
    })
    .join('.')
}

/** The same name with every look-alike letter turned into what it looks like. */
export function skeleton(host: string): string {
  return [...host.toLowerCase()].map((one) => CONFUSABLE[one] ?? one).join('')
}

/**
 * Two alphabets inside one label of a name.
 *
 * Whole-label Cyrillic is ordinary — почта.рф is a real address and not a
 * trick. What is never ordinary is Latin and Cyrillic in the same word, and
 * that is exactly what a dressed-up address needs to do.
 */
export function mixedScript(host: string): boolean {
  for (const label of host.toLowerCase().split('.')) {
    const scripts = [LATIN.test(label), CYRILLIC.test(label), GREEK.test(label)].filter(Boolean)
    if (scripts.length > 1) return true
  }
  return false
}

/* ------------------------------------------------------------- distance */

/**
 * How many single-character edits turn one name into the other, counting no
 * further than `most` — past that the answer does not matter and the work is
 * wasted.
 */
export function editDistance(a: string, b: string, most = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > most) return most + 1
  let previous = Array.from({ length: b.length + 1 }, (_one, at) => at)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost)
      best = Math.min(best, row[j])
    }
    if (best > most) return most + 1
    previous = row
  }
  return previous[b.length]
}

/* ----------------------------------------------------------------- names */

/**
 * The names people are impersonated as most often.
 *
 * Not a blocklist — the opposite. These are the names worth protecting, and
 * the check is whether an address is pretending to be one of them. It is
 * short on purpose: a long list would start finding "lookalikes" everywhere.
 */
export const GUARDED = [
  'google.com', 'gmail.com', 'youtube.com', 'facebook.com', 'instagram.com',
  'whatsapp.com', 'apple.com', 'icloud.com', 'microsoft.com', 'outlook.com',
  'live.com', 'office.com', 'amazon.com', 'paypal.com', 'netflix.com',
  'github.com', 'gitlab.com', 'dropbox.com', 'telegram.org', 'x.com',
  'twitter.com', 'linkedin.com', 'binance.com', 'coinbase.com', 'steampowered.com',
  'discord.com', 'reddit.com', 'wikipedia.org', 'vk.com', 'yandex.ru',
  'mail.ru', 'ozon.ru', 'wildberries.ru', 'sberbank.ru', 'gosuslugi.ru',
  'tinkoff.ru', 'alfabank.ru', 'avito.ru'
]

/** The name without the last piece: paypal.com → paypal. */
const stem = (host: string) => host.split('.').slice(0, -1).join('.')

/**
 * Endings that are really two labels, so the registered name is the third.
 *
 * Short and incomplete on purpose: the full public suffix list is a megabyte
 * that changes weekly, and getting this slightly wrong costs a warning that
 * says "co.uk" instead of "shop.co.uk" — not a missed attack.
 */
const TWO_PART = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'co.jp', 'com.br', 'com.cn', 'com.tr', 'co.in', 'co.kr', 'com.mx',
  'com.ar', 'co.za', 'com.ua', 'com.pl', 'com.sg', 'com.hk', 'com.tw', 'co.il'
])

/**
 * The part of a name that was actually registered.
 *
 * "ww547.gihub.com" is gihub.com with a subdomain in front, and a typosquat
 * that bounces you to its own subdomain is the commonest shape there is — so
 * the comparison has to be made against this rather than the whole name.
 */
export function registrable(host: string): string {
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const lastTwo = labels.slice(-2).join('.')
  return TWO_PART.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:]+\]$/i

/**
 * Everything wrong with one address.
 *
 * `known` is the hosts this profile actually visits — the strongest signal
 * there is, because the address somebody is being fooled by is a near-miss of
 * a place they already go. It is never sent anywhere; it is read here and
 * forgotten.
 */
export function inspect(url: string, known: readonly string[] = []): Warning[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return []

  // What a person saw, not what the parser stored: every URL parser turns an
  // international name into punycode, and letters are the whole question here.
  const host = unicodeHost(parsed.hostname).replace(/^www\./, '').toLowerCase()
  const out: Warning[] = []

  // A name before the @ is not the destination, and looks exactly like one.
  if (parsed.username || parsed.password) {
    out.push({ kind: 'credentials', host })
  }

  if (IP_HOST.test(parsed.hostname)) {
    out.push({ kind: 'raw-ip', host })
    // Nothing below applies: an address with no name cannot look like one.
    return out
  }

  // Letters from another alphabet dressed as Latin ones.
  if (mixedScript(host)) {
    const plain = skeleton(host)
    const pretending = [...GUARDED, ...known].find((one) => one === plain || stem(one) === stem(plain))
    out.push({ kind: 'homograph', host, looksLike: pretending })
  }

  /*
   * A guarded name used as a subdomain of somewhere else.
   *
   * "paypal.com.account-check.example" reads left to right as PayPal and is
   * account-check.example. Every real phishing campaign uses this, and no
   * honest site needs it.
   */
  const labels = host.split('.')
  for (const name of GUARDED) {
    const first = name.split('.')[0]
    // Only labels before the last two count: the last two are the real site.
    if (labels.slice(0, -2).includes(first) || labels.slice(0, -2).includes(name)) {
      out.push({ kind: 'brand-subdomain', host, looksLike: name })
      break
    }
  }

  /*
   * One edit away from somewhere this profile goes.
   *
   * Both the guarded names and the profile's own hosts, because the second is
   * what catches the address aimed at one particular person: a bank they use,
   * a company intranet, a school.
   */
  const plain = skeleton(host)
  if (!out.some((one) => one.kind === 'homograph')) {
    // Compared on the registered part of each name: a subdomain in front is
    // decoration, and putting one there is how a typosquat hides.
    const base = registrable(plain)
    const near = (name: string) =>
      name.length >= 6 && editDistance(stem(base), stem(registrable(name)), 1) === 1

    /*
     * A famous name, missed by one letter.
     *
     * This is checked before anything else and cannot be called off by the
     * history: somebody who has been to a fake bank three times is exactly
     * the person the warning is for, and a check that fell silent after the
     * third visit would fall silent precisely when it started to matter.
     */
    const famous = GUARDED.find((name) => name === plain || name === base)
    if (!famous) {
      const pretending = GUARDED.find(near)
      if (pretending) {
        out.push({ kind: 'lookalike', host, looksLike: pretending })
        return out
      }
    }

    // Somewhere this profile actually goes, missed by one letter. Here the
    // history does vouch for a name: if it IS one of them, it is that place.
    if (known.some((name) => name === plain || name === base) || famous) return out
    const like = known.find(near)
    if (like) out.push({ kind: 'lookalike', host, looksLike: like })
  }

  return out
}

/** One line for a person, in the language the browser is already speaking. */
export const WARNING_TEXT: Record<WarningKind, string> = {
  homograph: 'В адресе буквы из другого алфавита — он выглядит как знакомый, но ведёт не туда',
  lookalike: 'Адрес отличается от знакомого на один символ',
  'brand-subdomain': 'Знакомое имя стоит в адресе как приставка — сайт другой',
  credentials: 'В адресе есть имя перед @ — настоящий адрес идёт после него',
  'raw-ip': 'Адрес без имени, просто числа',
  'insecure-form': 'Пароль на этой странице уйдёт незашифрованным'
}
