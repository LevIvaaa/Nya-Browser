// ---------------------------------------------------------------------------
// What one site is allowed to do, as opposed to what sites are allowed to do.
//
// The permission settings were global: the camera was on or off everywhere. The
// question people actually have is narrower — this site may use the microphone,
// the rest may not — and there was no way to say it. This holds the exceptions;
// everything not written here falls through to the global answer.
//
// Keyed by host, exactly as the address bar shows it (www. stripped). A
// subdomain is its own entry: an exception is a decision about a place, and
// mail.example.com is not the place accounts.example.com is.
// ---------------------------------------------------------------------------

import { JsonStore, track } from './store'
import type { PermissionKey, PermissionPolicy, PrintOptions, SiteRules } from '../shared/types'

const VERSION = 1

interface SitesFile {
  sites: Record<string, SiteRules>
}

const empty = (): SitesFile => ({ sites: {} })

const POLICIES: PermissionPolicy[] = ['allow', 'ask', 'block']

/** Anything not one of ours is dropped rather than trusted. */
function cleanRules(input: unknown): SiteRules {
  const raw = (input ?? {}) as Partial<SiteRules>
  const permissions: Partial<Record<PermissionKey, PermissionPolicy>> = {}
  for (const [key, value] of Object.entries(raw.permissions ?? {})) {
    if (POLICIES.includes(value as PermissionPolicy)) {
      permissions[key as PermissionKey] = value as PermissionPolicy
    }
  }
  const rules: SiteRules = { permissions }
  if (typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)) {
    rules.zoom = Math.max(-3, Math.min(4, raw.zoom))
  }
  if (raw.blocking === 'off') rules.blocking = 'off'
  if (raw.trusted === true) rules.trusted = true
  if (raw.print && typeof raw.print === 'object') rules.print = cleanPrint(raw.print as Partial<PrintOptions>)
  if (raw.strict === true) rules.strict = true
  if (typeof raw.container === 'string') {
    const id = raw.container.replace(/[^a-z0-9-]/gi, '').slice(0, 32)
    if (id) rules.container = id
  }
  const grantedAt = raw.grantedAt as Record<string, unknown> | undefined
  if (grantedAt && typeof grantedAt === 'object') {
    const kept: NonNullable<SiteRules['grantedAt']> = {}
    for (const [key, value] of Object.entries(grantedAt)) {
      const at = Number(value)
      if (Number.isFinite(at) && at > 0) kept[key as PermissionKey] = at
    }
    if (Object.keys(kept).length > 0) rules.grantedAt = kept
  }
  // Permissions given until a moment rather than for ever. One that has run
  // out is simply not kept: an expired promise is not a rule.
  const until = raw.until as Record<string, unknown> | undefined
  if (until && typeof until === 'object') {
    const kept: NonNullable<SiteRules['until']> = {}
    for (const [key, value] of Object.entries(until)) {
      const at = Number(value)
      if (Number.isFinite(at) && at > Date.now()) kept[key as PermissionKey] = at
    }
    if (Object.keys(kept).length > 0) rules.until = kept
  }
  if (raw.reader === true) rules.reader = true
  if (raw.translate === 'always' || raw.translate === 'never') rules.translate = raw.translate
  const media = raw.media as Record<string, unknown> | undefined
  if (media && typeof media === 'object') {
    const kept: NonNullable<SiteRules['media']> = {}
    const num = (v: unknown, lo: number, hi: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined
    const rate = num(media.rate, 0.25, 4)
    const ceiling = num(media.ceiling, 0, 1)
    if (rate !== undefined && rate !== 1) kept.rate = rate
    if (ceiling !== undefined && ceiling < 1) kept.ceiling = ceiling
    for (const key of ['level', 'voice', 'subtitles', 'skipSilence'] as const) {
      if (media[key] === true) kept[key] = true
    }
    if (Object.keys(kept).length > 0) rules.media = kept
  }
  return rules
}

/**
 * How a site should be printed, as far as it can be trusted.
 *
 * Everything clamped to what the printer will accept: this goes straight into
 * a print call, and a scale of nine thousand is a job that never comes out.
 */
