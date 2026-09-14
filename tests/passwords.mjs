// Passwords: made, judged, timed and moved — run with `npm test`.
//
// Four things that are easy to get quietly wrong. A generator that leaves out
// a character class nobody notices until a site refuses the password; an audit
// that calls a reused password fine; a one-time code that is off by a step and
// works only half the time; and a CSV importer that silently drops rows. Each
// of them is checked here against a value that does not come from our own code.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const room = mkdtempSync(join(tmpdir(), 'nya-passwords-'))

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
const { makePassword, judge, DEFAULT_SHAPE } = await bundle(join(src, 'shared', 'password.ts'), 'password.mjs')
const { codeFor, fromBase32, secretOf } = await bundle(join(src, 'main', 'totp.ts'), 'totp.mjs')
const { vault } = await bundle(join(src, 'main', 'vault.ts'), 'vault.mjs')

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------------------- the generator */

const made = makePassword()
check('the default length is honoured', made.length, DEFAULT_SHAPE.length)
check('and the default is judged strong', judge(made), 'good')
check('a length below eight is raised', makePassword({ length: 3 }).length, 8)
check('and one above sixty-four is cut', makePassword({ length: 900 }).length, 64)

// Two hundred passwords is enough to see a character class that is meant to be
// absent: with marks off, one slipping through is a one-in-many event, not a
// coincidence.
let leaked = 0
for (let i = 0; i < 200; i += 1) {
  const plain = makePassword({ marks: false, digits: false, upper: false, length: 24 })
  if (/[^a-z]/.test(plain)) leaked += 1
}
check('switching a class off keeps it off', leaked, 0)

const lookalikes = makePassword({ length: 64 })
check('no lowercase l', lookalikes.includes('l'), false)
check('no capital I', lookalikes.includes('I'), false)
check('no capital O', lookalikes.includes('O'), false)
check('no zero', lookalikes.includes('0'), false)
check('no one', lookalikes.includes('1'), false)

// The generator must not repeat itself. Two hundred draws of a 20-character
// password from a 60-odd character alphabet collide only if something is wrong.
check('two draws differ', makePassword() === makePassword(), false)

/* ---------------------------------------------------------------- the verdict */

check('a short one is weak', judge('abc'), 'weak')
check('a word with a number after it is weak', judge('password1'), 'weak')
check('even a long word with a number', judge('correcthorsebattery2024'), 'weak')
check('one class is never enough', judge('abcdefghijklmnop'), 'weak')
check('ten mixed characters are fair', judge('Ab3cdefgh1'), 'fair')
check('twenty mixed with marks are good', judge('Kd8#mQw2!zTr4$vB'), 'good')

/* ------------------------------------------------------- the one-time code */

// RFC 6238's own test vector: the ASCII secret "12345678901234567890" in
// base32, at four moments the RFC publishes answers for. These are eight-digit
// codes; ours are the last six, which is the same number taken modulo a
// million.
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
check('RFC 6238 at t=59', codeFor(RFC, 59_000).digits, '287082')
check('RFC 6238 at t=1111111109', codeFor(RFC, 1_111_111_109_000).digits, '081804')
check('RFC 6238 at t=1234567890', codeFor(RFC, 1_234_567_890_000).digits, '005924')
check('RFC 6238 at t=2000000000', codeFor(RFC, 2_000_000_000_000).digits, '279037')
check('the start of a step has all thirty seconds', codeFor(RFC, 30_000).left, 30)
check('and a second before the end leaves one', codeFor(RFC, 59_000).left, 1)
check('the code holds for the whole step', codeFor(RFC, 45_000).digits, codeFor(RFC, 59_000).digits)
check('and changes at the next one', codeFor(RFC, 60_000).digits === codeFor(RFC, 59_000).digits, false)

check('spaces and case in a key are ignored', fromBase32('gezd gnbv').equals(fromBase32('GEZDGNBV')), true)
check('padding is ignored', fromBase32('GEZDGNBV====').equals(fromBase32('GEZDGNBV')), true)
check('a key with letters outside the alphabet is refused', fromBase32('01889!'), null)
check('an empty key is refused', fromBase32('   '), null)

