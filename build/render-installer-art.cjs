// Installer artwork, rendered from the design itself.
//
//   npm run art
//
// The installer's windows are the design canvas artboards in design/*.dc.html,
// not a re-drawing of them: Chromium renders each one at 2× and the result is
// written out as a bitmap that NSIS shows full-window. Everything static —
// background, logo, headings, buttons, dividers — lives in that bitmap, so the
// installer looks exactly like the design instead of approximately like it.
//
// Only what has to change at run time stays a real control: the install path,
// the progress bar, the checkboxes, and an invisible hit area over each drawn
// button. Those spots are marked in the design with data-nsis="..."; this
// script measures them, hides them from the bitmap, and writes their
// rectangles to build/art-layout.nsh for the NSIS script to place them.
//
// Run under plain Node: it drives one Electron process per page, because
// capturing a second page in the same process wedges the compositor.

const electron = require('electron')
const { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } = require('fs')
const { join, resolve } = require('path')

const root = resolve(__dirname, '..')
const designDir = join(root, 'design')
const outDir =
  process.env.NYA_ART_THEME === 'light'
    ? join(root, 'build', 'art', 'light')
    : join(root, 'build', 'art')

/** Everything is authored at 640×400. */
const WIDTH = 640
const HEIGHT = 400

// Everything is rendered at 2×: on a 125% display a 1× bitmap has to be
// stretched up and text turns to mush. The uninstaller pays for it with ~9 MB
// of bitmaps in the application folder, which next to a 360 MB browser is
// nothing.
const SCALE = process.env.NYA_ART_SCALE ? Number(process.env.NYA_ART_SCALE) : 2

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

/** 'dark' or 'light'; one process renders one of them. */
const THEME = process.env.NYA_ART_THEME === 'light' ? 'light' : 'dark'

/**
 * The design is drawn dark, and this is the same design in light.
 *
 * Colours are swapped in the source of the artboard rather than kept as a
 * second set of files: two copies of nine pages would mean every change made
 * twice, and the one made once is the bug nobody sees until the installer is
 * already out. Anything not in this table stays as it was and is reported, so
 * a colour added to a design shows up here rather than silently staying dark.
 */
const LIGHT = {
  // surfaces
  '#0c0d12': '#f7f8fc',
  '#16171e': '#e8eaf2',
  '24,26,34,0.92': 'rgba(255, 255, 255, 0.94)',
  '12,13,18,0.4': 'rgba(255, 255, 255, 0.55)',
  // ink
  '#f2f3f7': '#14151c',
  '242,243,247,0.62': 'rgba(20, 21, 28, 0.66)',
  '242,243,247,0.55': 'rgba(20, 21, 28, 0.6)',
  '242,243,247,0.38': 'rgba(20, 21, 28, 0.46)',
  // the faint white washes a dark surface uses become faint dark ones
  '255,255,255,0.16': 'rgba(16, 18, 28, 0.18)',
  '255,255,255,0.12': 'rgba(16, 18, 28, 0.13)',
  '255,255,255,0.1': 'rgba(16, 18, 28, 0.11)',
  '255,255,255,0.08': 'rgba(16, 18, 28, 0.09)',
  '255,255,255,0.07': 'rgba(16, 18, 28, 0.08)',
  '255,255,255,0.06': 'rgba(16, 18, 28, 0.07)',
  '255,255,255,0.055': 'rgba(16, 18, 28, 0.065)',
  '255,255,255,0.05': 'rgba(16, 18, 28, 0.06)',
  // shadows, which on white are a hint rather than a hole
  '0,0,0,0.85': 'rgba(22, 24, 46, 0.16)',
  '0,0,0,0.45': 'rgba(22, 24, 46, 0.10)',
  // the brand, a shade deeper so white text on it still reads
  '#7c6cff': '#6a58f5',
  '#9c90ff': '#7d6cf7',
  '#a99fff': '#8f81f8',
  '124,108,255,0.9': 'rgba(106, 88, 245, 0.9)',
  '124,108,255,0.85': 'rgba(106, 88, 245, 0.5)',
  '124,108,255,0.45': 'rgba(106, 88, 245, 0.45)',
  '124,108,255,0.4': 'rgba(106, 88, 245, 0.4)',
  '124,108,255,0.35': 'rgba(106, 88, 245, 0.35)',
  '124,108,255,0.32': 'rgba(106, 88, 245, 0.32)',
  '124,108,255,0.25': 'rgba(106, 88, 245, 0.22)',
  '124,108,255,0.16': 'rgba(106, 88, 245, 0.14)'
  // #0a84ff, #2fbf71, #e5484d, #f5a524, #00b8a9, #e255a1 and #ffffff are
  // left alone: they are accents and status colours, and they read on both.
}

