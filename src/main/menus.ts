import { t } from './i18n'
import { Menu, clipboard, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { BrowserWindow } from './browser'

/** Right-click menu inside a web page. */
export function pageContextMenu(
  browser: BrowserWindow,
  wc: WebContents,
  params: Electron.ContextMenuParams
) {
  const items: MenuItemConstructorOptions[] = []
  const has = (value?: string) => typeof value === 'string' && value.length > 0

  if (has(params.linkURL)) {
    items.push(
      { label: t('Открыть в новой вкладке'), click: () => browser.newTab(params.linkURL, true) },
      { label: t('Открыть в новой вкладке и перейти'), click: () => browser.newTab(params.linkURL) },
      { label: t('Копировать ссылку'), click: () => clipboard.writeText(params.linkURL) },
      { label: t('Открыть во внешнем браузере'), click: () => void shell.openExternal(params.linkURL) },
      { type: 'separator' }
    )
  }

  if (params.mediaType === 'image' && has(params.srcURL)) {
    items.push(
      { label: t('Открыть картинку в новой вкладке'), click: () => browser.newTab(params.srcURL, true) },
      { label: t('Копировать адрес картинки'), click: () => clipboard.writeText(params.srcURL) },
      { label: t('Сохранить картинку'), click: () => wc.downloadURL(params.srcURL) },
      { type: 'separator' }
    )
  }

  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    items.push(
      { label: t('Сохранить файл'), click: () => wc.downloadURL(params.srcURL) },
      { label: t('Копировать адрес файла'), click: () => clipboard.writeText(params.srcURL) },
      { type: 'separator' }
    )
  }

  if (params.isEditable) {
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 5)
      if (suggestions.length === 0) {
        items.push({ label: t('Вариантов нет'), enabled: false })
      } else {
        for (const word of suggestions) {
          items.push({ label: word, click: () => wc.replaceMisspelling(word) })
        }
      }
      items.push(
        {
          label: t('Добавить в словарь'),
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        },
        { type: 'separator' }
      )
    }
    items.push(
      { role: 'undo', label: t('Отменить'), enabled: params.editFlags.canUndo },
      { role: 'redo', label: t('Повторить'), enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: t('Вырезать'), enabled: params.editFlags.canCut },
      { role: 'copy', label: t('Копировать'), enabled: params.editFlags.canCopy },
      { role: 'paste', label: t('Вставить'), enabled: params.editFlags.canPaste },
      { role: 'selectAll', label: t('Выделить всё') },
      { type: 'separator' }
    )
  } else if (has(params.selectionText)) {
    items.push(
      { role: 'copy', label: t('Копировать') },
      {
        label: t('Искать «{q}»', { q: params.selectionText.slice(0, 24) }),
        click: () => browser.newTab(params.selectionText, false)
      },
      { type: 'separator' }
    )
  }

  items.push(
    { label: t('Назад'), enabled: wc.navigationHistory.canGoBack(), click: () => browser.goBack() },
    { label: t('Вперёд'), enabled: wc.navigationHistory.canGoForward(), click: () => browser.goForward() },
    { label: t('Обновить'), click: () => browser.reload() },
    { type: 'separator' },
    { label: t('Сохранить в закладки'), click: () => browser.bookmarkCurrent() },
    { label: t('Копировать адрес страницы'), click: () => clipboard.writeText(wc.getURL()) },
    { type: 'separator' },
    { label: t('Инструменты разработчика'), click: () => wc.inspectElement(params.x, params.y) }
  )

  Menu.buildFromTemplate(items).popup()
}

/**
 * Right-click inside the browser's own UI — the command palette, the settings
 * fields, the find bar. Only what a text field can answer for: paste into the
 * search box was the whole request, and a page-style menu with "Назад" and
 * developer tools would be nonsense here. Empty click points get no menu at
 * all rather than a stub.
 */
export function uiContextMenu(wc: WebContents, params: Electron.ContextMenuParams) {
  const items: MenuItemConstructorOptions[] = []

  if (params.isEditable) {
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) })
      }
      items.push(
        {
          label: t('Добавить в словарь'),
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        },
        { type: 'separator' }
      )
    }
    items.push(
      { role: 'undo', label: t('Отменить'), enabled: params.editFlags.canUndo },
      { role: 'redo', label: t('Повторить'), enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: t('Вырезать'), enabled: params.editFlags.canCut },
      { role: 'copy', label: t('Копировать'), enabled: params.editFlags.canCopy },
      { role: 'paste', label: t('Вставить'), enabled: params.editFlags.canPaste },
      { role: 'selectAll', label: t('Выделить всё'), enabled: params.editFlags.canSelectAll }
    )
  } else if (params.selectionText.trim()) {
    items.push({ role: 'copy', label: t('Копировать') })
  }

  if (items.length > 0) Menu.buildFromTemplate(items).popup()
}

/** Right-click menu on a tab in the strip or rail. */
export function tabContextMenu(browser: BrowserWindow, tabId: number) {
  const tab = browser.tabs.find((t) => t.id === tabId)
  if (!tab) return
  const many = browser.tabs.length > 1

  Menu.buildFromTemplate([
    { label: t('Обновить'), click: () => browser.reloadTab(tabId) },
    { label: t('Дублировать'), click: () => browser.duplicateTab(tabId) },
    {
      label: tab.muted ? t('Включить звук') : t('Выключить звук'),
      click: () => browser.toggleMute(tabId)
    },
    {
      label: t('Усыпить вкладку'),
      enabled: tab.hasContent && tabId !== browser.activeId,
      click: () => browser.sleepTab(tabId)
    },
    { type: 'separator' },
    { label: t('В закладки'), enabled: tab.hasContent, click: () => browser.bookmarkTab(tabId) },
    { type: 'separator' },
    { label: t('Закрыть'), click: () => browser.closeTab(tabId) },
    { label: t('Закрыть остальные'), enabled: many, click: () => browser.closeOthers(tabId) },
    { label: t('Закрыть справа'), enabled: many, click: () => browser.closeToRight(tabId) }
  ]).popup()
}
