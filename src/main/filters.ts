// ---------------------------------------------------------------------------
// Adblock-Plus-syntax filter lists.
//
// The built-in domain list in blocklist.ts stops whole ad networks, but it
// cannot touch an ad served from the same host as the page — which is most of
// what you actually see on YouTube, VK or a news site. That needs real filter
// lists, so this module implements the useful subset of the ABP format:
//
//   network rules   ||host^path$options, |scheme://…, plain substrings,
//                   /regex/, @@ exceptions, $third-party, $domain=, $type
//   cosmetic rules  ##selector and domain##selector, injected as CSS
//
// Rules are bucketed by a token taken from the pattern, so a request only ever
// tests the handful of rules that share a token with its URL instead of all
// ~150 000 of them.
// ---------------------------------------------------------------------------

import { app, net } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { log } from './log'
import type { FilterStatus } from '../shared/types'

export type FilterCategory = 'ad' | 'tracker'

export interface FilterList {
  id: string
  name: string
  url: string
  category: FilterCategory
}

/** Lists chosen to cover the global web plus the Russian-language one. */
export const FILTER_LISTS: FilterList[] = [
  {
    id: 'easylist',
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
    category: 'ad'
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    category: 'tracker'
  },
  {
    id: 'ruadlist',
    name: 'RU AdList',
    url: 'https://easylist-downloads.adblockplus.org/advblock.txt',
    category: 'ad'
  },
  {
    id: 'ubo-filters',
    name: 'uBlock filters',
    url: 'https://ublockorigin.github.io/uAssets/filters/filters.txt',
    category: 'ad'
  },
  {
    id: 'ubo-privacy',
    name: 'uBlock privacy',
    url: 'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
    category: 'tracker'
  }
]

const REFRESH_AFTER = 5 * 24 * 60 * 60 * 1000 // lists change slowly; 5 days is plenty

/* ------------------------------------------------------------------ types */

/** ABP option name (with the short aliases the lists use) → Electron's resourceType. */
const TYPE_MAP: Record<string, string> = {
  script: 'script',
  image: 'image',
  img: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  'object-subrequest': 'object',
  xmlhttprequest: 'xhr',
  xhr: 'xhr',
  subdocument: 'subFrame',
  frame: 'subFrame',
  document: 'mainFrame',
  doc: 'mainFrame',
  font: 'font',
  media: 'media',
  websocket: 'webSocket',
  ping: 'ping',
  beacon: 'ping',
  other: 'other',
  csp_report: 'cspReport'
}

/**
 * Options that place no restriction we need to model, so a rule carrying one is
 * kept as-is. Everything NOT listed here and not a type is a modifier we cannot
 * honour, and such rules are DROPPED.
 *
 * That direction matters: EasyList carries ~3800 `$popup` rules, which restrict
 * a rule to popup windows only. Ignoring the option instead turns each of them
 * into a blanket block of the whole domain — enough to break ordinary sites.
 */
const IGNORABLE = new Set(['all', 'popup', 'popunder', 'reason', 'ipaddress'])

/**
 * Keeping the original filter text costs several megabytes across all lists, so
 * it is only retained when asked for. With it, `engine.explain()` can say which
 * rule broke a page, which is otherwise near-impossible to work out.
 */
export const FILTER_DEBUG = process.env.NYA_FILTER_DEBUG === '1'

/**
 * How a pattern is tested. Almost every filter is either "this host and its
 * subdomains" or "this text appears in the URL", and both answer in tens of
 * nanoseconds. Only the leftovers pay for a regex.
 */
type Matcher =
  | { kind: 'host'; host: string }
  | { kind: 'text'; text: string }
  | { kind: 'regex'; regex: RegExp }

interface NetworkRule {
  /** the filter line this came from; only present when FILTER_DEBUG */
  source?: string
  matcher: Matcher
  exception: boolean
  important: boolean
  category: FilterCategory
  /** undefined = either; true = only third-party; false = only first-party */
  thirdParty?: boolean
  types?: Set<string>
  notTypes?: Set<string>
  domains?: string[]
  notDomains?: string[]
}

/* ------------------------------------------------------------- parsing */

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Only a bare host, optionally with the separator meaning "and then anything". */
const HOST_ONLY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\^$/

