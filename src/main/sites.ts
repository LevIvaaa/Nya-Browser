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
import type { PermissionKey, PermissionPolicy, SiteRules } from '../shared/types'

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
  return rules
}

/** True when a rules object says nothing at all and can be forgotten. */
const isEmpty = (rules: SiteRules) =>
  Object.keys(rules.permissions ?? {}).length === 0 &&
  rules.zoom === undefined &&
  rules.blocking === undefined

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
      blocking: patch.blocking === undefined ? current.blocking : patch.blocking
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