const reported = new Set()

/** The same markup with the light palette in it. */
function toLight(html) {
  return html
    .replace(/#[0-9a-fA-F]{6}/g, (hex) => LIGHT[hex.toLowerCase()] ?? hex)
    .replace(/rgba\(([^)]*)\)/g, (whole, inside) => {
      const key = inside.split(',').map((part) => part.trim()).join(',')
      const found = LIGHT[key]
      if (found) return found
      if (!reported.has(key)) {
        reported.add(key)
        console.warn(`  light: no colour for rgba(${key}) — left as it was`)
      }
      return whole
    })
}

/**
 * Turns build/installer-strings/<code>.json into the INI files the installer
 * reads at run time. GetPrivateProfileString only understands Unicode when the
 * file is UTF-16LE with a BOM, which is the whole reason this is generated
 * rather than checked in as JSON the script could not parse anyway.
 */
function buildStrings(outDir) {
  const from = join(root, 'build', 'installer-strings')
  const files = readdirSync(from).filter((name) => name.endsWith('.json'))
  mkdirSync(outDir, { recursive: true })
  for (const file of files) {
    const strings = JSON.parse(readFileSync(join(from, file), 'utf8'))
    const body =
      '[strings]\r\n' +
      Object.entries(strings)
        .map(([key, value]) => `${key}=${String(value).replace(/[\r\n]+/g, ' ')}`)
        .join('\r\n') +
      '\r\n'
    writeFileSync(join(outDir, `lang-${file.replace(/\.json$/, '')}.ini`), '﻿' + body, 'utf16le')
  }
  console.log(`${files.length} installer string files`)
}

/**
 * The pill widths the language strip is baked at, in design pixels of label
 * room. The pill is artwork, so it cannot stretch at run time; the installer
 * measures the language name and blits the narrowest strip that holds it,
 * which is how the pill ends up hugging "ไทย" and "Português (Portugal)"
 * alike. The same ladder is spelled out in build/installer.nsh.
 */
const PILL_WIDTHS = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140]

/** The artboards to bake, the names NSIS knows them by, and their checkboxes. */
const PAGES = [
  { file: 'Main', name: 'welcome', boxes: ['box-desktop', 'box-default'], pills: 'lang-strip' },
  { file: 'Installing', name: 'installing' },
  { file: 'Updating', name: 'updating' },
  { file: 'Installed', name: 'installed' },
  { file: 'UninstallConfirm', name: 'un-confirm', boxes: ['box-wipe'] },
  { file: 'UninstallProgress', name: 'un-progress' },
  { file: 'UninstallDone', name: 'un-done' }
]

/** Bottom-up 24-bit BMP from Electron's BGRA bitmap: the format NSIS reads. */
function writeBmp(file, bgra, width, height) {
  const stride = (width * 3 + 3) & ~3
  const bmp = Buffer.alloc(54 + stride * height)
  bmp.write('BM', 0, 'ascii')
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(width, 18)
  bmp.writeInt32LE(height, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(stride * height, 34)
  bmp.writeInt32LE(2835, 38)
  bmp.writeInt32LE(2835, 42)

  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * width * 4
    const target = 54 + y * stride
    for (let x = 0; x < width; x++) {
      bmp[target + x * 3] = bgra[source + x * 4]
      bmp[target + x * 3 + 1] = bgra[source + x * 4 + 1]
      bmp[target + x * 3 + 2] = bgra[source + x * 4 + 2]
    }
  }

  writeFileSync(file, bmp)
  return bmp.length
}

