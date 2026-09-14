// Making a long thing short — run with `npm test`.
//
// A summary that picks the wrong sentences is worse than none, and the ways it
// goes wrong are specific: it grabs the longest sentence, or the first one, or
// the boilerplate at the end. So this runs it over a piece of real prose with
// a known subject and checks that what comes back is about that subject, in
// the order it was written, and made only of sentences that were there.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-gist-')), 'gist.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'shared', 'gist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error'
})

const { shorten, keywords } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------------------- a real text */

const ARTICLE = [
  'Типографика начинается там, где заканчивается набор символов.',
  'Шрифт задаёт ритм страницы, и этот ритм читатель чувствует раньше, чем успевает прочитать первое слово.',
  'Хороший шрифт не замечают, потому что он не мешает читать.',
  'Плохой шрифт замечают сразу: строка сбивается, глаз спотыкается, чтение превращается в работу.',
  'Интерлиньяж — расстояние между строками — влияет на чтение сильнее, чем кегль.',
  'Слишком плотный интерлиньяж склеивает строки, слишком просторный разрывает абзац на отдельные полосы.',
  'Ширина колонки решает не меньше: длинная строка заставляет глаз искать начало следующей.',
  'Классическое правило говорит про шестьдесят знаков в строке, и оно до сих пор работает.',
  'Всё это вместе и называется типографикой, и всё это существует ради одного — чтобы текст читали.'
].join(' ')

const gist = shorten(ARTICLE, 3)
check('a summary comes back', gist.length, 3)
check('every line is from the article', gist.every((line) => ARTICLE.includes(line)), true)
check(
  'in the order they were written',
  gist.every((line, i) => i === 0 || ARTICLE.indexOf(gist[i - 1]) < ARTICLE.indexOf(line)),
  true
)
check('and it is about the subject', gist.join(' ').includes('строк'), true)

check('a short text has no summary worth making', shorten('Слишком коротко.').length, 0)
check('nothing at all gives nothing', shorten('').length, 0)
check('and neither does one long sentence', shorten('а'.repeat(500)).length, 0)
check('asking for more than there is gives what there is', shorten(ARTICLE, 50).length <= 9, true)

/* --------------------------------------------------------------- the words */

// Long enough for the counting to mean anything, as a real page would be.
const LONGER = [ARTICLE, ARTICLE].join(' ')
const words = keywords(LONGER)
check('the subject is among the words', words.includes('интерлиньяж') || words.includes('строки'), true)
check('nothing short gets in', words.every((word) => word.length > 5), true)
check('a text too small has no words worth marking', keywords('раз два три').length, 0)

// The words that are everywhere carry nothing, whatever the language.
const filler = Array.from({ length: 200 }, () => 'который').join(' ') + ' ' + ARTICLE
check('a word in every line is not a keyword', keywords(filler).includes('который'), false)
check('a text just under the floor stays quiet', keywords(ARTICLE).length, 0)

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`gist: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
