// Names, archives and what a zip is not allowed to do — run with `npm test`.
//
// Two things here are security, not tidiness. A zip entry named `../../x` must
// never be written outside the folder it is being unpacked into, and an
// archive that inflates to a hundred gigabytes must be refused rather than
// attempted. Both are one line of code and both have cost other browsers a
// CVE, so both are pinned here.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { deflateRawSync } from 'zlib'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const room = mkdtempSync(join(tmpdir(), 'nya-downloads-'))

const bundle = async (source, name) => {
  const out = join(room, name)
  await build({
    entryPoints: [source],
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { electron: join(here, 'electron-stub.mjs') },
    outfile: out,
    logLevel: 'error'
  })
  return import(pathToFileURL(out).href)
}

const src = join(here, '..', 'src')
const { unzip, safeJoin, readIndex } = await bundle(join(src, 'main', 'unzip.ts'), 'unzip.mjs')
const { applyRule } = await bundle(join(src, 'main', 'downloads.ts'), 'downloads.mjs')

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* --------------------------------------------------------------- the names */

const WHEN = new Date(2026, 2, 7, 21, 5)
const rule = (r, name, url = 'https://files.example.com/x') => applyRule(r, name, url, WHEN)

check('no rule leaves the name alone', rule('', 'Отчёт.pdf'), 'Отчёт.pdf')
check('a rule with no tokens is still a name', rule('scan', 'Отчёт.pdf'), 'scan.pdf')
check('{name} is the stem', rule('{name}', 'Отчёт.pdf'), 'Отчёт.pdf')
check('{date} is the day it arrived', rule('{date} {name}', 'Отчёт.pdf'), '2026-03-07 Отчёт.pdf')
check('{time} is the hour and minute', rule('{time}', 'a.txt'), '21-05.txt')
check('{host} drops the www', rule('{host}', 'a.txt', 'https://www.example.com/a'), 'example.com.txt')
check('{ext} is the extension without its dot', rule('{name}-{ext}', 'a.txt'), 'a-txt.txt')
check('an extension is never lost', rule('{date}', 'photo.jpg'), '2026-03-07.jpg')
check('and never doubled', rule('{name}.jpg', 'photo.jpg'), 'photo.jpg')
// A rule is typed by a person, and a person will type a slash.
check('a slash cannot make a folder', rule('a/b', 'x.txt'), 'a_b.txt')
check('nor can a colon', rule('a:b', 'x.txt'), 'a_b.txt')
check('nor can dots', rule('..', 'x.txt'), '...txt')
check('a rule that empties out falls back', rule('   ', 'x.txt'), 'x.txt')
check('a name without an extension survives', rule('{date} {name}', 'README'), '2026-03-07 README')

/* ------------------------------------------------------ where an entry lands */

const ROOT = join(room, 'into')
check('an ordinary name is allowed', Boolean(safeJoin(ROOT, 'a/b.txt')), true)
check('a name climbing out is refused', safeJoin(ROOT, '../escape.txt'), null)
check('even in the middle', safeJoin(ROOT, 'a/../../escape.txt'), null)
check('an absolute path is refused', safeJoin(ROOT, '/etc/passwd'), null)
check('a drive letter is refused', safeJoin(ROOT, 'C:/Windows/x'), null)
check('a backslash climb is refused', safeJoin(ROOT, '..\\escape.txt'), null)
check('a null byte is refused', safeJoin(ROOT, 'a\u0000b'), null)
check('an empty name is refused', safeJoin(ROOT, ''), null)

/* ------------------------------------------------------------- a real zip */

/** The smallest zip that is a zip: local headers, then the central directory. */
function makeZip(files, { method = 8, flags = 0 } = {}) {
  const locals = []
  const central = []
  let at = 0
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8')
    const body = method === 8 ? deflateRawSync(raw) : raw
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, body)

    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(flags, 8)
    head.writeUInt16LE(method, 10)
    head.writeUInt32LE(0, 16)
    head.writeUInt32LE(body.length, 20)
    head.writeUInt32LE(raw.length, 24)
    head.writeUInt16LE(nameBytes.length, 28)
    head.writeUInt32LE(at, 42)
    central.push(head, nameBytes)
    at += local.length + nameBytes.length + body.length
  }
  const body = Buffer.concat(locals)
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, dir, end])
}

const zipPath = join(room, 'bundle.zip')
writeFileSync(
  zipPath,
  makeZip([
    ['notes.txt', 'the quick brown fox'.repeat(20)],
    ['docs/inner.txt', 'inner']
  ])
)
const out = join(room, 'bundle')
const result = unzip(zipPath, out)
check('a zip is read', Boolean(result), true)
check('with both files', result?.files, 2)
check('the first survives the round trip', readFileSync(join(out, 'notes.txt'), 'utf8'), 'the quick brown fox'.repeat(20))
check('so does one in a folder', readFileSync(join(out, 'docs', 'inner.txt'), 'utf8'), 'inner')

// Stored, not deflated — small files are often written this way.
const storedPath = join(room, 'stored.zip')
writeFileSync(storedPath, makeZip([['plain.txt', 'no compression here']], { method: 0 }))
const stored = unzip(storedPath, join(room, 'stored'))
check('an uncompressed entry works too', stored?.files, 1)
check('and says the same thing', readFileSync(join(room, 'stored', 'plain.txt'), 'utf8'), 'no compression here')

// The attack, refused.
const evilPath = join(room, 'evil.zip')
writeFileSync(evilPath, makeZip([['../escaped.txt', 'should never be written']]))
const escapeRoot = join(room, 'evil')
mkdirSync(escapeRoot, { recursive: true })
check('a climbing entry refuses the whole archive', unzip(evilPath, escapeRoot), null)
check('and nothing was written outside', existsSync(join(room, 'escaped.txt')), false)

// Encrypted archives are not half-supported.
const lockedPath = join(room, 'locked.zip')
writeFileSync(lockedPath, makeZip([['a.txt', 'secret']], { flags: 0x1 }))
check('an encrypted archive is refused', unzip(lockedPath, join(room, 'locked')), null)

check('a file that is not a zip is refused', readIndex(Buffer.from('not a zip at all')), null)
check('and unzip says so too', unzip(join(room, 'missing.zip'), join(room, 'nope')), null)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`downloads: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