// --------------------------------------------------------------------- driver
if (!process.versions.electron) {
  const { execFileSync } = require('child_process')

  mkdirSync(outDir, { recursive: true })
  const env = { ...process.env }
  // Claude Code and other Electron hosts set this, and it would make the child
  // run as bare Node and never open a window.
  delete env.ELECTRON_RUN_AS_NODE

  const layout = []
  for (const theme of ['dark', 'light']) {
    console.log(`--- ${theme}`)
    for (const page of PAGES) {
      execFileSync(electron, [__filename, page.name], {
        stdio: 'inherit',
        env: { ...env, NYA_ART_SCALE: String(page.scale ?? 2), NYA_ART_THEME: theme }
      })
      // Both themes measure the same rectangles — the palette moves nothing —
      // so the layout is taken once and the second pass's copy discarded.
      const where = theme === 'light' ? join(outDir, 'light') : outDir
      const fragment = join(where, `.layout-${page.name}.nsh`)
      if (theme === 'dark') layout.push(readFileSync(fragment, 'utf8').trim())
      rmSync(fragment)
    }
  }

  const header = [
    '; Generated by build/render-installer-art.cjs — do not edit.',
    '; Where the live controls go, measured in the rendered design.'
  ]
  writeFileSync(join(root, 'build', 'art-layout.nsh'), header.concat(layout).join('\n') + '\n')
  console.log('art-layout.nsh written')
  buildStrings(outDir)
  process.exit(0)
}

// ------------------------------------------------------------------ one page
const { app, BrowserWindow } = electron
const page = PAGES.find((candidate) => process.argv.includes(candidate.name))
if (!page) throw new Error('no page named on the command line')

/**
 * A .dc.html artboard is a canvas document: the design lives inside <x-dc>, its
 * stylesheet inside <helmet>, and <script src="./support.js"> is a placeholder
 * the canvas runtime replaces. A plain browser needs none of that.
 */
function toStandalone(file) {
  const source = readFileSync(join(designDir, `${file}.dc.html`), 'utf8')
  const style = source.match(/<helmet>([\s\S]*?)<\/helmet>/)
  const body = source.match(/<x-dc>([\s\S]*?)<\/x-dc>/)
  if (!style || !body) throw new Error(`${file}: not a design artboard`)

  const markup = body[1]
    .replace(/<helmet>[\s\S]*?<\/helmet>/, '')
    // The logo is a canvas file entry; on disk it sits next to the artboard.
    .replace(/"nya-logo\.png"/g, JSON.stringify(join(designDir, 'nya-logo.png').replace(/\\/g, '/')))
    // The design was drawn against a sample version.
    .replace(/1\.0\.0/g, version)

  const page = `<!doctype html><html><head><meta charset="utf-8">${style[1]}</head><body>${markup}</body></html>`
  return THEME === 'light' ? toLight(page) : page
}

/** CSS forcing every checkbox into one state, so both can be cropped out. */
const BOX_CSS = {
  on:
    `[data-nsis^="box-"] { background: ${THEME === 'light' ? '#6a58f5' : '#7c6cff'} !important;` +
    ' border: 0 !important; }' +
    '[data-nsis^="box-"] svg { display: block !important; }',
  off:
    '[data-nsis^="box-"] { background: transparent !important;' +
    ` border: 1px solid ${THEME === 'light' ? 'rgba(16,18,28,0.22)' : 'rgba(255,255,255,0.16)'} !important; }` +
    '[data-nsis^="box-"] svg { display: none !important; }'
}

/** What never belongs in the bitmap, because a live control covers it. */
const HIDE_CSS =
  '[data-nsis="progress"], [data-nsis="path"], [data-nsis="version"],' +
  ' [data-nsis-hide], [data-nsis^="box-"] { visibility: hidden !important; }' +
  // The switch offers the theme you are not in: the sun is drawn for the dark
  // installer and the moon for the light one, so the other glyph goes.
  ` [data-theme-glyph="${THEME === 'light' ? 'dark' : 'light'}"] { display: none !important; }`

