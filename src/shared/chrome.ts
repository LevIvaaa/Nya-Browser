/**
 * The pieces of the browser's own chrome that a person is allowed to arrange:
 * the buttons on the toolbar and the rows in the menu.
 *
 * Both lists live here rather than in the components that draw them because
 * three places need to agree on them — the settings page that offers them, the
 * toolbar and menu that lay them out, and the checking that refuses an id
 * nothing knows how to draw.
 */

/** Every button the toolbar can be asked to show, and what it is called. */
export const TOOLBAR_BUTTONS = [
  { id: 'back', name: 'Назад' },
  { id: 'forward', name: 'Вперёд' },
  { id: 'reload', name: 'Обновить' },
  { id: 'home', name: 'Стартовая страница' },
  { id: 'address', name: 'Адресная строка' },
  { id: 'new-tab', name: 'Новая вкладка' },
  { id: 'bookmark', name: 'В закладки' },
  { id: 'bookmarks', name: 'Закладки' },
  { id: 'history', name: 'История' },
  { id: 'downloads', name: 'Загрузки' },
  { id: 'reader', name: 'Режим чтения' },
  { id: 'translate', name: 'Перевести страницу' },
  { id: 'find', name: 'Найти на странице' },
  { id: 'shot', name: 'Снимок страницы' },
  { id: 'extensions', name: 'Расширения' },
  { id: 'media', name: 'Медиа' },
  { id: 'profile', name: 'Профиль' },
  { id: 'menu', name: 'Меню' },
  { id: 'space', name: 'Промежуток' }
] as const

export const TOOLBAR_IDS: readonly string[] = TOOLBAR_BUTTONS.map((one) => one.id)

/**
 * The buttons the toolbar cannot be left without.
 *
 * The address bar is where a browser is driven from and the menu is where
 * everything that was taken off the toolbar went; a toolbar without them is a
 * window somebody would have to reinstall the browser to get out of.
 */
export const TOOLBAR_REQUIRED = ['address', 'menu'] as const

/** Every row the main menu can show, in the order it comes. */
export const MENU_ROWS = [
  { id: 'new-tab', name: 'Новая вкладка' },
  { id: 'new-window', name: 'Новое окно' },
  { id: 'new-private-window', name: 'Приватное окно' },
  { id: 'bookmarks', name: 'Закладки' },
  { id: 'history', name: 'История' },
  { id: 'downloads', name: 'Загрузки' },
  { id: 'passwords', name: 'Пароли' },
  { id: 'tasks', name: 'Задачи' },
  { id: 'find', name: 'Найти на странице' },
  { id: 'print', name: 'Печать' },
  { id: 'zoom', name: 'Масштаб' },
  { id: 'settings', name: 'Настройки' }
] as const

export const MENU_IDS: readonly string[] = MENU_ROWS.map((one) => one.id)
