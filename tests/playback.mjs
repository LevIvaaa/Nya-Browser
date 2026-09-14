// Where you stopped watching — run with `npm test`.
//
// The value of this is entirely in when it does not remember: a thirty-second
// clip, the last few seconds of a film, a page in a private window. Each of
// those is one condition, and each of them is the difference between a useful
// feature and one that reopens the credits.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-playback-')), 'playback.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'playback.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { playback } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

const TALK = 'https://example.com/talks/typography'

playback.keep(TALK, 1560, 2400)
check('the second comes back', playback.find(TALK), 1560)
check('the fragment is not part of it', playback.find(TALK + '#slide-4'), 1560)
check('another address is another video', playback.find('https://example.com/talks/other'), 0)
check('a local file is not remembered', playback.find('file:///C:/film.mp4'), 0)
check('nor is something that is not an address', playback.find('not a url'), 0)

// The two ends: nothing worth resuming, and nothing left to resume.
playback.keep(TALK + '?a=1', 8, 2400)
check('the first seconds are not a position', playback.find(TALK + '?a=1'), 0)

playback.drop(TALK)
check('watched to the end is forgotten', playback.find(TALK), 0)
playback.drop(TALK)
check('and forgetting twice is harmless', playback.find(TALK), 0)

// Two hundred, newest kept.
for (let i = 0; i < 260; i += 1) playback.keep(`https://example.com/v/${i}`, 100 + i, 3000)
check('the newest is there', playback.find('https://example.com/v/259'), 359)
check('the oldest is gone', playback.find('https://example.com/v/0'), 0)

playback.clear()
check('clearing forgets everything', playback.find('https://example.com/v/259'), 0)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`playback: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
