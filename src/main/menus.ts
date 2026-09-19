import { t } from './i18n'
import { swapLayout } from '../shared/layout'
import { Menu, clipboard, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { GROUP_COLOURS, type BrowserWindow } from './browser'
import { ocrAvailable } from './ocr'
import { profiles } from './profiles'
import { settings } from './settings'

/** Colour names for the group menu; the palette itself lives in browser.ts. */
const GROUP_COLOUR_NAMES: Record<string, string> = {
  '#7c6cff': 'Сиреневый',
  '#2fbf71': 'Зелёный',
  '#f5a524': 'Янтарный',
  '#e5484d': 'Красный',
  '#38bdf8': 'Голубой',
  '#e879f9': 'Розовый',
  '#94a3b8': 'Серый'
}

/**
 * Floats a video out of the page and over everything else.
 *
 * The element is found where the click was; a page that puts a transparent
 * overlay over its player — most of them do — hands back the overlay instead,
 * so the search also looks inside and around it, and settles for the largest
 * video on the page rather than doing nothing.
 *
 * Run with userGesture, because Chromium will not float a video that nobody
 * asked for, and a context-menu click is somebody asking.
 */
function detachVideo(wc: WebContents, x: number, y: number) {
  const code = `(() => {
    const at = document.elementFromPoint(${x}, ${y})
    const near = at
      ? at.closest('video') ||
        at.querySelector('video') ||
        (at.parentElement && at.parentElement.querySelector('video'))
      : null
    const biggest = [...document.querySelectorAll('video')]
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    const video = near || biggest
    if (!video || !video.requestPictureInPicture) return false
    if (document.pictureInPictureElement === video) {
      document.exitPictureInPicture()
      return true
    }
    video.requestPictureInPicture().catch(() => {})
    return true
  })()`
  void wc.executeJavaScript(code, true).catch(() => undefined)
}

/** Right-click menu inside a web page. */
export function pageContextMenu(
  browser: BrowserWindow,
  wc: WebContents,
  params: Electron.ContextMenuParams
) {
  const items: MenuItemConstructorOptions[] = []
  const has = (value?: string) => typeof value === 'string' && value.length > 0

/** One address, opened as somebody else — the window switches, then loads. */
const openLinkAsProfile = (browser: BrowserWindow, url: string, profileId: string) => {
  browser.switchProfile(profileId)
  browser.newTab(url)
}

  if (has(params.linkURL)) {
    items.push(
      { label: t('Открыть в новой вкладке'), click: () => browser.newTab(params.linkURL, true) },
      { label: t('Открыть в новой вкладке и перейти'), click: () => browser.newTab(params.linkURL) },
      { label: t('Копировать ссылку'), click: () => clipboard.writeText(params.linkURL) },
      { label: t('Открыть во внешнем браузере'), click: () => void shell.openExternal(params.linkURL) }
    )

    /*
     * The same link, somewhere separate.
     *
     * A container is a different jar of cookies in the same window; another
     * profile is a different everything in a window of its own. Both answer
     * the same question — "open this without the rest of my browsing being
     * attached to it" — at two different strengths.
     */
    const containers = settings.get().containers
    if (containers.length > 0) {
      items.push({
        label: t('Открыть в контейнере'),
        submenu: containers.map((box) => ({
          label: `${box.icon} ${box.name}`.trim(),
          click: () => browser.openInContainer(params.linkURL, box.id)
        }))
      })
    }

    const others = profiles.state.profiles.filter((one) => one.id !== profiles.activeId)
    if (others.length > 0) {
      items.push({
        label: t('Открыть в другом профиле'),
        submenu: others.map((one) => ({
          label: one.name,
          click: () => openLinkAsProfile(browser, params.linkURL, one.id)
        }))
      })
    }

    items.push({ type: 'separator' })
  }

  if (params.mediaType === 'image' && has(params.srcURL)) {
    items.push(
      { label: t('Открыть картинку в новой вкладке'), click: () => browser.newTab(params.srcURL, true) },
      { label: t('Копировать адрес картинки'), click: () => clipboard.writeText(params.srcURL) },
      { label: t('Сохранить картинку'), click: () => wc.downloadURL(params.srcURL) },
      {
        // Chromium's own copy flattens transparency onto white, so a logo
        // pasted into anything but a white page arrives in a white box. The
        // page reads the picture into a canvas and hands back PNG bytes.
        label: t('Копировать с прозрачностью'),
        click: () => wc.send('image:copy', params.srcURL)
      },
      {
        label: t('Сохранить картинку в папку…'),
        click: () => void browser.savePictureTo(params.srcURL)
      },
      {
        label: t('Прочитать QR-код'),
        click: () =>
          wc.send('qr:scan', { src: params.srcURL, open: t('Открыть'), copy: t('Копировать') })
      },
      {
        label: t('Текст с картинки'),
        enabled: ocrAvailable(),
        click: () => void browser.readPicture(params.srcURL)
      },
      {
        label: t('Найти эту картинку'),
        click: () => browser.searchByImage(params.srcURL)
      },
      { type: 'separator' }
    )
  }

  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    if (params.mediaType === 'video') {
      items.push({
        label: t('Картинка в картинке'),
        click: () => detachVideo(wc, params.x, params.y)
      })
    }
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
      // Pasting a quote out of a page into a comment box should not bring the
      // page's font with it, and the plain-text paste key is not on every
      // keyboard people actually use.
      {
        role: 'pasteAndMatchStyle',
        label: t('Вставить как текст'),
        enabled: params.editFlags.canPaste
      },
      { role: 'selectAll', label: t('Выделить всё') },
      { type: 'separator' }
    )
    if (has(params.selectionText)) {
      items.push(
        {
          label: t('Исправить раскладку'),
          click: () => wc.insertText(swapLayout(params.selectionText))
        },
        { type: 'separator' }
      )
    }
  } else if (has(params.selectionText)) {
    items.push(
      { role: 'copy', label: t('Копировать') },
      {
        label: t('Искать «{q}»', { q: params.selectionText.slice(0, 24) }),
        click: () => browser.newTab(params.selectionText, false)
      },
      {
        label: t('Перевести'),
        click: () => void browser.translateSelection(wc, params.selectionText)
      },
      { label: t('Озвучить выделенное'), click: () => browser.speakSelection() },
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
    {
      // Choosing the one already beside you is how a split ends: the same
      // gesture both ways round.
      label: browser.inPair(tabId) ? t('Убрать со второй половины') : t('Показать рядом'),
      enabled: many && (browser.inPair(tabId) || tabId !== browser.activeId),
      click: () => browser.splitWith(tabId)
    },
    {
      label: tab.pinned ? t('Открепить вкладку') : t('Закрепить вкладку'),
      click: () => browser.pinTab(tabId)
    },
    {
      label: t('Группа'),
      submenu: [
        { label: t('Новая группа'), click: () => browser.createGroup(tabId) },
        ...(browser.groups.length ? [{ type: 'separator' as const }] : []),
        ...browser.groups
          .filter((group) => group.id !== tab.groupId)
          .map((group) => ({
            label: group.name,
            click: () => browser.addToGroup(tabId, group.id)
          })),
        ...(tab.groupId !== null
          ? [
              { type: 'separator' as const },
              { label: t('Убрать из группы'), click: () => browser.removeFromGroup(tabId) }
            ]
          : [])
      ]
    },
    {
      label: t('В отдельное окно'),
      enabled: many && tab.hasContent,
      click: () => browser.detachTab(tabId)
    },
    {
      label: t('Отметить непрочитанной'),
      enabled: tabId !== browser.activeId && tab.hasContent,
      click: () => browser.markUnread(tabId, true)
    },
    {
      // A tab you are waiting on is one you would otherwise check twenty
      // times. Set a time and it comes back to you instead.
      label: t('Напомнить через'),
      submenu: [
        { label: t('5 минут'), click: () => browser.setTabTimer(tabId, 5) },
        { label: t('15 минут'), click: () => browser.setTabTimer(tabId, 15) },
        { label: t('30 минут'), click: () => browser.setTabTimer(tabId, 30) },
        { label: t('1 час'), click: () => browser.setTabTimer(tabId, 60) },
        { label: t('3 часа'), click: () => browser.setTabTimer(tabId, 180) },
        ...(tab.timerAt
          ? [
              { type: 'separator' as const },
              { label: t('Убрать напоминание'), click: () => browser.setTabTimer(tabId, 0) }
            ]
          : [])
      ]
    },
    { type: 'separator' },
    { label: t('В закладки'), enabled: tab.hasContent, click: () => browser.bookmarkTab(tabId) },
    {
      label: t('Ярлык на рабочем столе'),
      enabled: tab.hasContent,
      click: () => browser.tabShortcut(tabId)
    },
    { type: 'separator' },
    { label: t('Закрыть'), click: () => browser.closeTab(tabId) },
    { label: t('Закрыть остальные'), enabled: many, click: () => browser.closeOthers(tabId) },
    { label: t('Закрыть справа'), enabled: many, click: () => browser.closeToRight(tabId) }
  ]).popup()
}