/**
 * Turns an ABP pattern into the cheapest test that is still exactly right.
 *   ||host^  → host suffix check. The trailing separator is what makes this
 *              safe: "||host" WITHOUT it also matches "hostile.com", so that
 *              case deliberately falls through to a regex.
 *   plain    → substring check, when there is no wildcard or anchor at all
 *   else     → regex, with ^ meaning "not a letter, digit, _ - . or %"
 */
function compilePattern(pattern: string, matchCase: boolean): Matcher | null {
  try {
    if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
      return { kind: 'regex', regex: new RegExp(pattern.slice(1, -1), matchCase ? '' : 'i') }
    }

    const hostAnchored = pattern.startsWith('||')
    let rest = hostAnchored ? pattern.slice(2) : pattern

    if (!matchCase && hostAnchored && HOST_ONLY.test(rest.toLowerCase())) {
      return { kind: 'host', host: rest.slice(0, -1).toLowerCase() }
    }
    if (!matchCase && !hostAnchored && !/[*^|]/.test(pattern)) {
      return { kind: 'text', text: pattern.toLowerCase() }
    }

    let source = ''
    if (hostAnchored) {
      source += '^[a-z-]+://(?:[^/?#]*\.)?'
    } else if (rest.startsWith('|')) {
      source += '^'
      rest = rest.slice(1)
    }
    const anchorEnd = rest.endsWith('|')
    if (anchorEnd) rest = rest.slice(0, -1)

    for (const char of rest) {
      if (char === '*') source += '.*'
      else if (char === '^') source += '(?:[^a-zA-Z0-9_\-.%]|$)'
      else source += escapeRe(char)
    }
    if (anchorEnd) source += '$'
    return { kind: 'regex', regex: new RegExp(source, matchCase ? '' : 'i') }
  } catch {
    return null
  }
}

/** Authority of a lower-cased URL, without userinfo or port. */
function hostFromUrl(url: string): string {
  const scheme = url.indexOf('://')
  if (scheme < 0) return ''
  const start = scheme + 3
  let end = url.length
  for (let i = start; i < url.length; i++) {
    const c = url.charCodeAt(i)
    if (c === 47 || c === 63 || c === 35) {
      end = i
      break
    }
  }
  let authority = url.slice(start, end)
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = authority.slice(at + 1)
  if (!authority.endsWith(']')) {
    const colon = authority.lastIndexOf(':')
    if (colon > authority.lastIndexOf(']')) authority = authority.slice(0, colon)
  }
  return authority
}

const splitDomains = (value: string) => {
  const include: string[] = []
  const exclude: string[] = []
  for (const raw of value.split('|')) {
    const item = raw.trim().toLowerCase()
    if (!item) continue
    if (item.startsWith('~')) exclude.push(item.slice(1))
    else include.push(item)
  }
  return { include, exclude }
}

interface ParsedRule {
  rule: NetworkRule
  /** every literal in the pattern that a matching URL must also contain */
  tokens: string[]
}

function parseNetworkRule(line: string, category: FilterCategory): ParsedRule | null {
  let text = line
  const exception = text.startsWith('@@')
  if (exception) text = text.slice(2)

  let options = ''
  // A /regex/ body may contain '$', so only a pattern that is NOT one is split
  // at its last '$'. Checking merely for a trailing '/' would also swallow the
  // options of every rule that ends in a slash, such as "…^$removeparam=/x/".
  const isRegexLiteral = text.length > 2 && text.startsWith('/') && text.endsWith('/')
  const dollar = isRegexLiteral ? -1 : text.lastIndexOf('$')
  if (dollar > 0) {
    options = text.slice(dollar + 1)
    text = text.slice(0, dollar)
  }
  if (!text) return null

  const rule: NetworkRule = {
    matcher: { kind: 'text', text: '' },
    exception,
    important: false,
    category
  }
  if (FILTER_DEBUG) rule.source = line
  let matchCase = false
  let isPopupOnly = false

  for (const raw of options ? options.split(',') : []) {
    const negated = raw.startsWith('~')
    if (raw === 'popup' || raw === 'popunder') isPopupOnly = true
    const option = negated ? raw.slice(1) : raw
    const [name, value] = option.includes('=') ? [option.slice(0, option.indexOf('=')), option.slice(option.indexOf('=') + 1)] : [option, '']

    if (name === 'third-party' || name === '3p') rule.thirdParty = !negated
    else if (name === 'first-party' || name === '1p') rule.thirdParty = negated
    else if (name === 'important') rule.important = true
    else if (name === 'match-case') matchCase = true
    else if (name === 'domain' || name === 'from') {
      const { include, exclude } = splitDomains(value)
      if (include.length) rule.domains = include
      if (exclude.length) rule.notDomains = exclude
    } else if (TYPE_MAP[name]) {
      const target = negated ? 'notTypes' : 'types'
      ;(rule[target] ??= new Set())!.add(TYPE_MAP[name])
    } else if (!IGNORABLE.has(name)) {
      // A modifier we do not implement ($popup, $redirect, $csp, $badfilter, …).
      // Keeping the rule without it would apply it far more widely than the
      // list author meant, so the rule goes.
      return null
    }
  }

  // A rule restricted to popups only would, for us, mean "block everywhere".
  if (isPopupOnly) return null

  const matcher = compilePattern(text, matchCase)
  if (!matcher) return null
  rule.matcher = matcher
  return { rule, tokens: tokensOf(text) }
}

