/**
 * Text typed in the wrong keyboard layout, put right.
 *
 * Everyone who types in two alphabets does this several times a day: half a
 * sentence goes in as `ghbdtn` before the eye catches it. The fix is purely
 * positional — every key carries two letters, and this swaps one for the other.
 */

const RU = 'йцукенгшщзхъфывапролджэячсмитьбю.ёЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,Ё"№;:?'
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,./`QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?~@#$^&"

const toEn = new Map<string, string>()
const toRu = new Map<string, string>()
for (let i = 0; i < RU.length; i += 1) {
  toEn.set(RU[i], EN[i])
  toRu.set(EN[i], RU[i])
}

/**
 * Swaps the layout of a piece of text. The direction is decided by counting:
 * whichever alphabet the text is mostly in is the one it came out of wrong.
 */
export function swapLayout(text: string): string {
  let cyrillic = 0
  let latin = 0
  for (const ch of text) {
    if (/[а-яёА-ЯЁ]/.test(ch)) cyrillic += 1
    else if (/[a-zA-Z]/.test(ch)) latin += 1
  }
  const table = cyrillic > latin ? toEn : toRu
  let out = ''
  for (const ch of text) out += table.get(ch) ?? ch
  return out
}
