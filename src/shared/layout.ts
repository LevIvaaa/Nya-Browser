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

/** Есть ли в строке кириллица. */
function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text)
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

/** Похоже ли, что текст набран не в той раскладке. */
export function looksSwapped(text: string): boolean {
  const cut = text.trim()
  if (cut.length < 2 || cut.length > 400) return false
  // Строка из одних знаков препинания ничего не говорит.
  return hasCyrillic(cut) || /[A-Za-z]/.test(cut)
}
