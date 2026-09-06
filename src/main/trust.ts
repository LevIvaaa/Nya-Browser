// ---------------------------------------------------------------------------
// Which certificates this browser accepts beyond the ones Chromium knows.
//
// Two jobs, both answered in one place — the session's certificate verify
// procedure — because that is the only hook that runs before Chromium decides
// a connection has failed.
//
//   1. The roots the browser carries itself (see roots.ts). Chromium has never
//      heard of them, so a site signed by one fails with AUTHORITY_INVALID and
//      the chain is re-checked here instead.
//
//   2. An exception someone made by hand for one host, after being shown what
//      was wrong with it. Those live in memory and die with the process.
//
// What is checked when a chain is re-validated here: the host is one the
// bundled roots are allowed to speak for at all, the name on the leaf matches
// that host, every certificate is inside its validity dates, every signature
// verifies against the certificate above it, and the top of the chain IS one of
// the bundled certificates — compared as raw bytes, not by name.
//
// The first of those is the one that is not ordinary. Trusting a root usually
// means trusting whoever holds it to speak for every name on the internet: a
// certificate it signs for google.com would be as good as Google's own. These
// roots are carried for one reason — Russian sites can no longer be issued for
// by the usual authorities — so they are held to it, and a chain reaching one
// of them opens a .ru address and nothing else. It does not close the door
// completely, since a Russian site could still be spoken for by the authority
// that legitimately signs Russian sites, but it keeps the rest of the web out
// of the bargain.
//
// What is NOT checked, because Chromium is no longer doing it for these:
// revocation, certificate transparency and key usage.
// ---------------------------------------------------------------------------

import { X509Certificate } from 'crypto'
import type { Certificate, Session } from 'electron'
import { BUNDLED_ROOTS, BUNDLED_ROOT_SUFFIXES } from './roots'
import { log } from './log'

/** Return values Electron's verify proc understands. */
const TRUSTED = 0
const CHROMIUM_DECIDES = -3

/**
 * The bundled certificates, parsed once. A PEM that does not match the
 * fingerprint recorded beside it is a different authority than the one this
 * browser meant to carry, and there is no safe way to carry on past that.
 */
const roots = BUNDLED_ROOTS.map((root) => {
  const parsed = new X509Certificate(root.pem)
  const actual = parsed.fingerprint256.toUpperCase()
  if (actual !== root.fingerprint) {
    throw new Error(`bundled root ${root.name} is not the certificate it claims to be`)
  }
  return { ...root, parsed }
})

const sameCertificate = (a: X509Certificate, b: X509Certificate) => a.raw.equals(b.raw)

/**
 * Whether the bundled roots may speak for this host at all. Punycode is
 * compared as punycode: `.рф` arrives here as `.xn--p1ai`, and a host that
 * merely ends in those letters — "notreally.ru.example.com" — is not one of
 * them, which is why the dot is part of the suffix.
 */
export function withinBundledScope(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return BUNDLED_ROOT_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))
}

/** The chain as the server sent it, leaf first. */
function chainOf(certificate: Certificate): X509Certificate[] {
  const chain: X509Certificate[] = []
  let link: Certificate | undefined = certificate
  // A malformed chain could in principle point at itself; twelve is past any
  // real one and keeps a loop from becoming a hang.
  while (link && chain.length < 12) {
    try {
      chain.push(new X509Certificate(link.data))
    } catch {
      return []
    }
    link = link.issuerCert
  }
  return chain
}

const withinDates = (cert: X509Certificate, now: number) =>
  Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo)

/**
 * Whether this chain really reaches a certificate this browser carries. Every
 * step is checked; nothing is taken on the word of the name in the issuer
 * field, which anybody can write.
 */
export function reachesBundledRoot(hostname: string, certificate: Certificate): boolean {
  if (!withinBundledScope(hostname)) return false
  const chain = chainOf(certificate)
  if (chain.length === 0) return false

  const now = Date.now()
  if (!chain.every((cert) => withinDates(cert, now))) return false
  // The name has to be the site you asked for. Without this, a certificate for
  // any one host signed by the root would open every host.
  if (!chain[0].checkHost(hostname)) return false

  for (let i = 0; i + 1 < chain.length; i++) {
    const child = chain[i]
    const parent = chain[i + 1]
    if (!child.checkIssued(parent) || !child.verify(parent.publicKey)) return false
    // The chain may carry the root itself, as Sberbank's does. Reaching a
    // certificate we hold is the end of the walk.
    if (roots.some((root) => sameCertificate(parent, root.parsed))) return true
  }

  // The chain stopped short of a root, which is the ordinary case: the server
  // sent the leaf and an intermediate. The intermediate has to be signed by
  // one of ours.
  const top = chain[chain.length - 1]
  if (roots.some((root) => sameCertificate(top, root.parsed))) return true
  return roots.some((root) => top.checkIssued(root.parsed) && top.verify(root.parsed.publicKey))
}

/* ---------------------------------------------------------------- exceptions */

/**
 * Hosts someone chose to open anyway, and the exact certificate they were
 * shown when they chose. Keyed by host so a different certificate on the same
 * host asks again, and held in memory so the answer lasts one run of the
 * browser and no longer.
 */
const exceptions = new Map<string, string>()

/** What went wrong last, per host, so the error page can say what it was. */
export interface RefusedCertificate {
  host: string
  fingerprint: string
  issuer: string
  subject: string
  expires: number
  problem: string
}
const refused = new Map<string, RefusedCertificate>()

export const refusedCertificate = (host: string) => refused.get(host) ?? null

/** Records the choice; the caller reloads. Returns false if nothing was asked. */
export function allowCertificateOnce(host: string): boolean {
  const seen = refused.get(host)
  if (!seen) return false
  exceptions.set(host, seen.fingerprint)
  log('trust: proceeding to', host, 'with', seen.fingerprint.slice(0, 20), 'for this run only')
  return true
}

export function forgetCertificateExceptions() {
  exceptions.clear()
  refused.clear()
}

/* -------------------------------------------------------------------- wiring */

/**
 * Installs the check on a session. Everything Chromium is happy with, and
 * everything it refuses for a reason of its own, is left exactly as it decided:
 * this only ever adds trust for a chain that reaches a bundled root, or for a
 * host someone was shown a warning about and accepted.
 */
export function installCertificateTrust(ses: Session) {
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) return callback(CHROMIUM_DECIDES)

    const host = request.hostname
    if (reachesBundledRoot(host, request.certificate)) return callback(TRUSTED)

    if (exceptions.get(host) === request.certificate.fingerprint) return callback(TRUSTED)

    // Remember what was refused so the page that follows can describe it.
    refused.set(host, {
      host,
      fingerprint: request.certificate.fingerprint,
      issuer: request.certificate.issuerName || request.certificate.issuer?.commonName || '',
      subject: request.certificate.subjectName || request.certificate.subject?.commonName || '',
      expires: request.certificate.validExpiry * 1000,
      problem: request.verificationResult
    })
    callback(CHROMIUM_DECIDES)
  })
}

/** The names of what the browser carries, for the settings page to list. */
export const bundledRootNames = () => roots.map((root) => root.name)
