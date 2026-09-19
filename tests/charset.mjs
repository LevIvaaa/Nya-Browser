// Working out what encoding a file is in — run with `npm test`.
//
// Getting this wrong is the single most common way a browser makes a perfectly
// good file unreadable: a page of «Ð¿ÑÐ¸Ð²ÐµÑ» where Russian text should be.
// The two halves that matter are believing a server that says what it means,
// and guessing well when nobody said anything.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-charset-')), 'charset.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'shared', 'charset.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error'
})

const { sniffCharset, decodeText, markedCharset, declaredCharset } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed += 1
  else failures.push({ name, actual, expected })
}

const utf8 = (text) => new Uint8Array(Buffer.from(text, 'utf8'))
const cp1251 = (text) => {
  // Windows-1251 by hand: the Cyrillic block is contiguous at 0xC0.
  const bytes = []
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code < 128) bytes.push(code)
    else if (code >= 0x410 && code <= 0x44f) bytes.push(code - 0x410 + 0xc0)
    else if (code === 0x401) bytes.push(0xa8)
    else if (code === 0x451) bytes.push(0xb8)
    else bytes.push(0x3f)
  }
  return new Uint8Array(bytes)
}

/* ------------------------------------------------------------------ marks */

check('a utf-8 mark is a utf-8 mark', markedCharset(new Uint8Array([0xef, 0xbb, 0xbf, 65])), 'utf-8')
check('a utf-16 mark, little end first', markedCharset(new Uint8Array([0xff, 0xfe, 65, 0])), 'utf-16le')
check('and big end first', markedCharset(new Uint8Array([0xfe, 0xff, 0, 65])), 'utf-16be')
check('no mark is no answer', markedCharset(utf8('привет')), null)

/* -------------------------------------------------------------- declared */

check('a named charset is read', declaredCharset('text/plain; charset=windows-1251'), 'windows-1251')
check('with quotes and spaces', declaredCharset('text/csv;  charset="UTF-8"'), 'utf-8')
check('nothing named is nothing', declaredCharset('text/plain'), null)

/* --------------------------------------------------------------- sniffing */

check('plain ascii is utf-8', sniffCharset(utf8('hello, world')), 'utf-8')
check('russian utf-8 is utf-8', sniffCharset(utf8('привет, мир')), 'utf-8')
check(
  'the server is believed when it speaks',
  sniffCharset(utf8('привет'), 'text/plain; charset=koi8-r'),
  'koi8-r'
)
check(
  'a mark beats the server',
  sniffCharset(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('привет')]), 'text/plain; charset=koi8-r'),
  'utf-8'
)
check(
  'an unmarked eight-bit file is worked out',
  sniffCharset(cp1251('Привет, это обычный русский текст в старой кодировке')),
  'windows-1251'
)

/* --------------------------------------------------------------- decoding */

check('utf-8 comes back whole', decodeText(utf8('привет, мир')), 'привет, мир')
check(
  'and so does an eight-bit file',
  decodeText(cp1251('Привет, это обычный русский текст в старой кодировке')),
  'Привет, это обычный русский текст в старой кодировке'
)
check(
  'a marked file keeps none of the mark',
  decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('{"a":1}')])),
  '{"a":1}'
)
check(
  'and what comes back parses',
  JSON.parse(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('{"a":1}')]))).a,
  1
)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`charset: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
