// Tests for the Adblock Plus filter engine — run with `npm test`.
//
// filters.ts imports electron, so it is bundled against a stub first. That keeps
// the engine testable without booting a browser, which matters: it is the one
// piece where a quiet mistake means either "ads get through" or, worse,
// "ordinary sites break".

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-filters-')), 'filters.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'filters.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { engine, hideCss } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push({ name, actual, expected })
}

// A slice of the syntax the real lists use, including the options that have to
// be rejected rather than quietly widened.
const RULES = [
  '[Adblock Plus 2.0]',
  '! a comment',
  '||doubleclick.net^',
  '||example.com/ads/banner.gif',
  '||cdn.site.com/track.js$third-party',
  '||static.example.com/pixel.gif$image',
  '@@||example.com/ads/allowed.gif',
  '||analytics.evil.com^$domain=news.ru|blog.ru',
  '||tracker.io^$~third-party',
  '/adserver\\/banner/',
  '||important.example^$important',
  '@@||important.example^',
  '||popuponly.example^$popup',
  '||shady.example^$removeparam=x',
  '||regexparam.example^$removeparam=/utm_.*/',
  '##.ad-banner',
  'example.com##.sponsored',
  'news.ru,blog.ru##div[data-ad]',
  'example.com#@#.ad-banner',
  'tricky.example##.x:has-text(Ad)'
].join('\n')

engine.ingest(RULES, 'ad')
engine.finish()

check('only the rules we can honour survive', engine.ruleCount, 10)
check('cosmetic rules counted', engine.cosmeticCount, 3)

const m = (url, host, type) => engine.match(url, host, type)

// ---- host anchoring
check('subdomain blocked', m('https://ad.doubleclick.net/x.js', 'site.com', 'script'), 'ad')
check('apex blocked', m('https://doubleclick.net/x.js', 'site.com', 'script'), 'ad')
check('lookalike host allowed', m('https://notdoubleclick.net/x.js', 'site.com', 'script'), null)
check('host rule ignores query text', m('https://ok.com/?u=doubleclick.net', 'ok.com', 'xhr'), null)

// ---- path patterns
check('path pattern', m('https://example.com/ads/banner.gif', 'example.com', 'image'), 'ad')

// ---- exceptions and $important
check('@@ exception', m('https://example.com/ads/allowed.gif', 'example.com', 'image'), null)
check('$important beats @@', m('https://important.example/a', 'site.com', 'script'), 'ad')

// ---- $third-party / $~third-party
check('3p rule, other site', m('https://cdn.site.com/track.js', 'other.com', 'script'), 'ad')
check('3p rule, same site', m('https://cdn.site.com/track.js', 'site.com', 'script'), null)
check('1p rule, same site', m('https://tracker.io/x', 'tracker.io', 'script'), 'ad')
check('1p rule, other site', m('https://tracker.io/x', 'other.com', 'script'), null)

// ---- resource types
check('$image, right type', m('https://static.example.com/pixel.gif', 'a.com', 'image'), 'ad')
check('$image, wrong type', m('https://static.example.com/pixel.gif', 'a.com', 'script'), null)

// ---- $domain=
check('$domain listed', m('https://analytics.evil.com/a', 'news.ru', 'script'), 'ad')
check('$domain subdomain', m('https://analytics.evil.com/a', 'www.news.ru', 'script'), 'ad')
check('$domain not listed', m('https://analytics.evil.com/a', 'other.com', 'script'), null)

// ---- /regex/
check('regex pattern', m('https://x.com/adserver/banner?id=1', 'x.com', 'image'), 'ad')

// ---- options we do not implement must drop the rule, never widen it
check('$popup dropped', m('https://popuponly.example/a', 'a.com', 'script'), null)
check('$removeparam dropped', m('https://shady.example/a?x=1', 'a.com', 'script'), null)
check('$removeparam=/re/ dropped', m('https://regexparam.example/a', 'a.com', 'script'), null)

// ---- cosmetic: only what the page can actually use comes back
const sel = (host, classes = [], ids = []) => engine.cosmeticSelectors(host, classes, ids)
check('generic needs its class present', sel('random.com', ['ad-banner']), ['.ad-banner'])
check('generic withheld otherwise', sel('random.com', ['content']), [])
check('domain rule on its host', sel('example.com', ['sponsored']).includes('.sponsored'), true)
check('#@# exception on that host', sel('example.com', ['ad-banner']).includes('.ad-banner'), false)
check('#@# does not leak elsewhere', sel('other.com', ['ad-banner']), ['.ad-banner'])
check('domain rule reaches subdomains', sel('sub.news.ru').includes('div[data-ad]'), true)
check('attribute-only always applies', sel('news.ru').includes('div[data-ad]'), true)
check('procedural selector skipped', JSON.stringify(sel('tricky.example', ['x'])).includes('has-text'), false)
check('domain rule stays off other hosts', sel('other.com', ['sponsored']), [])
check('hideCss wraps the selectors', hideCss(['.a', '.b']), '.a,.b{display:none!important}')

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
