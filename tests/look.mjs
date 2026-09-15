// The look: which theme the clock asks for, and how tight the chrome is.
//
// The schedule is the part worth testing — an evening that crosses midnight is
// exactly the case somebody sets up and exactly the one a naive comparison
// gets backwards, leaving the browser light at two in the morning.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'nya-look-'))
const out = join(dir, 'look.mjs')

// The hook needs React and a document; the functions under test need neither,
// so both are stubbed out while the file is built.
writeFileSync(join(dir, 'react-stub.mjs'), 'export const useEffect = () => {}\nexport default { useEffect }\n', 'utf8')
writeFileSync(join(dir, 'ui-stub.mjs'), 'export const chromeManners = { shortcuts: true, feedback: true }\n', 'utf8')

await build({
  entryPoints: [join(here, '..', 'src', 'renderer', 'src', 'look.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { react: join(dir, 'react-stub.mjs') },
  plugins: [
    {
      name: 'ui-stub',
      setup(builder) {
        builder.onResolve({ filter: /components[\/]ui$/ }, () => ({ path: join(dir, 'ui-stub.mjs') }))
      }
    }
  ],
  outfile: out,
  logLevel: 'error'
})

const { isDark, densityOf, toolbarHeight, tabHeight } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed += 1
  else failures.push({ name, actual, expected })
}

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2026, 2, 7, h, m)
}
const settings = (patch) => ({
  theme: 'system',
  themeSchedule: { on: false, light: '07:00', dark: '20:00' },
  compact: false,
  density: 1,
  ...patch
})

/* ------------------------------------------------------------ plain theme */

check('dark means dark', isDark(settings({ theme: 'dark' }), false), true)
check('light means light', isDark(settings({ theme: 'light' }), true), false)
check('system follows the system', isDark(settings({ theme: 'system' }), true), true)
check('and the other way', isDark(settings({ theme: 'system' }), false), false)

/* ------------------------------------------------------------- the clock */

const evening = settings({ theme: 'light', themeSchedule: { on: true, light: '07:00', dark: '20:00' } })
check('morning is light', isDark(evening, true, at('08:00')), false)
check('afternoon is light', isDark(evening, true, at('19:59')), false)
check('evening is dark', isDark(evening, false, at('20:00')), true)
check('midnight is dark', isDark(evening, false, at('00:30')), true)
check('and it is still dark at six', isDark(evening, false, at('06:59')), true)
check('seven is light again', isDark(evening, false, at('07:00')), false)

// Somebody who works nights and wants it the other way round.
const nights = settings({ theme: 'light', themeSchedule: { on: true, light: '21:00', dark: '05:00' } })
check('dark from five', isDark(nights, false, at('05:00')), true)
check('still dark at noon', isDark(nights, false, at('12:00')), true)
check('light from nine in the evening', isDark(nights, false, at('21:00')), false)
check('and light at two in the morning', isDark(nights, false, at('02:00')), false)

check(
  'a schedule set to the same minute twice decides nothing',
  isDark(settings({ theme: 'dark', themeSchedule: { on: true, light: '09:00', dark: '09:00' } }), false, at('12:00')),
  true
)
check('a schedule that is off decides nothing', isDark(settings({ theme: 'dark' }), false, at('12:00')), true)

/* ---------------------------------------------------------------- density */

check('as drawn is one', densityOf(settings({})), 1)
check('the compact switch is the tight end', densityOf(settings({ compact: true })), 2)
check('unless the slider has been moved', densityOf(settings({ compact: true, density: 0 })), 0)

check('a roomy toolbar', toolbarHeight(settings({ density: 0 })), 48)
check('an ordinary one', toolbarHeight(settings({ density: 1 })), 44)
check('a tight one', toolbarHeight(settings({ density: 2 })), 40)
check('and the tabs follow it', tabHeight(settings({ density: 1 })), 34)
check('compact is what it always was', toolbarHeight(settings({ compact: true })), 40)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`look: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
