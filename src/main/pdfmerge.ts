// ---------------------------------------------------------------------------
// Putting several documents into one file.
//
// Electron can write a PDF (printToPDF) and pdf.js can read one, and there is
// no library here that can splice two PDFs object by object. So the merge is
// done the way a copier does it: every page of every chosen file is drawn, and
// the drawings are laid out one to a sheet and printed to a single PDF.
//
// The honest cost is that text becomes a picture — the result cannot be
// searched or copied from, and it is larger. That is said plainly in the
// dialog rather than discovered afterwards, because the alternative was not
// offering the thing at all.
//
// The window that does the drawing has scripting on (pdf.js is a script) and
// nothing else: no network, no preload, no node, and it is destroyed the
// moment the file is written.
// ---------------------------------------------------------------------------

import { BrowserWindow, app, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { t } from './i18n'
import { log } from './log'

/** How many pages one merge may hold. Past this the window runs out of memory. */
const MAX_PAGES = 400

/**
 * Merges the chosen PDFs into one and asks where to put it.
 *
 * Returns the path it wrote, or null when nothing was chosen or the merge
 * failed. Everything is read here and handed to the window as data: the page
 * never touches the file system.
 */
export async function mergePdfs(parent: BrowserWindow | null, files: string[]): Promise<string | null> {
  const chosen = files.filter((one) => one.toLowerCase().endsWith('.pdf')).slice(0, 40)
  if (chosen.length < 2) return null

  const where = await dialog.showSaveDialog({
    title: t('Сохранить склеенный документ'),
    defaultPath: join(app.getPath('downloads'), 'merged.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (where.canceled || !where.filePath) return null

  const sources: Array<{ name: string; data: string }> = []
  for (const file of chosen) {
    try {
      const bytes = await readFile(file)
      sources.push({ name: basename(file), data: bytes.toString('base64') })
    } catch (error) {
      log('merge: cannot read', file, String(error))
    }
  }
  if (sources.length < 2) return null

  const sheet = new BrowserWindow({
    show: false,
    webPreferences: {
      // pdf.js is a script, so scripting is on; everything else is off, and
      // the only thing this window ever sees is the bytes handed to it.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      offscreen: false
    }
  })

  try {
    // nya://pdf/lib/* serves pdf.js; the page is a data: URL, so it has no
    // origin of its own and can reach nothing but that.
    await sheet.loadURL('nya://pdf/merge')
    const ok = (await sheet.webContents.executeJavaScript(
      `window.__nyaMerge(${JSON.stringify(sources)}, ${MAX_PAGES})`,
      true
    )) as boolean
    if (!ok) throw new Error('merge produced nothing')

    const data = await sheet.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true
    })
    await writeFile(where.filePath, data)
    return where.filePath
  } catch (error) {
    log('merge', String(error))
    return null
  } finally {
    sheet.destroy()
  }
}

/**
 * The page that does the drawing.
 *
 * Served at nya://pdf/merge so it is same-origin with the library it loads.
 * It draws every page of every document into a canvas and lays the canvases
 * out one to a sheet, sized by @page so the printed page matches the original.
 */
export const mergePage = `<!doctype html>
<html><head><meta charset="utf-8"><title>merge</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff }
  .sheet { page-break-after: always; break-after: page; display: block }
  .sheet:last-child { page-break-after: auto; break-after: auto }
  canvas { display: block; width: 100%; height: auto }
  @page { margin: 0 }
</style></head>
<body>
<script type="module">
import { getDocument, GlobalWorkerOptions } from './lib/pdf.min.mjs'
GlobalWorkerOptions.workerSrc = 'nya://pdf/lib/pdf.worker.min.mjs'

/**
 * Draws every page of every document, one to a sheet.
 *
 * Each sheet is sized in points to the page it came from, so a mixture of A4
 * and Letter comes out as a mixture rather than as everything squeezed onto
 * whichever the printer prefers.
 */
window.__nyaMerge = async (sources, maxPages) => {
  let drawn = 0
  for (const source of sources) {
    const bytes = Uint8Array.from(atob(source.data), (ch) => ch.charCodeAt(0))
    const pdf = await getDocument({
      data: bytes,
      cMapUrl: './lib/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: './lib/standard_fonts/',
      wasmUrl: './lib/wasm/',
      iccUrl: './lib/iccs/'
    }).promise

    for (let number = 1; number <= pdf.numPages && drawn < maxPages; number++) {
      const page = await pdf.getPage(number)
      const view = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(view.width)
      canvas.height = Math.round(view.height)
      const context = canvas.getContext('2d')
      await page.render({ canvasContext: context, viewport: view }).promise

      const sheet = document.createElement('div')
      sheet.className = 'sheet'
      // Points, which is what a PDF measures in: the scale above is 2, so the
      // drawn pixels are twice the page and the sheet is the page itself.
      sheet.style.width = (view.width / 2) + 'pt'
      sheet.style.height = (view.height / 2) + 'pt'
      sheet.append(canvas)
      document.body.append(sheet)
      drawn += 1
    }
  }
  // One @page rule per sheet is not possible, so the first page's size wins
  // for the printed sheet; the sheets themselves keep their own size.
  const first = document.querySelector('.sheet')
  if (first) {
    const style = document.createElement('style')
    style.textContent = '@page { size: ' + first.style.width + ' ' + first.style.height + '; margin: 0 }'
    document.head.append(style)
  }
  return drawn > 0
}
</script>
</body></html>`
