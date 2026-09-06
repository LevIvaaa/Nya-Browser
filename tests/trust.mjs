// Tests for the roots the browser carries — run with `npm test`.
//
// Trusting a root is the largest thing a browser can be asked to do: whoever
// holds it can speak for any name it is trusted for. These certificates are
// carried so Russian sites open, and the two things that keep that from
// becoming "and everything else as well" are checked here — that the bundled
// files are the certificates they claim to be, and that they are refused
// outside the domains they are carried for.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { X509Certificate } from 'crypto'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-trust-')), 'trust.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'trust.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { withinBundledScope, reachesBundledRoot } = await import(pathToFileURL(out).href)
const { BUNDLED_ROOTS } = await import(
  pathToFileURL(await bundle('roots.ts', 'roots.mjs')).href
)

async function bundle(from, to) {
  const file = join(dirname(out), to)
  await build({
    entryPoints: [join(here, '..', 'src', 'main', from)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: file,
    logLevel: 'error'
  })
  return file
}

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------ the files are what they say */

// The same check trust.ts makes when it loads. If a PEM is ever replaced, this
// fails here rather than the browser quietly trusting a different authority.
for (const root of BUNDLED_ROOTS) {
  const parsed = new X509Certificate(root.pem)
  check(`${root.name} matches its fingerprint`, parsed.fingerprint256.toUpperCase(), root.fingerprint)
  check(`${root.name} is a CA`, parsed.ca, true)
  check(`${root.name} has not expired`, Date.parse(parsed.validTo) > Date.now(), true)
}

check('two certificates are carried', BUNDLED_ROOTS.length, 2)

/* --------------------------------------------------- and only where they belong */

for (const host of [
  'sberbank.ru',
  'www.vtb.ru',
  'gosuslugi.ru',
  'nalog.ru',
  'example.su',
  'xn--80aswg.xn--p1ai' // сайт.рф
]) {
  check(`${host} is within scope`, withinBundledScope(host), true)
}

for (const host of [
  'google.com',
  'mail.google.com',
  'example.org',
  'sberbank.ru.evil.com', // the suffix is not the end of the name
  'notru', // no dot, not the whole label
  'ruse.com',
  'bank.rutube', // ".ru" is not a suffix of ".rutube"
  ''
]) {
  check(`${host || '(empty)'} is out of scope`, withinBundledScope(host), false)
}

/* ------------------------------------- and a chain is never taken on trust alone */

// The bundled root presented as if it were the site's own certificate: a real
// certificate, correctly signed, that still says nothing about this host.
const rootAsLeaf = { data: BUNDLED_ROOTS[0].pem, fingerprint: 'x' }
check('a certificate for the wrong name is refused', reachesBundledRoot('sberbank.ru', rootAsLeaf), false)
check('an out-of-scope host is refused outright', reachesBundledRoot('google.com', rootAsLeaf), false)
check('nonsense is refused', reachesBundledRoot('sberbank.ru', { data: 'not a certificate' }), false)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
