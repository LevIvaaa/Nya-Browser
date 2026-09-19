// Telling apart «the internet is down» from «this one site is down», and
// saying what a Chromium error number means — run with `npm test`.
//
// Both are small, and both are the sort of thing that is easy to get subtly
// wrong in a way nobody notices until somebody reboots a router because one
// server was busy. Every combination of the four answers has exactly one right
// verdict, and it is written down here rather than left in a chain of nested
// conditionals that reads the same either way round.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-health-')), 'neterrors.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'shared', 'neterrors.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error'
})

const { NET_HINTS, verdictOf } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed += 1
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------------------- the verdict */

// No link at all. Whatever the probes say — and on a machine with no network
// they say nothing at all — this is the only honest answer.
check('no link is offline', verdictOf(false, false, false, null), 'offline')
check('no link, even with a site that answered', verdictOf(false, true, true, true), 'offline')

// A link, but nothing gets past it. Blaming DNS here would be blaming the
// symptom: a lookup cannot succeed when no packet leaves the machine.
check('nothing got out at all', verdictOf(true, false, false, null), 'no-internet')
check('and the site failed too', verdictOf(true, false, false, false), 'no-internet')

// Something got out, but names do not turn into numbers. This is the case
// that used to be reported as «no internet», and it is the one where the
// advice — try another DNS server — actually helps.
check('something got out but names did not resolve', verdictOf(true, false, true, null), 'no-dns')
check('a site that answered does not excuse dead DNS', verdictOf(true, false, true, true), 'no-dns')

// Everything of ours works; theirs does not.
check('only the site is down', verdictOf(true, true, true, false), 'site-down')

// Nothing found. The page is at fault, which the error page then says.
check('all well, no site asked about', verdictOf(true, true, true, null), 'fine')
check('all well, site answered', verdictOf(true, true, true, true), 'fine')

// DNS working while nothing else does is a combination the probes can produce
// (a cached answer, a resolver on the local network): names resolve, so it is
// not a DNS fault, and the site itself was never asked.
check('names resolve but nothing else answers', verdictOf(true, true, false, null), 'fine')
check('names resolve, the site does not', verdictOf(true, true, false, false), 'site-down')

/* --------------------------------------------------------------- the hints */

// Every hint must be a string somebody could act on, and — the point of the
// shared table — one the dictionaries already know, so no error page falls
// back to Russian in a browser set to Japanese.
const en = JSON.parse(
  readFileSync(join(here, '..', 'src', 'shared', 'locales', 'en.json'), 'utf8')
)
const missing = [...new Set(Object.values(NET_HINTS))].filter((line) => !(line in en))
check('every hint is translated', missing, [])

// The codes that turn up daily. A browser that says only «-105» has failed at
// the one moment it was needed.
check('a name that would not resolve', typeof NET_HINTS[-105], 'string')
check('no connection at all', typeof NET_HINTS[-106], 'string')
check('a timeout', typeof NET_HINTS[-118], 'string')
check('an expired certificate', typeof NET_HINTS[-201], 'string')
check('a proxy that will not answer', typeof NET_HINTS[-130], 'string')
// -3 is ERR_ABORTED: a navigation somebody themselves interrupted. It is not
// a failure and must never be given a sentence.
check('an aborted load has nothing to say', NET_HINTS[-3], undefined)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`health: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