function cleanPrint(raw: Partial<PrintOptions>): PrintOptions {
  const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  return {
    landscape: raw.landscape === true,
    paper: one(raw.paper, ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'] as const, 'A4'),
    margins: one(raw.margins, ['default', 'none', 'narrow'] as const, 'default'),
    scale: Math.max(25, Math.min(200, Math.round(Number(raw.scale) || 100))),
    background: raw.background === true,
    headers: raw.headers === true,
    pages: typeof raw.pages === 'string' ? raw.pages.slice(0, 80) : '',
    copies: Math.max(1, Math.min(50, Math.round(Number(raw.copies) || 1))),
    colour: raw.colour !== false,
    duplex: raw.duplex === true
  }
}

/** True when a rules object says nothing at all and can be forgotten. */
const isEmpty = (rules: SiteRules) =>
  Object.keys(rules.permissions ?? {}).length === 0 &&
  rules.zoom === undefined &&
  rules.blocking === undefined &&
  !rules.reader &&
  rules.translate === undefined &&
  rules.media === undefined

export const hostOfSite = (host: string) => host.toLowerCase().replace(/^www\./, '')

class Sites {
  private store = track(
    new JsonStore<SitesFile>('sites.json', empty, VERSION, (data) => data as Partial<SitesFile>, (data) => ({
      sites: Object.fromEntries(
        Object.entries((data?.sites ?? {}) as Record<string, unknown>)
          .slice(0, 5000)
          .map(([host, rules]) => [hostOfSite(host), cleanRules(rules)])
          .filter(([, rules]) => !isEmpty(rules as SiteRules))
      )
    }))
  )

  load(dir: string) {
    this.store.open(dir)
  }

  /** What is written down for a host, or nothing. */
  get(host: string): SiteRules {
    return this.store.get().sites[hostOfSite(host)] ?? { permissions: {} }
  }

  /** Every host with something written down, for the settings page. */
  all(): Array<{ host: string; rules: SiteRules }> {
    return Object.entries(this.store.get().sites)
      .map(([host, rules]) => ({ host, rules }))
      .sort((a, b) => a.host.localeCompare(b.host))
  }

  set(host: string, patch: Partial<SiteRules>) {
    const key = hostOfSite(host)
    if (!key) return
    const current = this.get(key)
    const next = cleanRules({
      permissions: { ...current.permissions, ...patch.permissions },
      zoom: patch.zoom === undefined ? current.zoom : patch.zoom,
      blocking: patch.blocking === undefined ? current.blocking : patch.blocking,
      reader: patch.reader === undefined ? current.reader : patch.reader,
      translate: patch.translate === undefined ? current.translate : patch.translate,
      media: patch.media === undefined ? current.media : { ...current.media, ...patch.media },
      trusted: patch.trusted === undefined ? current.trusted : patch.trusted,
      print: patch.print === undefined ? current.print : patch.print,
      strict: patch.strict === undefined ? current.strict : patch.strict,
      container: patch.container === undefined ? current.container : patch.container,
      until: patch.until === undefined ? current.until : { ...current.until, ...patch.until },
      grantedAt:
        patch.grantedAt === undefined ? current.grantedAt : { ...current.grantedAt, ...patch.grantedAt }
    })
    // An exception that says nothing is not kept: the list is meant to be a
    // list of decisions, not of hosts that were once visited.
    const sites = { ...this.store.get().sites }
    if (isEmpty(next)) delete sites[key]
    else sites[key] = next
    this.store.set({ sites })
    this.store.flush()
  }

  /** Removes one permission's exception, letting the global answer through. */
  clearPermission(host: string, key: PermissionKey) {
    const current = this.get(host)
    const permissions = { ...current.permissions }
    delete permissions[key]
    const sites = { ...this.store.get().sites }
    const next = cleanRules({ ...current, permissions })
    if (isEmpty(next)) delete sites[hostOfSite(host)]
    else sites[hostOfSite(host)] = next
    this.store.set({ sites })
    this.store.flush()
  }

  reset(host: string) {
    const sites = { ...this.store.get().sites }
    delete sites[hostOfSite(host)]
    this.store.set({ sites })
    this.store.flush()
  }
}

export const sites = new Sites()