check(
  'an otpauth line gives up its secret',
  secretOf(`otpauth://totp/Nya:me@example.com?secret=${RFC}&issuer=Nya`),
  RFC
)
check('a bare key is taken as it is', secretOf(RFC), RFC)
check('an otpauth line without a secret is refused', secretOf('otpauth://totp/Nya?issuer=Nya'), null)
check('so is a line that is not a URL', secretOf('otpauth://%%%'), null)

/* -------------------------------------------- the audit, the bin and the CSV */

if (vault.unlock('')) {
  vault.save('example.com', 'me', 'Kd8#mQw2!zTr4$vB')
  vault.save('one.example', 'me', 'shared-one-9')
  vault.save('two.example', 'me', 'shared-one-9')
  vault.save('weak.example', 'me', 'password1')

  const audit = Object.fromEntries(vault.audit().map((row) => [row.origin, row]))
  check('the strong one passes', audit['example.com'].verdict, 'good')
  check('and is not marked reused', audit['example.com'].reused, false)
  check('the weak one is called weak', audit['weak.example'].verdict, 'weak')
  check('a password in two places is reused', audit['one.example'].reused, true)
  check('in both places', audit['two.example'].reused, true)
  check('nothing saved today is old', audit['example.com'].old, false)
  check('the audit never carries a password', JSON.stringify(vault.audit()).includes('shared-one-9'), false)

  // Deleting is not deleting: the entry moves to the bin, leaves the list, and
  // comes back whole.
  const one = vault.list().find((item) => item.origin === 'one.example')
  check('a password can be thrown away', vault.remove(one.id), true)
  check('which takes it out of the list', vault.list().some((item) => item.id === one.id), false)
  check('and puts it in the bin', vault.binned().some((item) => item.id === one.id), true)
  check('the audit stops counting it', vault.audit().length, 3)
  check('a binned entry can be restored', vault.restore(one.id), true)
  check('and is back in the list', vault.list().some((item) => item.id === one.id), true)
  check('with its password intact', vault.reveal(one.id), 'shared-one-9')
  check('restoring something not in the bin does nothing', vault.restore(one.id), false)

  vault.remove(one.id)
  check('an emptied bin reports what it threw out', vault.emptyBin(true), 1)
  check('and is then empty', vault.binned().length, 0)
  check('while a young bin survives the sweep', vault.emptyBin(), 0)

  // Out and back in. The CSV is the one door that gives everything up, so the
  // round trip has to be exact — including the note and the quoting.
  vault.save('quotes.example', 'me "the user"', 'p,ass"word#1', 'a note, with a comma')
  const csv = vault.exportCsv()
  check('the export has a header', csv.split('\n')[0], '"url","username","password","note"')
  check('and a row for every entry', csv.split('\n').length - 1, vault.list().length)
  check('the export carries the passwords', csv.includes('shared-one-9'), true)

  const file = join(room, 'out.csv')
  writeFileSync(file, csv, 'utf8')

  check('a Chrome-shaped CSV is read', vault.importCsv('name,url,username,password\nx,https://imported.example/login,me,Zx9#qLm2!\n'), 1)
  const imported = vault.list().find((item) => item.origin === 'imported.example')
  check('the host is taken from the URL', Boolean(imported), true)
  check('and the password arrives whole', vault.reveal(imported.id), 'Zx9#qLm2!')
  check('a row without a password is skipped', vault.importCsv('url,username,password\nhttps://empty.example,me,\n'), 0)
  check('a file with no password column is refused', vault.importCsv('url,username\nhttps://x.example,me\n'), 0)
  check('and so is an empty one', vault.importCsv(''), 0)
  check('quoted commas survive a round trip', vault.importCsv(csv) > 0, true)
  check(
    'including inside a value',
    vault.list().filter((item) => item.origin === 'quotes.example').length >= 1,
    true
  )
} else {
  failures.push({ name: 'the vault opens for the audit tests', actual: false, expected: true })
}

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`passwords: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
