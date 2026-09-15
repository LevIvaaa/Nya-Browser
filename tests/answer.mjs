// Answering in the address bar — run with `npm test`.
//
// Two things matter here and they pull against each other. It has to answer
// the things people actually type, and it has to stay completely silent on
// everything else: a wrong number above the search results is worse than no
// number, and an address that looks slightly like a sum must never become one.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-answer-')), 'answer.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'shared', 'answer.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error'
})

const { answer, calculate } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------------------------ sums */

check('plain addition', calculate('2+2'), 4)
check('order of operations', calculate('2+2*2'), 6)
check('brackets', calculate('(2+2)*2'), 8)
check('division', calculate('10/4'), 2.5)
check('powers', calculate('2^10'), 1024)
check('a negative to start with', calculate('-5+8'), 3)
check('spaces are nothing', calculate('  12 *  3 '), 36)
check('a comma is a decimal point', calculate('1,5*2'), 3)
check('per cent of the thing before', calculate('200+10%'), 220)
check('and taken off it', calculate('200-10%'), 180)
check('dividing by nothing is not an answer', calculate('5/0'), null)

// Everything that must never become a sum.
check('a plain number is not a sum', calculate('42'), null)
check('a version is not a sum', calculate('1.2.3'), null)
check('a date is not a sum', calculate('12/03/2026'), null)
check('an address is not a sum', calculate('example.com'), null)
check('a word is not a sum', calculate('hello'), null)
check('nothing is not a sum', calculate(''), null)
check('half an expression is not a sum', calculate('2+'), null)
check('unbalanced brackets are not a sum', calculate('(2+2'), null)
check('anything else at all', calculate('2+2; drop table'), null)

/* ----------------------------------------------------------------- units */

const say = (text) => answer(text)?.text ?? null

// The answer wears the unit's own short form, so it reads the same however
// the question was declined: «55,92 миль», never «55,92 милях».
check('kilometres to miles', say('90 км в милях'), '55,92 миль')
check('and in the other language', say('90 km to miles'), '55,92 mi')
check('and the other way', say('26 miles to км'), '41,84 км')
check('pounds to kilograms', say('180 lb to кг'), '81,65 кг')
check('and back, in a unit that declines', say('81,65 кг в фунтах'), '180 фунт.')
check('gigabytes to megabytes', say('4 гб в мб'), '4096 МБ')
check('and asked in Latin, answered in Latin', say('4 gb to mb'), '4096 MB')
check('celsius to fahrenheit', say('18 c to f'), '64,4°')
check('fahrenheit to celsius', say('100 f в c'), '37,78°')
check('speed', say('100 км/ч в mph'), '62,14 mph')
check('mixing families answers nothing', say('5 кг в км'), null)
check('a unit nobody has heard of', say('5 фурлонгов в милях'), null)

/* --------------------------------------------------------------- per cent */

check('a share of a number', say('25% от 800'), '200')
check('with a space, and in English', say('17 % of 40'), '6,8')
check('a share of nothing in particular', say('25% от собаки'), null)

/* ------------------------------------------------------------------ time */

const at = new Date('2026-03-07T12:00:00Z')
const tokyo = answer('время в токио', at)
check('a place gives a time', Boolean(tokyo), true)
check('and says which zone', tokyo?.about, 'Asia/Tokyo')
check('an unknown place gives nothing', answer('время в зурбагане', at), null)

/* ------------------------------------------------------- staying quiet */

check('a search stays a search', answer('лучший браузер 2026'), null)
check('an address stays an address', answer('https://example.com/a+b'), null)
check('a phone number is not converted', answer('+7 900 000 00 00'), null)
check('and something very long is ignored', answer('2+2 '.repeat(60)), null)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`answer: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
