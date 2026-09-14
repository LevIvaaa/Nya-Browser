// Tests for the profile backup — run with `npm test`.
//
// The backup is the one file in this browser that is meant to leave the
// machine, so two things have to be true and are checked here: without the
// password it is nothing, and with the password it is everything. A mistake
// here is not a bug, it is somebody's passwords in a file anybody can read.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-backup-')), 'backup.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'backup.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { makeBackup, readBackup } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push({ name, actual, expected })
}

// The stores are empty in a test process, which is fine: what is being checked
// is the sealing, not what happens to be inside.
const made = makeBackup('correct horse battery staple')
check('a backup is made', made !== null, true)
check('it says what it carried', typeof made.counts.bookmarks, 'number')

const file = made.file
check('it names itself', file.magic, 'nya-backup')
check('it carries a salt', typeof file.salt === 'string' && file.salt.length > 10, true)
check('it carries a tag', typeof file.tag === 'string' && file.tag.length > 10, true)

// The whole point: the body is unreadable as it lies.
const asText = JSON.stringify(file)
check('the body is not plain text', asText.includes('"settings"'), false)
check('and neither is anything in it', asText.includes('bookmarks'), false)

// The password, and only the password.
const opened = readBackup(file, 'correct horse battery staple')
check('the right password opens it', opened !== null, true)
check('and the settings come back', typeof opened.settings, 'object')
check('a wrong password opens nothing', readBackup(file, 'correct horse battery stapl'), null)
check('an empty password opens nothing', readBackup(file, ''), null)

// A file that has been tampered with must not open either — the tag is what
// makes that true, so it is worth a check of its own.
const bent = { ...file, data: file.data.slice(0, -4) + 'AAAA' }
check('a changed body opens nothing', readBackup(bent, 'correct horse battery staple'), null)
check('a file of the wrong shape opens nothing', readBackup({ hello: 1 }, 'x'), null)
check('too short a password makes nothing', makeBackup('abc'), null)

if (failures.length > 0) {
  for (const f of failures) {
    console.error(`FAIL ${f.name}\n  got      ${JSON.stringify(f.actual)}\n  expected ${JSON.stringify(f.expected)}`)
  }
  console.error(`\n${failures.length} of ${passed + failures.length} checks failed`)
  process.exit(1)
}
console.log(`backup: ${passed} checks passed`)
