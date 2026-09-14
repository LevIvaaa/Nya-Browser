// The number a page keeps in its own title — run with `npm test`.
//
// Reading a count out of a title is the whole of the tab badge, and it is the
// kind of thing that quietly starts matching the wrong thing: a year, a price,
// a chapter number. Every shape here is one a real site actually uses, and
// every non-match is one that would have been wrong.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-tabs-')), 'badge.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'shared', 'badge.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error'
})

const { badgeOf } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* --------------------------------------------------------- what it catches */

check('parentheses, the way mail writes it', badgeOf('(3) Inbox — Gmail'), 3)
check('brackets, the way chats write it', badgeOf('[12] #general | Slack'), 12)
check('a bullet, the way code forges write it', badgeOf('5 • Pull requests'), 5)
check('a middle dot counts too', badgeOf('2 · Обсуждения'), 2)
check('leading space is nothing', badgeOf('  (7) Почта'), 7)
check('a space inside the brackets', badgeOf('( 4 ) Inbox'), 4)
check('three digits', badgeOf('(128) Уведомления'), 128)

/* ------------------------------------------------------- what it leaves be */

check('no count is no badge', badgeOf('Inbox — Gmail'), 0)
check('a year at the front is not a count', badgeOf('2026 in review'), 0)
check('a price is not a count', badgeOf('1999 руб. — купить'), 0)
check('a number in the middle is not a count', badgeOf('Chapter (3) of the book'), 0)
check('zero is not worth a badge', badgeOf('(0) Inbox'), 0)
check('nor is an empty title', badgeOf(''), 0)
check('nor five digits', badgeOf('(12345) Something'), 0)
check('a version number is not a count', badgeOf('1.2.3 release notes'), 0)
check('a date is not a count', badgeOf('12/03 — расписание'), 0)
check('a bare number with nothing after it', badgeOf('42'), 0)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`tabs: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
