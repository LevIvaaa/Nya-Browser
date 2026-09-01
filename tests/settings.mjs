// Tests for the settings sanitizer — run with `npm test`.
//
// Everything read from disk or sent over IPC goes through sanitize() before
// anything uses it, which makes it the one place where a bad value either gets
// corrected or gets to break the browser. A start-page layout is the sharpest
// case: a widget saved off the grid would be invisible with no way to drag it
// back, so the clamping is checked here rather than trusted.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-settings-')), 'settings.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'settings.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { sanitize, DEFAULT_SETTINGS } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []

/** Key order is not part of the answer, so both sides are sorted first. */
const stable = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )

function check(name, actual, expected) {
  if (stable(actual) === stable(expected)) passed++
  else failures.push({ name, actual, expected })
}

const page = (start) => sanitize({ startPage: start }).startPage
const box = (b) => page({ layout: { clock: b } }).layout.clock

// ---- the flow flag: false until something says otherwise
check('a fresh profile has not been greeted', sanitize({}).onboarded, false)
check('nonsense does not count as greeted', sanitize({ onboarded: 'yes' }).onboarded, false)
check('once greeted, it stays greeted', sanitize({ onboarded: true }).onboarded, true)

// ---- widget boxes are pulled back onto the grid
check('a sane box survives', box({ x: 4, y: 2, w: 6, h: 3, scale: 1.4 }), { w: 6, h: 3, x: 4, y: 2, scale: 1.4 })
check('a widget past the right edge comes back', box({ x: 40, y: 0, w: 6, h: 3, scale: 1 }).x, 18)
check('a negative position comes back', box({ x: -9, y: -4, w: 6, h: 3, scale: 1 }), { w: 6, h: 3, x: 0, y: 0, scale: 1 })
check('a widget wider than the grid is trimmed', box({ x: 0, y: 0, w: 99, h: 3, scale: 1 }).w, 24)
check('a hairline widget is widened', box({ x: 0, y: 0, w: 0, h: 3, scale: 1 }).w, 2)
check('runaway zoom is capped', box({ x: 0, y: 0, w: 6, h: 3, scale: 9 }).scale, 2.2)
check('a missing scale falls back', box({ x: 3, y: 3, w: 6, h: 3 }).scale, 1)
check('garbage becomes the default box', box('nonsense'), DEFAULT_SETTINGS.startPage.layout.clock)
check('a layout with nothing in it is filled in', page({ layout: {} }).layout, DEFAULT_SETTINGS.startPage.layout)
check('every widget is always present', Object.keys(page({}).layout).length, 8)

// ---- the rest of the start page
check('an unknown font falls back', page({ font: 'comic' }).font, 'system')
check('a known font is kept', page({ font: 'serif' }).font, 'serif')
check('tiles default to cards', page({}).tiles, 'card')
check('columns are clamped', page({ columns: 99 }).columns, 12)

// ---- the weather place, which is the only setting that reaches the network
check('no city until one is chosen', page({}).place.place, '')
check('an impossible latitude takes the place with it', page({ place: { place: 'X', lat: 800, lon: 0 } }).place, {
  place: '',
  lat: 0,
  lon: 0,
  fahrenheit: false
})
check('a real coordinate is kept', page({ place: { place: 'Киев', lat: 50.4547, lon: 30.5238 } }).place.lat, 50.4547)

// ---- a fresh profile brings nothing with it
check('a new profile has no favourites', sanitize({}).favorites, [])
check(
  'an existing list is kept',
  sanitize({ favorites: [{ id: 'a', title: 'A', url: 'https://a.dev' }] }).favorites.length,
  1
)
check('a list emptied on purpose stays empty', sanitize({ favorites: [] }).favorites, [])

// ---- a couple of the older knobs, to catch a sanitizer that stops sanitizing
check('an unknown theme falls back', sanitize({ theme: 'neon' }).theme, DEFAULT_SETTINGS.theme)
check('a bad accent falls back', sanitize({ accent: 'red' }).accent, DEFAULT_SETTINGS.accent)
check('a good accent is kept', sanitize({ accent: '#00FF88' }).accent, '#00FF88')
check('glass is clamped', sanitize({ glass: 400 }).glass, 100)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