/**
 * Every literal run in a pattern. A URL that matches the pattern must contain
 * all of them, so the rule can be filed under whichever one is rarest.
 *
 * The argument must be the pattern with its options already stripped — a token
 * taken from "$third-party" would file the rule where no URL can ever find it.
 * An empty result means "test on every request".
 */
function tokensOf(pattern: string): string[] {
  // A /regex/ may alternate, so a literal in it need not appear in a match.
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) return []
  // Drop the leading anchors so "||googleads.g" yields "googleads", not "".
  const found = pattern.replace(/^(\|\|?)/, '').match(TOKEN_RE)
  return found ? [...new Set(found.map((token) => token.toLowerCase()))] : []
}

/**
 * Three characters is the shortest run worth indexing: it catches the many
 * "/ads/" and "&ad=" style filters that would otherwise have to be tested on
 * every single request.
 */
const TOKEN_RE = /[a-z0-9]{3,}/gi

/** Caller passes an already lower-cased URL; matching is case-insensitive. */
const tokensOfUrl = (lowerUrl: string) => lowerUrl.match(TOKEN_RE) ?? []

/* ------------------------------------------------------------- cosmetic */

interface CosmeticRules {
  /** class name → generic selectors that can only match if the page uses it */
  byClass: Map<string, string[]>
  /** element id → likewise */
  byId: Map<string, string[]>
  /** generic selectors with no class or id to key on, e.g. iframe[src*="ads"] */
  always: string[]
  /** hostname → selectors that apply only there */
  byDomain: Map<string, string[]>
  /** hostname → selectors explicitly un-hidden there (#@#) */
  exceptions: Map<string, Set<string>>
}

/**
 * The class or id a selector cannot match without. Bracketed sections are
 * removed first so that a[href="#x"] does not look like an id anchor.
 */
