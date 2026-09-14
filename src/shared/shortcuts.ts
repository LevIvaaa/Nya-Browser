/**
 * The commands a key can be bound to, and the one spelling of a key
 * combination both sides of the app agree on.
 *
 * Everything the browser does on a keypress used to live in one switch inside
 * the window, which meant the list of shortcuts existed nowhere: the settings
 * page retyped it by hand and the two drifted. Now the table is the truth —
 * the window dispatches from it, the settings page draws it, and a person can
 * change a line of it.
 *
 * Not everything is here on purpose. Ctrl+1…9, the zoom keys, Escape and the
 * editing keys in our own fields stay where they are: they are what the key
 * *is* on this platform, and a browser that lets you rebind Ctrl+C has
 * stopped being a browser.
 */

export interface ShortcutCommand {
  id: string
  /** Russian is the source language; the settings page runs it through t(). */
  label: string
  /** What it answers to out of the box. Empty means nothing until asked. */
  combo: string
}

export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  { id: 'new-tab', label: 'Новая вкладка', combo: 'Ctrl+T' },
  { id: 'close-tab', label: 'Закрыть вкладку', combo: 'Ctrl+W' },
  { id: 'reopen-tab', label: 'Вернуть вкладку', combo: 'Ctrl+Shift+T' },
  { id: 'next-tab', label: 'Следующая вкладка', combo: 'Ctrl+Tab' },
  { id: 'prev-tab', label: 'Предыдущая вкладка', combo: 'Ctrl+Shift+Tab' },
  { id: 'new-window', label: 'Новое окно', combo: 'Ctrl+N' },
  { id: 'new-private-window', label: 'Приватное окно', combo: 'Ctrl+Shift+N' },
  { id: 'focus-address', label: 'Адресная строка', combo: 'Ctrl+L' },
  { id: 'reload', label: 'Обновить', combo: 'Ctrl+R' },
  { id: 'back', label: 'Назад', combo: 'Alt+ArrowLeft' },
  { id: 'forward', label: 'Вперёд', combo: 'Alt+ArrowRight' },
  { id: 'bookmark', label: 'Добавить в закладки', combo: 'Ctrl+D' },
  { id: 'find', label: 'Поиск по странице', combo: 'Ctrl+F' },
  { id: 'downloads', label: 'Загрузки', combo: 'Ctrl+J' },
  { id: 'history', label: 'История', combo: 'Ctrl+H' },
  { id: 'bookmarks', label: 'Закладки', combo: 'Ctrl+Shift+O' },
  { id: 'settings', label: 'Настройки', combo: 'Ctrl+,' },
  { id: 'profiles', label: 'Профили', combo: 'Ctrl+Shift+P' },
  { id: 'toggle-tabs', label: 'Автоскрытие панелей', combo: 'Ctrl+Shift+B' },
  { id: 'fullscreen', label: 'Полный экран', combo: 'F11' },
  { id: 'devtools', label: 'Инструменты разработчика', combo: 'F12' },
  { id: 'translate-selection', label: 'Перевести', combo: '' },
  { id: 'capture-area', label: 'Снимок области', combo: 'Ctrl+Shift+S' },
  { id: 'capture-full', label: 'Снимок всей страницы', combo: '' }
]

export const SHORTCUT_IDS = new Set(SHORTCUT_COMMANDS.map((c) => c.id))

/**
 * A combination is written modifiers-first in a fixed order, then the key:
 * `Ctrl+Shift+T`, `Alt+ArrowLeft`, `F11`. The order is fixed so two spellings
 * of the same chord cannot both exist in the settings file.
 */
const MODS = ['Ctrl', 'Alt', 'Shift'] as const

/**
 * The physical key, not the letter printed on it. `code` is what survives a
 * Russian layout: КeyT is Ctrl+T whether the cap says T or Е, which is the
 * behaviour every browser has and nobody notices until it is missing.
 */
function keyName(code: string, key: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  switch (code) {
    case 'Comma':
      return ','
    case 'Period':
      return '.'
    case 'Slash':
      return '/'
    case 'Minus':
      return '-'
    case 'Equal':
      return '='
    case 'BracketLeft':
      return '['
    case 'BracketRight':
      return ']'
    case 'Backquote':
      return '`'
    case 'Semicolon':
      return ';'
    case 'Quote':
      return "'"
    case 'Backslash':
      return '\\'
    case 'Space':
      return 'Space'
    default:
      break
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  // Arrows, Tab, Enter, Delete, Home, End, PageUp… come through as they are.
  if (/^[A-Za-z]/.test(code) && code.length > 1) return code
  return key.length === 1 ? key.toUpperCase() : key
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta)(Left|Right)?$/

export interface KeyLike {
  code?: string
  key: string
  control?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
}

/**
 * Turns a keypress into a combination, or an empty string when the press is
 * only a modifier being held down — which is most of what arrives while
 * somebody is reaching for a chord.
 */
export function comboOf(input: KeyLike): string {
  const code = input.code ?? ''
  if (MODIFIER_CODES.test(code) || ['Control', 'Alt', 'Shift', 'Meta'].includes(input.key)) return ''
  const name = keyName(code, input.key)
  if (!name) return ''
  const parts: string[] = []
  if (input.control || input.meta) parts.push('Ctrl')
  if (input.alt) parts.push('Alt')
  if (input.shift) parts.push('Shift')
  parts.push(name)
  return parts.join('+')
}

/** True for a string that could have come out of comboOf(). */
export function isCombo(value: string): boolean {
  const parts = value.split('+')
  const key = parts.pop() ?? ''
  if (!key || key.length > 12) return false
  if (!/^[A-Za-z0-9]+$|^[,.\/\-=[\]`;'\\]$/.test(key)) return false
  const seen = new Set<string>()
  for (const part of parts) {
    if (!MODS.includes(part as (typeof MODS)[number])) return false
    if (seen.has(part)) return false
    seen.add(part)
  }
  // A bare letter is not a shortcut: it is typing.
  return parts.length > 0 || /^(F([1-9]|1[0-9]|2[0-4]))$/.test(key)
}

/** For the eye: `Ctrl+Shift+T` reads better with spaces and a real arrow. */
export function prettyCombo(combo: string): string {
  if (!combo) return '—'
  return combo
    .split('+')
    .map((part) => {
      switch (part) {
        case 'ArrowLeft':
          return '←'
        case 'ArrowRight':
          return '→'
        case 'ArrowUp':
          return '↑'
        case 'ArrowDown':
          return '↓'
        default:
          return part
      }
    })
    .join(' + ')
}

/**
 * The table a window dispatches from: combination → command, with the
 * person's own bindings replacing the defaults. An empty override means the
 * command was deliberately left without a key.
 */
export function shortcutMap(overrides: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const command of SHORTCUT_COMMANDS) {
    const combo = Object.prototype.hasOwnProperty.call(overrides, command.id)
      ? overrides[command.id]
      : command.combo
    if (!combo) continue
    // First binding wins, so a half-broken settings file cannot shadow
    // everything with one combination.
    if (!out.has(combo)) out.set(combo, command.id)
  }
  return out
}

/** What a command answers to right now, defaults included. */
export function comboFor(id: string, overrides: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id]
  return SHORTCUT_COMMANDS.find((c) => c.id === id)?.combo ?? ''
}
