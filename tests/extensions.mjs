// Tests for extension archive unpacking — run with `npm test`.
//
// The zip reader does its own offset arithmetic and its own zip-slip check, and
// both fail silently when wrong: a broken offset yields an extension that simply
// does not load, and a missing guard lets an archive write outside its folder.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { deflateRawSync } from 'zlib'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'nya-ext-'))

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'extensions.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: join(work, 'extensions.mjs'),
  logLevel: 'error'
})

const { unzip, zipBodyOf, manifestRoot } = await import(
  pathToFileURL(join(work, 'extensions.mjs')).href
)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------------------ zip building */

const dosTime = () => Buffer.from([0, 0, 0, 0])

/** Builds a zip in memory, so the tests do not depend on any external tool. */
function makeZip(entries) {
  const locals = []
  const central = []
  let offset = 0

  for (const { name, content, store = false } of entries) {
    const raw = Buffer.from(content, 'utf8')
    const body = store ? raw : deflateRawSync(raw)
    const nameBuffer = Buffer.from(name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(store ? 0 : 8, 8)
    dosTime().copy(local, 10)
    local.writeUInt32LE(0, 14) // crc, not checked by the reader
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuffer, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0, 8)
    entry.writeUInt16LE(store ? 0 : 8, 10)
    dosTime().copy(entry, 12)
    entry.writeUInt32LE(0, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(nameBuffer.length, 28)
    entry.writeUInt16LE(0, 30)
    entry.writeUInt16LE(0, 32)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBuffer)

    offset += local.length + nameBuffer.length + body.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)
  return Buffer.concat([localPart, centralPart, eocd])
}

/** Wraps a zip in a crx3 envelope: magic, version 3, header length, header. */
function makeCrx3(zip) {
  const header = Buffer.from('pretend this is a protobuf signature header', 'utf8')
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24', 0, 'latin1')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)
  return Buffer.concat([prefix, header, zip])
}

/* ------------------------------------------------------------------- tests */

const MANIFEST = JSON.stringify({ manifest_version: 3, name: 'Test', version: '1.0' })

// deflated and stored entries, plus a nested path
const plain = makeZip([
  { name: 'manifest.json', content: MANIFEST },
  { name: 'content.js', content: 'console.log("x".repeat(500))' },
  { name: 'assets/note.txt', content: 'stored', store: true }
])

const target = join(work, 'plain')
unzip(plain, target)
check('deflated entry restored', JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')).name, 'Test')
check('long deflated entry intact', readFileSync(join(target, 'content.js'), 'utf8').length, 28)
check('stored entry restored', readFileSync(join(target, 'assets', 'note.txt'), 'utf8'), 'stored')
check('manifest found at the root', manifestRoot(target), target)

// a crx3 envelope must be stripped before the zip is read
const crxTarget = join(work, 'crx')
unzip(zipBodyOf(makeCrx3(plain)), crxTarget)
check('crx3 header skipped', existsSync(join(crxTarget, 'manifest.json')), true)

// a plain zip must pass through zipBodyOf untouched
check('plain zip left alone', zipBodyOf(plain).length, plain.length)

// a wrapper folder is seen through
const wrapped = makeZip([
  { name: 'my-extension/manifest.json', content: MANIFEST },
  { name: 'my-extension/bg.js', content: 'void 0' }
])
const wrappedTarget = join(work, 'wrapped')
unzip(wrapped, wrappedTarget)
check('wrapper folder seen through', manifestRoot(wrappedTarget), join(wrappedTarget, 'my-extension'))

// zip-slip: an entry may not escape its folder
const evil = makeZip([{ name: '../escaped.txt', content: 'nope' }])
const evilTarget = join(work, 'evil')
let blocked = false
try {
  unzip(evil, evilTarget)
} catch {
  blocked = true
}
check('escaping entry refused', blocked, true)
check('nothing written outside', existsSync(join(work, 'escaped.txt')), false)

// an archive with no manifest is not an extension
const notAnExtension = makeZip([{ name: 'readme.txt', content: 'hello' }])
const plainTarget = join(work, 'notext')
unzip(notAnExtension, plainTarget)
check('no manifest, no extension', manifestRoot(plainTarget), null)

// garbage must be rejected, not half-unpacked
writeFileSync(join(work, 'junk.zip'), Buffer.from('not a zip at all'))
let rejected = false
try {
  unzip(readFileSync(join(work, 'junk.zip')), join(work, 'junk'))
} catch {
  rejected = true
}
check('garbage rejected', rejected, true)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