function anchorOf(selector: string): { kind: 'class' | 'id'; name: string } | null {
  const bare = selector.replace(/\[[^\]]*\]/g, '')
  const found = /([.#])([A-Za-z_][\w-]*)/.exec(bare)
  if (!found) return null
  return { kind: found[1] === '.' ? 'class' : 'id', name: found[2] }
}

/* --------------------------------------------------------------- engine */

class FilterEngine {
  /**
   * "||host^" rules — the large majority — filed under the host itself. A
   * request looks up its own host and each parent domain, so these cost a
   * couple of Map hits instead of a scan.
   */
  private hostIndex = new Map<string, NetworkRule[]>()
  private buckets = new Map<string, NetworkRule[]>()
  private generic: NetworkRule[] = []
  /** Rules held until finish(), when token frequencies across all lists are known. */
  private pending: ParsedRule[] = []
  private tokenCounts = new Map<string, number>()
  private cosmetic: CosmeticRules = {
    byClass: new Map(),
    byId: new Map(),
    always: [],
    byDomain: new Map(),
    exceptions: new Map()
  }

  ruleCount = 0
  cosmeticCount = 0
  ready = false

  clear() {
    this.hostIndex.clear()
    this.pending = []
    this.tokenCounts.clear()
    this.buckets.clear()
    this.generic = []
    this.cosmetic = {
      byClass: new Map(),
      byId: new Map(),
      always: [],
      byDomain: new Map(),
      exceptions: new Map()
    }
    this.ruleCount = 0
    this.cosmeticCount = 0
    this.ready = false
  }

  /** Parses one downloaded list into the engine. */
  ingest(text: string, category: FilterCategory) {
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('!') || line.startsWith('[')) continue

      // ---- cosmetic ----
      const cosmetic = line.match(/^(.*?)(#@?#|#\?#)(.+)$/)
      if (cosmetic) {
        const [, scope, marker, selector] = cosmetic
        // Procedural selectors (:has-text, :matches-css, …) need uBO's own
        // engine; :has() is native so it is kept.
        if (/:-abp-|:matches-|:has-text|:xpath|:upward|:watch-attr|:style/.test(selector)) continue
        const domains = scope ? scope.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : []

        if (marker === '#@#') {
          for (const domain of domains) {
            const set = this.cosmetic.exceptions.get(domain) ?? new Set()
            set.add(selector)
            this.cosmetic.exceptions.set(domain, set)
          }
          continue
        }
        if (domains.length === 0) {
          const anchor = anchorOf(selector)
          if (!anchor) {
            this.cosmetic.always.push(selector)
          } else {
            const index = anchor.kind === 'class' ? this.cosmetic.byClass : this.cosmetic.byId
            const list = index.get(anchor.name) ?? []
            list.push(selector)
            index.set(anchor.name, list)
          }
        } else {
          for (const domain of domains) {
            if (domain.startsWith('~')) continue // negated scopes are rare; skip rather than mis-hide
            const list = this.cosmetic.byDomain.get(domain) ?? []
            list.push(selector)
            this.cosmetic.byDomain.set(domain, list)
          }
        }
        this.cosmeticCount++
        continue
      }

      // ---- network ----
      if (line.includes('##') || line.includes('#@#')) continue
      const parsed = parseNetworkRule(line, category)
      if (!parsed) continue

      if (parsed.rule.matcher.kind === 'host') {
        const host = parsed.rule.matcher.host
        const bucket = this.hostIndex.get(host) ?? []
        bucket.push(parsed.rule)
        this.hostIndex.set(host, bucket)
      } else {
        // Filing waits for finish(): picking a bucket needs to know how common
        // each token is across every list, not just this one.
        this.pending.push(parsed)
        for (const token of parsed.tokens) {
          this.tokenCounts.set(token, (this.tokenCounts.get(token) ?? 0) + 1)
        }
      }
      this.ruleCount++
    }
  }

  finish() {
    // File every remaining rule under its RAREST token. Filing under the
    // longest instead piles hundreds of rules onto words like "analytics",
    // which then all get tested whenever such a word appears in a URL.
    for (const parsed of this.pending) {
      let best = ''
      let bestCount = Infinity
      for (const token of parsed.tokens) {
        const count = this.tokenCounts.get(token) ?? 0
        if (count < bestCount || (count === bestCount && token.length > best.length)) {
          best = token
          bestCount = count
        }
      }
      if (best) {
        const bucket = this.buckets.get(best) ?? []
        bucket.push(parsed.rule)
        this.buckets.set(best, bucket)
      } else {
        this.generic.push(parsed.rule)
      }
    }
    this.pending = []
    this.tokenCounts.clear()

    this.ready = this.ruleCount > 0 || this.cosmeticCount > 0
  }

  /**
   * Whether the request should be blocked, and under which heading to count it.
   * `documentHost` is the page the request belongs to, used for $third-party
   * and $domain=.
   */
  match(url: string, documentHost: string, resourceType: string): FilterCategory | null {
    if (!this.ready) return null

    // Lower-cased and host-parsed once per request, not once per rule.
    const lower = url.toLowerCase()
    const host = hostFromUrl(lower)
    const from = documentHost.toLowerCase()

    // Precedence is fixed by the format, not by the order rules appear in:
    // @@$important > $important > @@ > plain block.
    let block: FilterCategory | null = null
    let importantBlock: FilterCategory | null = null
    let excepted = false
    let importantException = false

    const scan = (bucket: readonly NetworkRule[]) => {
      for (const rule of bucket) {
        if (!this.applies(rule, lower, host, from, resourceType)) continue
        if (rule.exception) {
          if (rule.important) importantException = true
          else excepted = true
        } else if (rule.important) importantBlock ??= rule.category
        else block ??= rule.category
      }
    }

    // Buckets are scanned in place: the vast majority of requests touch only a
    // few hundred rules out of ~120 000, and nothing is allocated to do it.
    for (let name = host; name.includes('.'); name = name.slice(name.indexOf('.') + 1)) {
      const bucket = this.hostIndex.get(name)
      if (bucket) scan(bucket)
    }
    for (const token of tokensOfUrl(lower)) {
      const bucket = this.buckets.get(token)
      if (bucket) scan(bucket)
    }
    scan(this.generic)

    if (importantException) return null
    if (importantBlock) return importantBlock
    return excepted ? null : block
  }

  /**
   * `url` must be lower-cased and `host` its authority — both are computed once
   * per request by the caller. Conditions are ordered cheapest-first, with the
   * pattern test up front because it is by far the most selective.
   */
  private applies(
    rule: NetworkRule,
    url: string,
    host: string,
    documentHost: string,
    resourceType: string
  ): boolean {
    if (rule.types && !rule.types.has(resourceType)) return false
    if (rule.notTypes?.has(resourceType)) return false

    const matcher = rule.matcher
    if (matcher.kind === 'host') {
      if (!hostMatches(host, matcher.host)) return false
    } else if (matcher.kind === 'text') {
      if (!url.includes(matcher.text)) return false
    } else if (!matcher.regex.test(url)) return false

    if (rule.thirdParty !== undefined) {
      const third = !!documentHost && !sameParty(host, documentHost)
      if (third !== rule.thirdParty) return false
    }
    if (rule.domains && !rule.domains.some((d) => hostMatches(documentHost, d))) return false
    if (rule.notDomains?.some((d) => hostMatches(documentHost, d))) return false

    return true
  }

  /**
   * Every rule that matches, in precedence order — the answer to "why did this
   * request get blocked?". Needs NYA_FILTER_DEBUG=1 to show the filter text.
   */
  explain(url: string, documentHost: string, resourceType: string): string[] {
    const lower = url.toLowerCase()
    const host = hostFromUrl(lower)
    const from = documentHost.toLowerCase()
    const out: string[] = []
    const scan = (bucket: readonly NetworkRule[]) => {
      for (const rule of bucket) {
        if (!this.applies(rule, lower, host, from, resourceType)) continue
        const tag = `${rule.exception ? '@@' : ''}${rule.important ? '!' : ''}${rule.category}`
        out.push(`${tag} ${rule.source ?? describe(rule.matcher)}`)
      }
    }
    for (let name = host; name.includes('.'); name = name.slice(name.indexOf('.') + 1)) {
      const bucket = this.hostIndex.get(name)
      if (bucket) scan(bucket)
    }
    for (const token of tokensOfUrl(lower)) {
      const bucket = this.buckets.get(token)
      if (bucket) scan(bucket)
    }
    scan(this.generic)
    return out
  }

  /** Bucket sizes, for checking that no single token became a hot spot. */
  stats() {
    const sizes = [...this.buckets.entries()].map(([token, rules]) => ({ token, size: rules.length }))
    sizes.sort((a, b) => b.size - a.size)
    let hostRules = 0
    for (const rules of this.hostIndex.values()) hostRules += rules.length
    return {
      hosts: this.hostIndex.size,
      hostRules,
      buckets: this.buckets.size,
      generic: this.generic.length,
      biggest: sizes.slice(0, 12)
    }
  }

  /**
   * Selectors to hide on one page: the rules written for this hostname, plus
   * the generic ones whose class or id the page actually contains.
   *
   * Injecting all 14 000 generic selectors instead would mean ~225 KB of CSS
   * that the engine has to match against every element of every page. Passing
   * in what the document really uses cuts that to a handful.
   */
  cosmeticSelectors(hostname: string, classes: readonly string[], ids: readonly string[]): string[] {
    const excluded = new Set<string>()
    const out = new Set<string>()

    for (const domain of parentDomains(hostname)) {
      for (const selector of this.cosmetic.exceptions.get(domain) ?? []) excluded.add(selector)
    }
    const take = (selectors: readonly string[] | undefined) => {
      for (const selector of selectors ?? []) if (!excluded.has(selector)) out.add(selector)
    }

    for (const domain of parentDomains(hostname)) take(this.cosmetic.byDomain.get(domain))
    for (const name of classes) take(this.cosmetic.byClass.get(name))
    for (const name of ids) take(this.cosmetic.byId.get(name))
    take(this.cosmetic.always)

    return [...out]
  }
}

/** Chunked so one malformed selector cannot take the whole stylesheet down. */
export function hideCss(selectors: readonly string[]): string {
  const out: string[] = []
  for (let i = 0; i < selectors.length; i += 400) {
    out.push(`${selectors.slice(i, i + 400).join(',')}{display:none!important}`)
  }
  return out.join('\n')
}

/**
 * example.com matches example.com and www.example.com, but not notexample.com.
 * Written without building a "." + domain string, because this runs for every
 * candidate rule of every request.
 */
function hostMatches(host: string, domain: string): boolean {
  if (host === domain) return true
  const cut = host.length - domain.length
  return cut > 0 && host.charCodeAt(cut - 1) === 46 /* . */ && host.endsWith(domain)
}

/** Readable form of a matcher, for explain() when the filter text was not kept. */
const describe = (matcher: Matcher): string =>
  matcher.kind === 'host' ? `||${matcher.host}^` : matcher.kind === 'text' ? matcher.text : matcher.regex.source

function parentDomains(hostname: string): string[] {
  const parts = hostname.split('.')
  const out: string[] = []
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.'))
  return out
}

/** Cheap same-site test; the exact registrable domain is overkill here. */
function sameParty(a: string, b: string): boolean {
  const tail = (host: string) => host.split('.').slice(-2).join('.')
  return tail(a) === tail(b)
}

export const engine = new FilterEngine()

/* ------------------------------------------------------------ downloading */

interface ListMeta {
  updated: number
  bytes: number
}

const cacheDir = () => join(app.getPath('userData'), 'filters')
const cacheFile = (id: string) => join(cacheDir(), `${id}.txt`)
const metaFile = () => join(cacheDir(), 'meta.json')

function readMeta(): Record<string, ListMeta> {
  try {
    return JSON.parse(readFileSync(metaFile(), 'utf8')) as Record<string, ListMeta>
  } catch {
    return {}
  }
}

function writeMeta(meta: Record<string, ListMeta>) {
  try {
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(metaFile(), JSON.stringify(meta, null, 2))
  } catch (error) {
    log('filters: cannot write meta', String(error))
  }
}

async function download(list: FilterList): Promise<string | null> {
  try {
    const response = await net.fetch(list.url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    if (text.length < 1024) throw new Error('suspiciously small')
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(cacheFile(list.id), text, 'utf8')
    return text
  } catch (error) {
    log('filters: download failed', list.id, String(error))
    return null
  }
}

let lastStatus: FilterStatus = { enabled: false, rules: 0, cosmetic: 0, updated: 0, lists: [] }
let loading: Promise<FilterStatus> | null = null

export const filterStatus = () => lastStatus

/**
 * Loads every list from cache, downloading the ones that are missing or stale.
 * Concurrent callers share one run.
 */
export function loadFilters(force = false): Promise<FilterStatus> {
  loading ??= run(force).finally(() => {
    loading = null
  })
  return loading
}

async function run(force: boolean): Promise<FilterStatus> {
  const meta = readMeta()
  const now = Date.now()
  engine.clear()

  const entries: FilterStatus['lists'] = []
  for (const list of FILTER_LISTS) {
    const file = cacheFile(list.id)
    const stale = force || !meta[list.id] || now - meta[list.id].updated > REFRESH_AFTER
    let text: string | null = null

    if (!stale && existsSync(file)) {
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        text = null
      }
    }
    if (text === null) {
      text = await download(list)
      if (text !== null) meta[list.id] = { updated: now, bytes: text.length }
      else if (existsSync(file)) {
        // Keep serving the stale copy rather than losing protection entirely.
        try {
          text = readFileSync(file, 'utf8')
        } catch {
          text = null
        }
      }
    }
    if (text === null) continue

    engine.ingest(text, list.category)
    entries.push({
      id: list.id,
      name: list.name,
      bytes: meta[list.id]?.bytes ?? text.length,
      updated: meta[list.id]?.updated ?? 0
    })
  }

  engine.finish()
  writeMeta(meta)

  lastStatus = {
    enabled: engine.ready,
    rules: engine.ruleCount,
    cosmetic: engine.cosmeticCount,
    updated: Math.max(0, ...entries.map((e) => e.updated)),
    lists: entries
  }
  log('filters:', lastStatus.rules, 'network rules,', lastStatus.cosmetic, 'cosmetic rules')
  return lastStatus
}
