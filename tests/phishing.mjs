// Telling a bad address from a good one — run with `npm test`.
//
// The two ways to get this wrong are opposite and both bad. Miss a dressed-up
// address and somebody loses a password; call an ordinary site dangerous and
// the warning is trained out of being read at all. The "quiet" half of this
// file is therefore as important as the "catches it" half.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-phishing-')), 'phishing.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'shared', 'phishing.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error'
})

const { inspect, editDistance, mixedScript, skeleton, registrable } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed += 1
  else failures.push({ name, actual, expected })
}

const kinds = (url, known = []) => inspect(url, known).map((one) => one.kind)
const first = (url, known = []) => inspect(url, known)[0] ?? null

/* ------------------------------------------------------------- alphabets */

check('a name in one alphabet is fine', mixedScript('почта.рф'), false)
check('and so is a plain one', mixedScript('example.com'), false)
check('two alphabets in one word is not', mixedScript('раypal.com'), true)
check('the skeleton is what a person sees', skeleton('раypal.com'), 'paypal.com')

check(
  'a dressed-up address is caught',
  first('https://раypal.com/login')?.kind,
  'homograph'
)
check(
  'and it says what it is pretending to be',
  first('https://раypal.com/login')?.looksLike,
  'paypal.com'
)

/* -------------------------------------------------------------- distance */

check('nothing to change', editDistance('abc', 'abc'), 0)
check('one letter', editDistance('paypal', 'paypai'), 1)
check('one missing', editDistance('github', 'gihub'), 1)
check('too far to care', editDistance('example', 'nothing', 2), 3)

/* ------------------------------------------------------------- lookalike */

check('one letter off a guarded name', kinds('https://gihub.com'), ['lookalike'])
check('and it says which', first('https://gihub.com')?.looksLike, 'github.com')
check(
  'one letter off a place this profile goes',
  first('https://intranet.exampl.org', ['intranet.example.org'])?.looksLike,
  'intranet.example.org'
)
check('a typosquat that hides behind its own subdomain', first('https://ww547.gihub.com/?tkn=1')?.looksLike, 'github.com')
check(
  'having been there does not vouch for a famous lookalike',
  first('https://gihub.com', ['gihub.com'])?.looksLike,
  'github.com'
)
check('the real thing is not a lookalike of itself', kinds('https://github.com'), [])
check('nor with www', kinds('https://www.github.com'), [])
check('nor a subdomain of it', kinds('https://gist.github.com'), [])

check('the registered part of a plain name', registrable('ww547.gihub.com'), 'gihub.com')
check('and of one with a two-part ending', registrable('shop.example.co.uk'), 'example.co.uk')

/* -------------------------------------------------------- brand prefixes */

check(
  'a guarded name used as a prefix',
  first('https://paypal.com.account-check.example/login')?.kind,
  'brand-subdomain'
)
check(
  'and the real site is named',
  first('https://paypal.com.account-check.example/login')?.looksLike,
  'paypal.com'
)
check('a real subdomain is not a prefix trick', kinds('https://accounts.google.com'), [])

/* ------------------------------------------------------------ the others */

check('a name before the @', kinds('https://apple.com@evil.example/'), ['credentials'])
check('a bare address', kinds('http://192.168.1.1/'), ['raw-ip'])
check('and nothing else is said about it', kinds('http://93.184.216.34/'), ['raw-ip'])

/* ------------------------------------------------------------ staying quiet */

for (const ordinary of [
  'https://example.com/',
  'https://news.ycombinator.com/item?id=1',
  'https://ru.wikipedia.org/wiki/Тьюринг',
  'https://почта.рф/',
  'https://sub.domain.example.co.uk/a/b',
  'https://localhost:5173/',
  'nya://settings',
  'file:///C:/notes.txt',
  'not a url at all'
]) {
  check(`quiet about ${ordinary}`, kinds(ordinary), [])
}

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`phishing: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
