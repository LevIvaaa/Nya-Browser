// ---------------------------------------------------------------------------
// Whether this browser is well, and what to say when it is not.
//
// Three things live here and they are related by one idea: when something goes
// wrong, the person at the keyboard should be told what and be able to do
// something about it, rather than watching a blank tab.
//
//   · a marker written at start and cleared at a clean exit, so the next run
//     knows the last one did not finish;
//   · a log of the pages that failed, kept in memory, so "it worked yesterday"
//     has an answer;
//   · a check of the network itself, so "why will nothing open" can be told
//     apart from "why will this one site not open".
//
// Nothing here is sent anywhere. The crash report is a file in the profile,
// the log is memory, and the network check reaches the two hosts this browser
// already talks to and nothing else.
// ---------------------------------------------------------------------------

import { app, net } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from './log'
import { t } from './i18n'
import { NET_HINTS, verdictOf } from '../shared/neterrors'
import type { CrashReport, NetworkCheck, PageFailure } from '../shared/types'

/* --------------------------------------------------------- the crash marker */

/**
 * A file that exists only while the browser is running.
 *
 * Written on start, removed on a clean exit. Finding one at start means the
 * last run ended without getting to the end — which is the only honest way to
 * know, because a process that dies does not get to write anything down.
 */
const markerPath = () => join(app.getPath('userData'), 'running.json')

let crashed: CrashReport | null = null

/** Reads the marker from last time and writes a fresh one. */
export function openHealth(version: string) {
  const path = markerPath()
  try {
    if (existsSync(path)) {
      const before = JSON.parse(readFileSync(path, 'utf8')) as Partial<CrashReport>
      crashed = {
        at: Number(before.at) || 0,
        version: String(before.version ?? ''),
        // What was open is the only thing worth keeping: it is what somebody
        // will want back, and it is the one thing they cannot reconstruct.
        tabs: Array.isArray(before.tabs) ? before.tabs.slice(0, 40).map((one) => String(one)) : [],
        reason: String(before.reason ?? '')
      }
      log('health: the last run did not finish')
    }
  } catch {
    crashed = null
  }
  write({ at: Date.now(), version, tabs: [], reason: '' })
}

function write(report: CrashReport) {
  try {
    writeFileSync(markerPath(), JSON.stringify(report), 'utf8')
  } catch (error) {
    log('health: cannot write the marker', String(error))
  }
}

/** Keeps the marker's idea of what is open up to date, cheaply. */
export function noteOpenTabs(urls: string[], version: string) {
  write({ at: Date.now(), version, tabs: urls.slice(0, 40), reason: '' })
}

/** A clean exit: the marker goes, and the next run knows nothing was wrong. */
export function closeHealth() {
  try {
    rmSync(markerPath(), { force: true })
  } catch {
    /* a marker that cannot be removed only causes one wrong warning */
  }
}

/** What the last run left behind, or null when it finished properly. */
export const lastCrash = () => crashed

/** The report is shown once; after that it is answered and gone. */
export function dismissCrash() {
  crashed = null
}

/* ------------------------------------------------------------ page failures */

const failures: PageFailure[] = []
const FAILURES_KEPT = 100

/**
 * A page that would not load.
 *
 * Kept in memory and never written down: it is a list of addresses that
 * failed, which is browsing history by another name, and the answer to "why
 * did this not open" is needed for minutes, not months.
 */
export function noteFailure(one: Omit<PageFailure, 'at'>) {
  failures.unshift({ ...one, at: Date.now() })
  if (failures.length > FAILURES_KEPT) failures.length = FAILURES_KEPT
}

export const pageFailures = () => [...failures]

export function clearFailures() {
  failures.length = 0
}

/* ------------------------------------------------------------ the network */

/**
 * How long to wait before calling a host unreachable.
 *
 * Six seconds rather than four. Measured on a cold start, with the resolver
 * not yet warm: a perfectly good connection answered in five, and the check
 * reported «интернета нет» next to a browser that was loading pages fine.
 * A diagnostic that lies is worse than no diagnostic, and two more seconds of
 * waiting is a price nobody notices.
 */
const PROBE_MS = 6000

const probe = async (url: string): Promise<boolean> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_MS)
  try {
    const response = await net.fetch(url, { method: 'HEAD', signal: controller.signal })
    return response.ok || response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Does a name turn into a number.
 *
 * Chromium's own resolver, not an HTTPS request to a DNS service: asking
 * dns.google over HTTPS was the first version of this, and it was wrong in
 * the exact case it exists for — a machine whose resolver is broken cannot
 * look up `dns.google` either, so the DNS check failed for want of DNS and
 * the answer said nothing about DNS.
 */
const resolves = async (host: string) => {
  try {
    const found = await net.resolveHost(host)
    return (found?.endpoints?.length ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Whether the trouble is this site or the whole connection.
 *
 * Three questions, in the order that narrows things fastest: is there a link
 * at all, does a name resolve, and does anything out there answer. The last
 * asks two hosts and is content with either — one site being slow on a cold
 * connection is not the same as having no internet, and the first version of
 * this said «интернета нет» next to a browser that was loading pages fine.
 *
 * Both hosts are ones this browser already talks to, so the check adds nobody
 * new to the list of people who learn that this machine exists.
 */
export async function checkNetwork(host = ''): Promise<NetworkCheck> {
  const online = net.isOnline()

  const [dns, ddg, wiki] = await Promise.all([
    resolves('example.com'),
    probe('https://duckduckgo.com/'),
    probe('https://www.wikipedia.org/')
  ])
  const internet = ddg || wiki

  let site: boolean | null = null
  if (host) site = await probe(`https://${host}/`)

  return {
    online,
    dns,
    internet,
    site,
    at: Date.now(),
    verdict: verdictOf(online, dns, internet, site)
  }
}

/* ------------------------------------------------ why it would not open */

/** Chromium's number, said in words; empty when there is nothing to add. */
export function reasonFor(code: number): string {
  const hint = NET_HINTS[code]
  return hint ? t(hint) : ''
}