async function shoot(window, css) {
  const key = css ? await window.webContents.insertCSS(css) : null
  // A frame for the style to land before the pixels are read.
  await new Promise((done) => setTimeout(done, 150))
  // Capture exactly the artboard's rectangle, not the window: the window comes
  // out a few device pixels larger than asked (DIP rounding), and a whole-page
  // capture then carries a strip of empty body background down the right and
  // bottom edges — which showed up in the installer as a dark band.
  const image = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: WIDTH * SCALE,
    height: HEIGHT * SCALE
  })
  if (key) await window.webContents.removeInsertedCSS(key)
  return image.getSize().width === WIDTH * SCALE
    ? image
    : image.resize({ width: WIDTH * SCALE, height: HEIGHT * SCALE, quality: 'best' })
}

function cropBmp(image, rect, file) {
  const crop = image.crop({
    x: Math.round(rect.x * SCALE),
    y: Math.round(rect.y * SCALE),
    width: Math.round(rect.width * SCALE),
    height: Math.round(rect.height * SCALE)
  })
  const size = crop.getSize()
  writeBmp(file, crop.toBitmap(), size.width, size.height)
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true })

  const window = new BrowserWindow({
    // Rendered at 2× so the bitmap still looks sharp on a 125% display, and
    // parked off-screen because a hidden window has nothing to capture.
    width: WIDTH * SCALE,
    height: HEIGHT * SCALE,
    x: -4000,
    y: 0,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    show: true,
    webPreferences: { zoomFactor: SCALE, backgroundThrottling: false }
  })

  const html = join(outDir, `.${page.name}.html`)
  writeFileSync(html, toStandalone(page.file), 'utf8')
  await window.loadFile(html)
  // Electron remembers a zoom factor per origin, so a previous run at 2× would
  // otherwise carry over into a page meant to be rendered at 1×.
  window.webContents.setZoomFactor(SCALE)
  await new Promise((done) => setTimeout(done, 300))

  const rects = await window.webContents.executeJavaScript(`
    Object.fromEntries([...document.querySelectorAll('[data-nsis]')].map((el) => {
      const r = el.getBoundingClientRect()
      return [el.dataset.nsis, { x: r.x, y: r.y, width: r.width, height: r.height }]
    }))
  `)

  const defines = []
  const prefix = `ART_${page.name.replace(/-/g, '_').toUpperCase()}`
  for (const [key, rect] of Object.entries(rects)) {
    const name = `${prefix}_${key.replace(/-/g, '_').toUpperCase()}`
    defines.push(`!define ${name}_X ${Math.round(rect.x)}`)
    defines.push(`!define ${name}_Y ${Math.round(rect.y)}`)
    defines.push(`!define ${name}_W ${Math.round(rect.width)}`)
    defines.push(`!define ${name}_H ${Math.round(rect.height)}`)
  }
  if (page.pills) defines.push(`!define ${prefix}_LANG_PILLS "${PILL_WIDTHS.join(' ')}"`)
  writeFileSync(join(outDir, `.layout-${page.name}.nsh`), defines.join('\n'))

  if (page.boxes) {
    for (const state of ['on', 'off']) {
      const image = await shoot(window, BOX_CSS[state])
      for (const box of page.boxes) {
        cropBmp(image, rects[box], join(outDir, `${page.name}-${box}-${state}.bmp`))
      }
    }
  }

  // One strip per pill width. Each is the whole patch of artwork the pill sits
  // on, so blitting it both draws the new pill and wipes the old one.
  if (page.pills) {
    for (const width of PILL_WIDTHS) {
      const image = await shoot(
        window,
        `${HIDE_CSS} [data-nsis="lang"] { min-width: ${width}px !important; }`
      )
      cropBmp(image, rects[page.pills], join(outDir, `${page.name}-lang-${width}.bmp`))
    }
  }

  const baked = await shoot(window, HIDE_CSS)
  const bytes = writeBmp(join(outDir, `${page.name}.bmp`), baked.toBitmap(), WIDTH * SCALE, HEIGHT * SCALE)
  console.log(`${page.name}.bmp — ${WIDTH * SCALE}×${HEIGHT * SCALE}, ${(bytes / 1024).toFixed(0)} KB`)

  rmSync(html)
  app.quit()
})
