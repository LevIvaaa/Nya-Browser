// Notes, the to-do list and habits — run with `npm test`.
//
// Three small stores that hold what somebody typed onto their own start page.
// The sanitising is what matters: these files are the ones most likely to be
// edited by hand, and a widget that cannot draw its own data is a start page
// that will not open.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-desk-')), 'desk.mjs')

await build({
  entryPoints: [join(here, 'desk-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { desk, habits } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed += 1
  else failures.push({ name, actual, expected })
}

const dir = mkdtempSync(join(tmpdir(), 'nya-desk-data-'))
desk.load(dir)
habits.load(dir)

/* ------------------------------------------------------------------ notes */

desk.setNote({ id: 'a', text: 'молоко', colour: 'pink', at: 1 })
check('a note is kept', desk.all().notes.length, 1)
check('with its colour', desk.all().notes[0].colour, 'pink')

desk.setNote({ id: 'a', text: 'молоко и хлеб', colour: 'blue', at: 2 })
check('writing the same note again replaces it', desk.all().notes.length, 1)
check('and the new text is there', desk.all().notes[0].text, 'молоко и хлеб')

desk.setNote({ id: 'b', text: '', colour: 'yellow', at: 3 })
check('an empty note is not a note', desk.all().notes.length, 1)

desk.setNote({ id: 'c', text: 'x', colour: 'neon', at: 4 })
check('a colour nothing can draw falls back', desk.all().notes.find((n) => n.id === 'c').colour, 'yellow')

desk.removeNote('a')
check('a note can go', desk.all().notes.length, 1)

/* ------------------------------------------------------------------- todo */

desk.setTodo({ id: 't1', text: 'позвонить', done: false, at: 1 })
desk.setTodo({ id: 't2', text: 'ответить', done: false, at: 2 })
check('two items', desk.all().todos.length, 2)

desk.setTodo({ id: 't1', text: 'позвонить', done: true, at: 1 })
check('ticking one does not move it', desk.all().todos[0].id, 't1')
check('and it is ticked', desk.all().todos[0].done, true)

desk.setTodo({ id: 't3', text: '   ', done: false, at: 3 })
check('an item with nothing in it is not an item', desk.all().todos.length, 2)

desk.clearDone()
check('clearing done leaves the rest', desk.all().todos.map((one) => one.id), ['t2'])

/* ----------------------------------------------------------------- habits */

const at = (hour) => new Date(2026, 2, 7, hour, 30)

for (let i = 0; i < 5; i++) habits.record('https://news.example/article', at(9))
for (let i = 0; i < 2; i++) habits.record('https://mail.example/inbox', at(9))
habits.record('https://late.example/', at(23))

check('the busiest host at this hour comes first', habits.atThisHour(at(9))[0].host, 'news.example')
check('and the quieter one follows', habits.atThisHour(at(9))[1].host, 'mail.example')
check('another hour has its own answer', habits.atThisHour(at(23))[0].host, 'late.example')
check(
  'the hour either side counts at half weight',
  habits.atThisHour(at(10)).find((one) => one.host === 'news.example')?.count,
  3
)
check('a far-off hour knows nothing', habits.atThisHour(at(15)).length, 0)

habits.record('not a url at all', at(9))
check('nonsense is not counted', habits.atThisHour(at(9)).length, 2)
habits.record('file:///C:/secret.txt', at(9))
check('nor is a local file', habits.atThisHour(at(9)).length, 2)

check('www is not a different site', (() => {
  habits.record('https://www.news.example/other', at(9))
  return habits.atThisHour(at(9))[0].count
})(), 6)

habits.clear()
check('and all of it can be forgotten', habits.atThisHour(at(9)), [])

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`desk: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
