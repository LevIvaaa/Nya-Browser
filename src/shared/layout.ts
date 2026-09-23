/**
 * Текст, набранный не в той раскладке.
 *
 * «Ghbdtn» — это «Привет», напечатанное на русской клавиатуре, пока включена
 * английская. Ошибка настолько частая, что её замечают уже после нажатия
 * Enter, и тогда набирают заново.
 *
 * Здесь таблица соответствия клавиш, а не языков: буква переводится в ту,
 * что стоит на том же месте в другой раскладке. Поэтому знаки препинания и
 * цифры тоже на месте — они сдвинуты не меньше букв.
 */

/** Русская раскладка по клавишам ЙЦУКЕН, и та же клавиша в QWERTY. */
const RU = 'йцукенгшщзхъфывапролджэячсмитьбю.ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,ёЁ'
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,./QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?`~"

const RU_TO_EN = new Map<string, string>()
const EN_TO_RU = new Map<string, string>()
for (let i = 0; i < RU.length; i++) {
  RU_TO_EN.set(RU[i], EN[i])
  EN_TO_RU.set(EN[i], RU[i])
}


/**
 * Переводит текст в другую раскладку.
 *
 * Направление определяется по самому тексту: кириллица в нём значит, что
 * человек хотел печатать латиницей, и наоборот. Смешанный текст переводится
 * в ту сторону, которой в нём больше — иначе половина строки осталась бы как
 * была.
 *
 * Символы, которых в таблице нет, остаются собой: пробелы, цифры и всё, что
 * на обеих раскладках одинаково.
 */
export function swapLayout(text: string): string {
  if (!text) return text

  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  // Ни одной буквы — переводить нечего, и гадать о направлении не на чем.
  if (cyrillic === 0 && latin === 0) return text

  const table = cyrillic >= latin ? RU_TO_EN : EN_TO_RU
  let out = ''
  for (const ch of text) out += table.get(ch) ?? ch
  return out
}

const RU_VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'
const EN_VOWELS = 'aeiouyAEIOUY'

/**
 * Похоже ли, что текст набран не в той раскладке.
 *
 * Предлагать исправление на любом выделении нельзя: пункт, который есть
 * всегда, перестают замечать, а меню он занимает у всех. Поэтому здесь ищутся
 * следы, которых в настоящем тексте не бывает.
 *
 * Слово без единой гласной — самый надёжный из них: «Ghbdtn» невозможно ни
 * по-английски, ни по-русски, а «strength» гласную имеет и остаётся в покое.
 * Скобка или апостроф, приклеенные к буквам, — это русские «х», «ъ» и «э»,
 * попавшие на английскую раскладку. Слово, начинающееся с «ы», «ъ» или «ь»,
 * по-русски не начинается никогда.
 *
 * Обратное направление — английский, набранный по-русски, — ловится хуже:
 * «hello» превращается в «рудды», где гласные на месте, и отличить это от
 * настоящего слова по одному виду нельзя. Лучше промолчать, чем показывать
 * пункт наугад.
 */
export function looksSwapped(text: string): boolean {
  const cut = text.trim()
  if (cut.length < 2 || cut.length > 400) return false

  for (const word of cut.split(/\s+/)) {
    const cyrillic = /[Ѐ-ӿ]/.test(word)
    const latin = /[A-Za-z]/.test(word)
    if (!cyrillic && !latin) continue

    // Буквы, склеенные со скобкой, точкой с запятой или кавычкой: так
    // выглядят «хъжэбю», напечатанные на английской раскладке.
    if (latin && !cyrillic && /[A-Za-z][[\]{};:'"<>]|[[\]{};:'"<>][A-Za-z]/.test(word)) {
      return true
    }

    // Русское слово не начинается с «ы», «ъ» и «ь».
    if (cyrillic && /^[ыъьЫЪЬ]/.test(word)) return true

    const letters = word.replace(/[^A-Za-zЀ-ӿ]/g, '')
    if (letters.length < 3) continue
    const vowels = cyrillic ? RU_VOWELS : EN_VOWELS
    let found = false
    for (const ch of letters) {
      if (vowels.includes(ch)) {
        found = true
        break
      }
    }
    if (!found) return true
  }

  return false
}
