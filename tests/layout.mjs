// ---------------------------------------------------------------------------
// Раскладка: перевод текста между ЙЦУКЕН и QWERTY, и решение о том, когда
// вообще предлагать перевод.
//
// Таблица проверяется целиком: если в одну из строк добавить знак и забыть про
// вторую, всё, что стоит после него, поедет на одну клавишу — и «Привет»
// станет «Ghbdtm». Молча.
//
// Про looksSwapped: цена ошибки несимметрична. Лишнее «да» — это пункт меню,
// который висит всегда и который перестают замечать. Лишнее «нет» — это
// функция, которой не видно. Поэтому здесь проверяются обе стороны: и то, что
// на белиберде он срабатывает, и то, что на обычном тексте молчит.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0

function is(got, want, what) {
  if (got === want) {
    passed++
  } else {
    failed++
    console.log(`  ✗ ${what}: получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`)
  }
}

// Модуль на TypeScript, и типов в нём ровно два слова. Снимаем их и запускаем
// как есть — так проверяется тот же файл, который идёт в сборку, а не копия.
const source = readFileSync(new URL('../src/shared/layout.ts', import.meta.url), 'utf8')
const plain = source
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/: (string|boolean|number)\b/g, '')
  .replace(/\bexport /g, '')
  .replace(/new Map<[^>]*>\(\)/g, 'new Map()')
const { swapLayout, looksSwapped } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(plain + '\nexport { swapLayout, looksSwapped }', 'utf8').toString('base64')
)

/* ------------------------------------------------------------------ таблица */

const RU = /const RU = '([^']*)'/.exec(source)[1]
const EN = /const EN = "((?:[^"\\]|\\.)*)"/.exec(source)[1].replace(/\\(.)/g, '$1')
is(RU.length, EN.length, 'в обеих раскладках одинаковое число клавиш')
is(new Set(RU).size, RU.length, 'в русской раскладке нет повторов')
is(new Set(EN).size, EN.length, 'в английской раскладке нет повторов')

/* -------------------------------------------------------------- перевод */

is(swapLayout('Ghbdtn'), 'Привет', 'английская белиберда становится русским словом')
is(swapLayout('Привет'), 'Ghbdtn', 'и обратно')
is(swapLayout('[jhjij'), 'хорошо', 'скобка — это «х»')
is(swapLayout('password'), 'зфыыцщкв', 'английское слово по-русски')
is(swapLayout(swapLayout('Привет')), 'Привет', 'туда и обратно возвращает исходное')
is(swapLayout('2 + 2 = 4'), '2 + 2 = 4', 'без букв ничего не меняется')
is(swapLayout(''), '', 'пустая строка остаётся пустой')

/* ----------------------------------------------------- когда предлагать */

for (const bad of [
  'Ghbdtn',
  'ghbdtn',
  '[jhjij',
  'ыфм',
  'Ъхжэ',
  // Отдельное «ytn» («нет») не ловится: «y» считается гласной, иначе пункт
  // вылезал бы на «try» и «gym». Во фразе следов всегда больше одного.
  'ytn, jy ye;ty'
]) {
  is(looksSwapped(bad), true, `предлагаем на «${bad}»`)
}

for (const good of [
  'Привет, как дела',
  'hello world',
  'strength',
  'Сегодня хорошая погода',
  'The quick brown fox jumps over the lazy dog',
  'ок',
  '12345',
  '—'
]) {
  is(looksSwapped(good), false, `молчим на «${good}»`)
}

// Слишком длинное выделение — это уже не описка в одном слове.
is(looksSwapped('Ghbdtn '.repeat(80)), false, 'на огромном куске молчим')

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
