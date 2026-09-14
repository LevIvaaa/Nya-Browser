// Tests for the shortcut table and the layout swap — run with `npm test`.
//
// Both are small pure functions that everything else trusts: the window
// dispatches keys through shortcutMap, and the context menu rewrites what
// somebody typed through swapLayout. A mistake in either is silent — a key
// that quietly stops working, or a sentence turned into rubbish — so they are
// checked here rather than noticed later.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'nya-keys-'))

const bundle = async (name) => {
  const out = join(dir, name + '.mjs')
  await build({
    entryPoints: [join(here, '..', 'src', 'shared', name + '.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'error'
  })
  return import(pathToFileURL(out).href)
}

const { SHORTCUT_COMMANDS, comboOf, isCombo, shortcutMap, comboFor, prettyCombo } = await bundle('shortcuts')
const { swapLayout } = await bundle('layout')

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push({ name, actual, expected })
}

// ---- the table itself
check('every command has an id and a label', SHORTCUT_COMMANDS.every((c) => c.id && c.label), true)
check(
  'no two commands share an id',
  new Set(SHORTCUT_COMMANDS.map((c) => c.id)).size,
  SHORTCUT_COMMANDS.length
)
const defaults = SHORTCUT_COMMANDS.map((c) => c.combo).filter(Boolean)
check('no two commands claim the same chord', new Set(defaults).size, defaults.length)
check('every default chord is a valid chord', defaults.every(isCombo), true)

// ---- reading a keypress
const press = (over) => comboOf({ code: 'KeyT', key: 't', control: true, ...over })
check('ctrl and a letter', press({}), 'Ctrl+T')
check('modifiers keep one order', press({ shift: true, alt: true }), 'Ctrl+Alt+Shift+T')
check('a held modifier is not a chord', comboOf({ code: 'ControlLeft', key: 'Control', control: true }), '')
check(
  'the physical key wins over the letter printed on it',
  comboOf({ code: 'KeyT', key: 'е', control: true }),
  'Ctrl+T'
)
check('a function key needs nothing else', comboOf({ code: 'F11', key: 'F11' }), 'F11')
check('an arrow keeps its name', comboOf({ code: 'ArrowLeft', key: 'ArrowLeft', alt: true }), 'Alt+ArrowLeft')
check('the comma key is a comma', comboOf({ code: 'Comma', key: ',', control: true }), 'Ctrl+,')

// ---- what counts as a chord
check('a bare letter is typing, not a shortcut', isCombo('T'), false)
check('a function key alone is a shortcut', isCombo('F12'), true)
check('made-up modifiers are refused', isCombo('Hyper+T'), false)
check('the same modifier twice is refused', isCombo('Ctrl+Ctrl+T'), false)

// ---- overrides
check('with no overrides the defaults stand', shortcutMap({}).get('Ctrl+T'), 'new-tab')
check('an override moves the command', shortcutMap({ 'new-tab': 'Ctrl+E' }).get('Ctrl+E'), 'new-tab')
check('and frees the old chord', shortcutMap({ 'new-tab': 'Ctrl+E' }).has('Ctrl+T'), false)
check('an empty override leaves the command unbound', shortcutMap({ 'new-tab': '' }).has('Ctrl+T'), false)
check('an unknown chord is nobody', shortcutMap({}).get('Ctrl+Alt+Shift+Q'), undefined)
check('comboFor shows the default', comboFor('close-tab', {}), 'Ctrl+W')
check('comboFor shows the override', comboFor('close-tab', { 'close-tab': 'Ctrl+Q' }), 'Ctrl+Q')
check('an unbound command shows a dash', prettyCombo(''), '—')
check('arrows are drawn as arrows', prettyCombo('Alt+ArrowLeft'), 'Alt + ←')

// ---- the layout swap
check('latin typed in cyrillic comes back', swapLayout('ghbdtn'), 'привет')
check('and the other way round', swapLayout('привет'), 'ghbdtn')
check('case survives', swapLayout('Ghbdtn'), 'Привет')
check('what is neither is left alone', swapLayout('1 2 3'), '1 2 3')
check('a sentence with spaces', swapLayout('rfr ltkf'), 'как дела')

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f.name}\n  got      ${JSON.stringify(f.actual)}\n  expected ${JSON.stringify(f.expected)}`)
  console.error(`\n${failures.length} of ${passed + failures.length} checks failed`)
  process.exit(1)
}
console.log(`keys: ${passed} checks passed`)