/** Right-clicking the name over a run of tabs. */
export function groupContextMenu(browser: BrowserWindow, groupId: number) {
  const group = browser.groups.find((g) => g.id === groupId)
  if (!group) return
  const count = browser.tabs.filter((tab) => tab.groupId === groupId).length

  Menu.buildFromTemplate([
    {
      label: group.collapsed ? t('Развернуть группу') : t('Свернуть группу'),
      click: () => browser.toggleGroup(groupId)
    },
    { label: t('Новая вкладка в группе'), click: () => browser.newTabInGroup(groupId) },
    { type: 'separator' },
    { label: t('Переименовать'), click: () => browser.editGroup(groupId, 'rename') },
    {
      label: group.pinned ? t('Открепить группу') : t('Закрепить группу'),
      click: () => browser.pinGroup(groupId)
    },
    {
      label: t('Цвет'),
      submenu: [
        ...GROUP_COLOURS.map((colour) => ({
          label: t(GROUP_COLOUR_NAMES[colour]),
          type: 'radio' as const,
          checked: group.color === colour,
          click: () => browser.setGroupColour(groupId, colour)
        })),
        { type: 'separator' as const },
        { label: t('Свой цвет…'), click: () => browser.editGroup(groupId, 'colour') }
      ]
    },
    { type: 'separator' },
    { label: t('Разгруппировать'), click: () => browser.ungroup(groupId) },
    {
      label: t('Закрыть группу ({n})', { n: count }),
      click: () => browser.closeGroup(groupId)
    }
  ]).popup()
}
