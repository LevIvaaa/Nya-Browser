import { BrowserWindow, app, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { t } from './i18n'
import { log } from './log'

/**
 * The article as a file, without the site around it.
 *
 * "Print to PDF" on a news page gives you the banners, the newsletter box and
 * a footer of unrelated links, spread over nine sheets. What people mean is
 * the thing the reading sheet is already showing — so that is what is printed:
 * the same words, in the same shape, laid out for paper rather than for a
 * window.
 *
 * It happens in a window nobody sees, built from markup that cannot run: no
 * scripts, no network, no page. The source is kept at the foot of the first
 * sheet, because an article printed without where it came from is a thing
 * nobody can check.
 */
export interface ReaderDoc {
  title: string
  byline: string
  url: string
  html: string
}

/** Everything that could run, taken out before anything is loaded. */
function harmless(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(object|embed|link|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string)

/** A name a file can have on any of the three platforms. */
const safeName = (title: string) =>
  (title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) || 'article') + '.pdf'

export async function readerToPdf(doc: ReaderDoc): Promise<boolean> {
  if (!doc.html.trim()) return false
  const where = await dialog.showSaveDialog({
    title: t('В PDF'),
    defaultPath: join(app.getPath('downloads'), safeName(doc.title)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (where.canceled || !where.filePath) return false

  const page = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>',
    '@page { margin: 18mm 16mm }',
    'body { font: 11.5pt/1.55 Georgia, "Times New Roman", serif; color: #14141a; margin: 0 }',
    'h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 6pt }',
    '.by { color: #5a5a66; font-size: 9pt; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1px solid #ddd }',
    '.from { color: #5a5a66; font-size: 8.5pt; word-break: break-all; margin: 0 0 18pt }',
    'p, li { margin: 0 0 8pt; orphans: 3; widows: 3 }',
    'h2, h3 { break-after: avoid; margin: 14pt 0 5pt }',
    'img { max-width: 100%; height: auto }',
    'figure { margin: 10pt 0 }',
    'figcaption { color: #5a5a66; font-size: 9pt }',
    'pre { white-space: pre-wrap; font: 9.5pt ui-monospace, Consolas, monospace; background: #f4f4f7; padding: 8pt; border-radius: 4pt }',
    'blockquote { margin: 10pt 0; padding-left: 10pt; border-left: 2pt solid #ddd; color: #4a4a55 }',
    'a { color: inherit; text-decoration: none }',
    '</style></head><body>',
    `<h1>${escape(doc.title)}</h1>`,
    doc.byline ? `<p class="by">${escape(doc.byline)}</p>` : '',
    doc.url ? `<p class="from">${escape(doc.url)}</p>` : '',
    harmless(doc.html),
    '</body></html>'
  ].join('')

  // Never shown, never navigated anywhere, and allowed to do nothing.
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      javascript: false,
      images: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
    // A moment for pictures that are still arriving; printing an article with
    // holes in it would be worse than printing it a second later.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const pdf = await window.webContents.printToPDF({
      printBackground: false,
      pageSize: 'A4',
      // The margins are in the stylesheet's @page rule, where they can be
      // stated in millimetres rather than in inches nobody thinks in.
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    writeFileSync(where.filePath, pdf)
    shell.showItemInFolder(where.filePath)
    return true
  } catch (error) {
    log('reader pdf failed', String(error))
    return false
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
