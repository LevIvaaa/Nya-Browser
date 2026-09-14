// What a form was holding when it was left — run with `npm test`.
//
// The whole value of this is that it is narrow: an address, a day, a cap on
// how much, and nothing kept that should not be. Each of those is a line here,
// because every one of them is the kind of thing that quietly stops being true.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const room = mkdtempSync(join(tmpdir(), 'nya-drafts-'))
const out = join(room, 'drafts.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'drafts.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { drafts } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

const PAGE = 'https://example.com/forum/new'

drafts.keep(PAGE, { 'textarea|n:body': 'a comment long enough to be worth keeping' })
check('what was typed comes back', drafts.find(PAGE)['textarea|n:body'].startsWith('a comment'), true)

// The fragment is the reader's position on the page, not a different form.
check('the fragment is not part of the address', Boolean(drafts.find(PAGE + '#reply')), true)
check('a different path is a different form', drafts.find('https://example.com/forum/other'), null)
check('and so is a different site', drafts.find('https://other.example/forum/new'), null)

// Only pages, and only ones with an address worth writing down.
drafts.keep('file:///C:/secret.html', { 'input|n:x': 'xxxxxxxxxxxx' })
check('a local file is not remembered', drafts.find('file:///C:/secret.html'), null)
drafts.keep('not a url at all', { 'input|n:x': 'xxxxxxxxxxxx' })
check('nor is something that is not an address', drafts.find('not a url at all'), null)

// Taken, turned down, or sent: gone either way.
drafts.drop(PAGE)
check('dropping forgets it', drafts.find(PAGE), null)

/* -------------------------------------------------------------- the limits */

const long = 'x'.repeat(25_000)
drafts.keep(PAGE, { 'textarea|n:body': long })
check('one field is cut to twenty thousand', drafts.find(PAGE)['textarea|n:body'].length, 20_000)

const many = {}
for (let i = 0; i < 20; i += 1) many[`textarea|p:${i}`] = 'y'.repeat(5_000)
drafts.keep(PAGE, many)
const kept = drafts.find(PAGE)
const total = Object.values(kept).reduce((sum, text) => sum + text.length, 0)
check('a whole draft is cut to sixty thousand', total <= 60_000, true)
check('which is fewer fields than were sent', Object.keys(kept).length < 20, true)

drafts.keep(PAGE, { 'textarea|n:body': '' })
check('an empty field is not kept', drafts.find(PAGE), null)

// Fifty pages, oldest first out.
for (let i = 0; i < 60; i += 1) {
  drafts.keep(`https://example.com/page/${i}`, { 'textarea|n:body': `draft number ${i}` })
}
check('the newest is there', Boolean(drafts.find('https://example.com/page/59')), true)
check('the oldest is gone', drafts.find('https://example.com/page/0'), null)
drafts.clear()
check('clearing forgets everything', drafts.find('https://example.com/page/59'), null)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`drafts: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
