// ---------------------------------------------------------------------------
// The browser's PDF viewer (nya://pdf).
//
// Electron ships no PDF plugin. A PDF navigation still produces Chromium's
// embedder page — the stylesheet link is there, `document.contentType` says
// application/pdf — but the <embed> that would hold the plugin is missing, so
// the tab is blank. Checked against a bare Electron window with plugins:true
// and nothing of ours in the way: same empty body. So the browser brings its
// own renderer.
//
// The page is served as an ordinary sandboxed page with no preload, like the
// security self-test. It cannot reach the bytes itself: a PDF behind a login is
// only readable with the tab's cookies, and a page has no business doing that
// fetch. So the main process fetches on its own session and serves the result
// back same-origin at nya://pdf/data, and the viewer only ever sees its own
// origin. Both endpoints refuse to be framed, so no site can wrap one in an
// iframe and go fishing.
// ---------------------------------------------------------------------------

import type { Session } from 'electron'
import { readFile } from 'fs/promises'
import { join, normalize } from 'path'
import { fileURLToPath } from 'url'
import { t } from './i18n'
import { mergePage } from './pdfmerge'

/**
 * Where build/tools/copy-pdfjs.mjs puts the library. Derived from this file's
 * own location rather than from the app path: the built main process lives at
 * out/main/index.js, so the library is always one directory up — true in
 * development, true inside the asar, and true when Electron is pointed at the
 * built entry by hand.
 */
const libDir = () => join(__dirname, '..', 'pdfjs')

const MIME: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.icc': 'application/octet-stream'
}

/** The viewer's own address for a given document. */
export const pdfViewerUrl = (src: string) => `nya://pdf/?src=${encodeURIComponent(src)}`

/**
 * The document a viewer address stands for, or null for anything else. The
 * address bar, bookmarks and reload all use this: what the user asked for was
 * the PDF, and that is what they should see and be able to copy.
 */
export function pdfSource(url: string): string | null {
  if (!/^nya:\/\/pdf(\/|$|\?)/i.test(url)) return null
  try {
    return new URL(url).searchParams.get('src')
  } catch {
    return null
  }
}

/**
 * Whether a main-frame navigation should go to the viewer instead. Only the
 * path is consulted, so a query string or a fragment does not hide a PDF, and
 * a page that merely mentions one in its query is not mistaken for one.
 */
export function looksLikePdf(url: string): boolean {
  if (pdfSource(url)) return false
  try {
    const parsed = new URL(url)
    if (!/^(https?|file):$/.test(parsed.protocol)) return false
    return /\.pdf$/i.test(decodeURIComponent(parsed.pathname))
  } catch {
    return false
  }
}

/** A name for the tab and for the download button. */
function documentName(src: string): string {
  try {
    const path = new URL(src).pathname
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    return name || 'document.pdf'
  } catch {
    return 'document.pdf'
  }
}

/* ------------------------------------------------------------------ serving */

const notFound = () => new Response('Not found', { status: 404 })

/** No site may frame the viewer or the bytes behind it. */
const FRAME_GUARD = "frame-ancestors 'none'"

/**
 * Answers everything under nya://pdf. `ses` is the session the tab belongs to,
 * so a PDF that needs the cookies of a site you are signed in to gets them.
 */
export async function servePdf(request: Request, ses: Session): Promise<Response> {
  const url = new URL(request.url)

  // The page that merges several documents into one. Served here so it is
  // same-origin with the library it loads.
  if (url.pathname === '/merge') {
    return new Response(mergePage, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' nya:; " +
          "img-src data:; connect-src nya:; frame-ancestors 'none'"
      }
    })
  }
  const path = url.pathname.replace(/^\/+/, '')

  if (path === '' || path === 'index.html') {
    const src = url.searchParams.get('src') ?? ''
    return new Response(viewerPage(src), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // The viewer is entirely our own code and our own bytes: nothing is
        // fetched from anywhere else, and the worker is a file we serve.
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          `img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; ` +
          `worker-src 'self' blob:; ${FRAME_GUARD}`
      }
    })
  }

  if (path === 'data') return serveDocument(url.searchParams.get('src') ?? '', ses)
  // The viewer's own script is served rather than written to disk: it is part
  // of the page, and keeping it a separate file is only so the page needs no
  // inline script and its CSP can stay at script-src 'self'.
  if (path === 'lib/viewer.mjs') {
    return new Response(VIEWER_JS, {
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' }
    })
  }
  if (path.startsWith('lib/')) return serveLibrary(path.slice(4))
  return notFound()
}

/**
 * The document itself, on the tab's own session.
 *
 * Read whole rather than streamed. This endpoint answers no range requests, so
 * PDF.js cannot go back for a piece it is missing: a body that arrives in parts
 * buys nothing and a body that stops halfway leaves the viewer waiting on bytes
 * it has no way to ask for again. Six megabytes over HTTP opens in under five
 * seconds this way, which is the size that matters; a slow server is slow
 * either way.
 */
async function serveDocument(src: string, ses: Session): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    return notFound()
  }

  const headers = {
    'content-type': 'application/pdf',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; ${FRAME_GUARD}`
  }

  if (parsed.protocol === 'file:') {
    try {
      const body = await readFile(fileURLToPath(parsed))
      return new Response(new Uint8Array(body), {
        headers: { ...headers, 'content-length': String(body.length) }
      })
    } catch {
      return notFound()
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return notFound()

  try {
    // session.fetch already carries that session's cookies and goes through
    // its request filters, which is exactly what a tab fetching this would do.
    const response = await ses.fetch(src)
    if (!response.ok) return new Response('Upstream ' + response.status, { status: 502 })
    const body = new Uint8Array(await response.arrayBuffer())
    return new Response(body, { headers: { ...headers, 'content-length': String(body.length) } })
  } catch {
    return new Response('Cannot fetch', { status: 502 })
  }
}

/** PDF.js and the resources it asks for, from beside the built main process. */
async function serveLibrary(rest: string): Promise<Response> {
  // Only plain names under the library folder: a crafted path must not walk out
  // of it and start reading the machine.
  if (!/^[\w./-]+$/.test(rest) || rest.includes('..')) return notFound()
  const file = normalize(join(libDir(), rest))
  if (!file.startsWith(normalize(libDir()))) return notFound()
  const ext = rest.slice(rest.lastIndexOf('.'))
  try {
    const body = await readFile(file)
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': 'no-cache'
      }
    })
  } catch {
    return notFound()
  }
}

/* ------------------------------------------------------------------- the page */

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function viewerPage(src: string): string {
  // Everything the page says, translated here rather than in the page: the
  // viewer has no access to the browser's dictionaries.
  const words = {
    loading: t('Открываем документ…'),
    failed: t('Не удалось открыть документ'),
    password: t('Документ защищён паролем'),
    passwordHint: t('Введите пароль, чтобы открыть его'),
    open: t('Открыть'),
    wrongPassword: t('Неверный пароль'),
    of: t('из'),
    page: t('Страница'),
    zoomIn: t('Увеличить'),
    zoomOut: t('Уменьшить'),
    fitWidth: t('По ширине'),
    fitPage: t('Страница целиком'),
    rotate: t('Повернуть'),
    download: t('Загрузить'),
    print: t('Печать страницы'),
    previous: t('Предыдущая страница'),
    next: t('Следующая страница'),
    save: t('Сохранить с заполненным'),
    saved: t('Сохранено'),
    note: t('Заметка'),
    addNote: t('Оставить заметку'),
    noteHint: t('Нажмите на странице, где оставить заметку'),
    pagesPanel: t('Страницы'),
    rotatePage: t('Повернуть страницу'),
    movePageUp: t('Раньше'),
    movePageDown: t('Позже')
  }

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${esc(documentName(src))}</title>
<style>
  :root {
    --bg: #22242c; --bar: #16171d; --line: rgba(255,255,255,.1);
    --text: #f2f3f7; --dim: rgba(242,243,247,.6); --hover: rgba(255,255,255,.09);
    --accent: #7c6cff; --paper: #fff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#e8e9ee; --bar:#f7f8fa; --line:rgba(15,18,34,.12); --text:#14161d;
            --dim:rgba(20,22,29,.6); --hover:rgba(15,18,34,.07); }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 13px/1.4 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column; overflow: hidden;
  }

  #bar {
    display: flex; align-items: center; gap: 4px; flex: none; height: 42px;
    padding: 0 8px; background: var(--bar); border-bottom: 1px solid var(--line);
    user-select: none;
  }
  #bar .spacer { flex: 1 }
  #name {
    max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--dim); padding: 0 6px;
  }
  button {
    display: inline-flex; align-items: center; justify-content: center;
    height: 30px; min-width: 30px; padding: 0 7px; border: 0; border-radius: 7px;
    background: transparent; color: var(--text); cursor: pointer; font: inherit;
  }
  button:hover { background: var(--hover) }
  button:active { transform: translateY(.5px) }
  button:disabled { opacity: .35; cursor: default; background: transparent }
  svg { pointer-events: none }
  #pages-box { display: flex; align-items: center; gap: 4px; color: var(--dim) }
  #page {
    width: 44px; height: 26px; text-align: center; border-radius: 6px;
    border: 1px solid var(--line); background: transparent; color: var(--text); font: inherit;
  }
  #page:focus { outline: 2px solid var(--accent); outline-offset: -1px }
  #zoom-label { min-width: 46px; text-align: center; color: var(--dim); font-variant-numeric: tabular-nums }

  #scroll { flex: 1; overflow: auto; padding: 16px 0 40px; scroll-behavior: auto }
  #doc { display: flex; flex-direction: column; align-items: center; gap: 14px }
  .page {
    position: relative; background: var(--paper); box-shadow: 0 2px 14px rgba(0,0,0,.28);
    border-radius: 2px; overflow: hidden;
  }
  .page canvas { display: block }
  .layer {
    position: absolute; inset: 0; overflow: hidden; opacity: 1; line-height: 1;
    text-align: initial; forced-color-adjust: none; transform-origin: 0 0;
  }
  .layer span, .layer br {
    color: transparent; position: absolute; white-space: pre; cursor: text;
    transform-origin: 0 0;
  }
  .layer ::selection { background: rgba(124,108,255,.42) }

  /* The form fields PDF.js draws for an AcroForm: a document with boxes to
     fill in is a document somebody is meant to fill in. */
  .forms { position: absolute; inset: 0; transform-origin: 0 0 }
  .forms input, .forms textarea, .forms select {
    position: absolute; font: inherit; background: rgba(124,108,255,.09);
    border: 1px solid rgba(124,108,255,.55); border-radius: 2px; color: #111;
    padding: 0 2px; box-sizing: border-box;
  }
  .forms input:focus, .forms textarea:focus { outline: 2px solid var(--accent); }

  /* Notes left on a page. They are the browser's own, kept beside the
     document rather than written into it — a PDF that gains new objects is a
     PDF that some readers will refuse. */
  .notes { position: absolute; inset: 0 }
  .note-pin {
    position: absolute; width: 22px; height: 22px; border-radius: 50%;
    background: #ffd60a; color: #1b1b1f; border: 1px solid rgba(0,0,0,.35);
    font: 600 11px/20px system-ui, sans-serif; text-align: center; cursor: pointer;
    box-shadow: 0 1px 4px rgba(0,0,0,.4);
  }
  .note-open {
    position: absolute; width: 210px; min-height: 76px; padding: 7px 8px;
    background: #ffe58a; color: #1b1b1f; border-radius: 8px; z-index: 6;
    box-shadow: 0 4px 16px rgba(0,0,0,.4); font: 12px/1.45 system-ui, sans-serif;
  }
  .note-open textarea {
    width: 100%; min-height: 54px; resize: vertical; border: none; outline: none;
    background: transparent; font: inherit; color: inherit;
  }
  .note-open .drop { position: absolute; top: 3px; right: 5px; cursor: pointer; opacity: .6 }

  /* The page list down the side, for turning pages round and reordering. */
  #pages {
    width: 168px; flex: none; overflow: auto; border-right: 1px solid var(--line);
    background: var(--bar); padding: 8px; display: none;
  }
  #pages.on { display: block }
  .thumb {
    display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 8px;
    font: 12px system-ui, sans-serif; color: var(--dim); cursor: pointer;
  }
  .thumb:hover { background: var(--hover) }
  .thumb .n { min-width: 22px; font-variant-numeric: tabular-nums }
  .thumb .acts { margin-left: auto; display: flex; gap: 2px; opacity: 0 }
  .thumb:hover .acts { opacity: 1 }
  .thumb .acts button { padding: 2px 5px; font-size: 11px }
  #body { display: flex; flex: 1; min-height: 0 }

  #status {
    position: absolute; inset: 42px 0 0 0; display: flex; align-items: center;
    justify-content: center; flex-direction: column; gap: 14px; color: var(--dim);
    pointer-events: none;
  }
  #status.hidden { display: none }
  #status .box { pointer-events: auto; text-align: center; max-width: 340px }
  #status input {
    width: 100%; height: 32px; margin-top: 10px; padding: 0 10px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bar); color: var(--text); font: inherit;
  }
  #status button.primary {
    margin-top: 10px; background: var(--accent); color: #fff; height: 32px; padding: 0 16px;
  }
  .spin {
    width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line);
    border-top-color: var(--accent); animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg) } }
  @media print {
    #bar, #status { display: none }
    body, #scroll { overflow: visible; background: #fff }
    #scroll { padding: 0 }
    #doc { gap: 0 }
    .page { box-shadow: none; break-after: page; border-radius: 0 }
    .layer { display: none }
  }
</style>
</head>
<body>
<div id="bar">
  <button id="prev" title="${esc(words.previous)}" aria-label="${esc(words.previous)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
  </button>
  <button id="next" title="${esc(words.next)}" aria-label="${esc(words.next)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
  </button>
  <div id="pages-box">
    <input id="page" value="1" inputmode="numeric" aria-label="${esc(words.page)}" />
    <span>${esc(words.of)}</span><span id="count">–</span>
  </div>

  <div class="spacer"></div>
  <span id="name">${esc(documentName(src))}</span>
  <div class="spacer"></div>

  <button id="out" title="${esc(words.zoomOut)}" aria-label="${esc(words.zoomOut)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round"><path d="M5 12h14"/></svg>
  </button>
  <span id="zoom-label">100%</span>
  <button id="in" title="${esc(words.zoomIn)}" aria-label="${esc(words.zoomIn)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
  </button>
  <button id="fit" title="${esc(words.fitWidth)}" aria-label="${esc(words.fitWidth)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 012-2h3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3"/></svg>
  </button>
  <button id="rotate" title="${esc(words.rotate)}" aria-label="${esc(words.rotate)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3-6.7M21 3v6h-6"/></svg>
  </button>
  <button id="print" title="${esc(words.print)}" aria-label="${esc(words.print)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z"/></svg>
  </button>
  <button id="note" title="${esc(words.addNote)}" aria-label="${esc(words.addNote)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H9l-5 4z"/></svg>
  </button>
  <button id="pages-toggle" title="${esc(words.pagesPanel)}" aria-label="${esc(words.pagesPanel)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h6v14H4zM14 5h6v14h-6z"/></svg>
  </button>
  <button id="save" title="${esc(words.download)}" aria-label="${esc(words.download)}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/></svg>
  </button>
</div>

<div id="body">
  <aside id="pages"></aside>
  <div id="scroll"><div id="doc"></div></div>
</div>

<div id="status">
  <div class="box" id="status-box"><div class="spin"></div><p>${esc(words.loading)}</p></div>
</div>

<script type="module" src="./lib/viewer.mjs"></script>
<script type="application/json" id="nya-words">${JSON.stringify(words).replace(/</g, '\u003c')}</script>
</body>
</html>`
}

const VIEWER_JS = String.raw`
import { getDocument, GlobalWorkerOptions, TextLayer, AnnotationLayer } from './pdf.min.mjs'

GlobalWorkerOptions.workerSrc = 'nya://pdf/lib/pdf.worker.min.mjs'

const words = JSON.parse(document.getElementById('nya-words').textContent)
const src = new URLSearchParams(location.search).get('src') || ''

const scroll = document.getElementById('scroll')
const doc = document.getElementById('doc')
const status = document.getElementById('status')
const statusBox = document.getElementById('status-box')
const pageInput = document.getElementById('page')
const countLabel = document.getElementById('count')
const zoomLabel = document.getElementById('zoom-label')

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
/** Pending fit-to-width, cancelled the moment a scale is chosen by hand. */
let resizeTimer = null
let pdf = null
let scale = 1
let fitMode = 'width'
let rotation = 0
let pages = []
let current = 1
/** Waiting for a click that says where a note goes. */
let placingNote = false
/** Notes left on this document, by page: { page, x, y, text }. x and y are
    fractions of the page, so a note stays put at any zoom or rotation. */
let notes = []
/** The order the pages are in, and how far each is turned. Both start as
    the document has them and are only ever changed on purpose. */
let order = []
let turns = []

const px = (value) => Math.floor(value) + 'px'

function say(html) {
  statusBox.innerHTML = html
  status.classList.remove('hidden')
}
const quiet = () => status.classList.add('hidden')

/* ------------------------------------------------------------------ layout */

/** How far one page is turned, on top of however the document is turned. */
const turnOf = (number) => (rotation + (turns[number - 1] || 0)) % 360

function baseViewport(page, number) {
  return page.getViewport({ scale: 1, rotation: (page.rotate + turnOf(number ?? 1)) % 360 })
}

function fitScale(page) {
  const view = baseViewport(page)
  const room = scroll.clientWidth - 48
  const tall = scroll.clientHeight - 40
  // A tab opened in the background, or one whose view has not been laid out
  // yet, reports no room at all. Fitting to that would ask for a page of
  // negative width; the real size arrives later and refits (see below).
  if (room < 80) return 1
  const width = room / view.width
  if (fitMode !== 'page' || tall < 80) return width
  return Math.min(width, tall / view.height)
}

async function build() {
  doc.textContent = ''
  pages = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const holder = document.createElement('div')
    holder.className = 'page'
    holder.dataset.page = String(number)
    const canvas = document.createElement('canvas')
    const layer = document.createElement('div')
    layer.className = 'layer'
    // The form widgets, and the notes, each in a layer of their own: one is
    // the document's, the other is the reader's, and they must not fight over
    // the same element.
    const forms = document.createElement('div')
    forms.className = 'forms'
    const noteLayer = document.createElement('div')
    noteLayer.className = 'notes'
    holder.append(canvas, layer, forms, noteLayer)
    doc.append(holder)
    pages.push({ number, holder, canvas, layer, forms, noteLayer, page: null, rendered: 0, task: null })
  }
  // The first page decides the starting scale, so a fit is right before
  // anything is drawn rather than after a visible reflow.
  const first = await pdf.getPage(1)
  pages[0].page = first
  if (fitMode) scale = fitScale(first)
  await sizeAll()
  observe()
  updateZoomLabel()
}

async function sizeAll() {
  for (const item of pages) {
    if (!item.page) item.page = await pdf.getPage(item.number)
    const view = item.page.getViewport({ scale, rotation: (item.page.rotate + turnOf(item.number)) % 360 })
    item.holder.style.width = px(view.width)
    item.holder.style.height = px(view.height)
    item.rendered = 0
  }
}

/* --------------------------------------------------------------- rendering */

const ratio = () => Math.min(window.devicePixelRatio || 1, 2)

async function render(item) {
  if (item.rendered === scale || !item.page) return
  item.rendered = scale
  if (item.task) {
    item.task.cancel()
    item.task = null
  }
  const view = item.page.getViewport({ scale, rotation: (item.page.rotate + turnOf(item.number)) % 360 })
  const dpr = ratio()
  item.canvas.width = Math.max(1, Math.floor(view.width * dpr))
  item.canvas.height = Math.max(1, Math.floor(view.height * dpr))
  item.canvas.style.width = px(view.width)
  item.canvas.style.height = px(view.height)
  const context = item.canvas.getContext('2d', { alpha: false })
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  item.task = item.page.render({ canvasContext: context, viewport: view })
  try {
    await item.task.promise
  } catch (error) {
    if (error && error.name === 'RenderingCancelledException') return
    throw error
  }
  item.task = null

  // The text layer is what makes selection and Ctrl+F work: the browser's own
  // find runs over it, because this is an ordinary page in an ordinary tab.
  item.layer.textContent = ''
  const text = new TextLayer({
    textContentSource: await item.page.getTextContent(),
    container: item.layer,
    viewport: view
  })
  await text.render()
  item.layer.style.width = px(view.width)

  /*
   * The form, if the document has one.
   *
   * PDF.js draws the widgets itself and keeps what is typed in its own
   * storage, which is exactly what saveDocument() writes back out. Without
   * this a form is a picture of a form: every PDF that asks for a name and a
   * date is one somebody has to print, fill in by hand and scan.
   */
  try {
    const annotations = await item.page.getAnnotations({ intent: 'display' })
    if (annotations.some((one) => one.subtype === 'Widget')) {
      item.forms.textContent = ''
      item.forms.style.width = px(view.width)
      item.forms.style.height = px(view.height)
      new AnnotationLayer({
        div: item.forms,
        page: item.page,
        viewport: view.clone({ dontFlip: true }),
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null
      }).render({
        annotations,
        page: item.page,
        viewport: view.clone({ dontFlip: true }),
        linkService: { getDestinationHash: () => '', addLinkAttributes: () => {}, externalLinkTarget: 0 },
        renderForms: true,
        annotationStorage: pdf.annotationStorage
      })
      hasForm = true
      saveButton.title = words.save
    }
  } catch (error) {
    // A document whose annotations cannot be read is still a document; the
    // pages themselves are already on the screen.
  }

  drawNotes(item)
  item.layer.style.height = px(view.height)
}

/* ------------------------------------------------------------------ notes */

/**
 * Notes left on a document.
 *
 * Kept beside the file rather than written into it: a PDF that gains new
 * objects is a PDF some readers refuse to open, and the reader's own thoughts
 * are not part of the document they were reading. They live under the
 * document's address in this profile, and the Save button offers them as a
 * separate text file beside the PDF.
 *
 * Positions are fractions of the page, so a note stays where it was put at
 * any zoom and after any rotation.
 */
function drawNotes(item) {
  item.noteLayer.textContent = ''
  const box = item.holder.getBoundingClientRect()
  for (const one of notes.filter((note) => note.page === item.number)) {
    const pin = document.createElement('button')
    pin.type = 'button'
    pin.className = 'note-pin'
    pin.textContent = '•'
    pin.title = one.text.slice(0, 120) || words.note
    pin.style.left = (one.x * 100) + '%'
    pin.style.top = (one.y * 100) + '%'
    pin.addEventListener('click', (event) => {
      event.stopPropagation()
      openNote(item, one, pin)
    })
    item.noteLayer.append(pin)
  }
}

function openNote(item, note, pin) {
  for (const open of document.querySelectorAll('.note-open')) open.remove()
  const card = document.createElement('div')
  card.className = 'note-open'
  card.style.left = (note.x * 100) + '%'
  card.style.top = 'calc(' + (note.y * 100) + '% + 26px)'

  const field = document.createElement('textarea')
  field.value = note.text
  field.placeholder = words.note
  field.addEventListener('input', () => {
    note.text = field.value
    saveNotes()
  })

  const drop = document.createElement('span')
  drop.className = 'drop'
  drop.textContent = '×'
  drop.addEventListener('click', () => {
    notes = notes.filter((one) => one !== note)
    saveNotes()
    card.remove()
    pin.remove()
  })

  card.append(drop, field)
  item.noteLayer.append(card)
  field.focus()
}

function saveNotes() {
  try {
    localStorage.setItem('nya-notes:' + src, JSON.stringify(notes))
  } catch {
    /* a viewer opened with storage blocked keeps them for this visit only */
  }
}

function loadNotes() {
  try {
    const kept = JSON.parse(localStorage.getItem('nya-notes:' + src) || '[]')
    notes = Array.isArray(kept)
      ? kept.filter((one) => one && typeof one.text === 'string' && Number.isFinite(one.page))
      : []
  } catch {
    notes = []
  }
}

/* -------------------------------------------------------------- page list */

/**
 * The pages, in the order they will be saved in.
 *
 * Turning a page round or moving it changes this list and the document on the
 * screen; neither touches the file until Save is pressed, which is the only
 * way somebody can try an order and change their mind.
 */
function drawPageList() {
  const panel = document.getElementById('pages')
  panel.textContent = ''
  order.forEach((number, at) => {
    const row = document.createElement('div')
    row.className = 'thumb'

    const label = document.createElement('span')
    label.className = 'n'
    label.textContent = String(number)

    const turned = document.createElement('span')
    turned.textContent = turns[number - 1] ? turns[number - 1] + '°' : ''

    const acts = document.createElement('span')
    acts.className = 'acts'

    const rotateOne = document.createElement('button')
    rotateOne.textContent = '⟳'
    rotateOne.title = words.rotatePage
    rotateOne.addEventListener('click', (event) => {
      event.stopPropagation()
      turns[number - 1] = ((turns[number - 1] || 0) + 90) % 360
      drawPageList()
      void redrawAll()
    })

    const up = document.createElement('button')
    up.textContent = '↑'
    up.title = words.movePageUp
    up.disabled = at === 0
    up.addEventListener('click', (event) => {
      event.stopPropagation()
      const next = [...order]
      ;[next[at - 1], next[at]] = [next[at], next[at - 1]]
      order = next
      drawPageList()
      void rebuildOrder()
    })

    const down = document.createElement('button')
    down.textContent = '↓'
    down.title = words.movePageDown
    down.disabled = at === order.length - 1
    down.addEventListener('click', (event) => {
      event.stopPropagation()
      const next = [...order]
      ;[next[at], next[at + 1]] = [next[at + 1], next[at]]
      order = next
      drawPageList()
      void rebuildOrder()
    })

    acts.append(rotateOne, up, down)
    row.append(label, turned, acts)
    row.addEventListener('click', () => goTo(at + 1))
    panel.append(row)
  })
}

/** Lays the pages out again in the order the list now holds. */
async function rebuildOrder() {
  const byNumber = new Map(pages.map((one) => [one.number, one]))
  doc.textContent = ''
  pages = order.map((number) => byNumber.get(number)).filter(Boolean)
  for (const one of pages) doc.append(one.holder)
  await redrawAll()
}

/** Everything on the screen, drawn again at the current scale and turn. */
async function redrawAll() {
  for (const one of pages) one.rendered = 0
  for (const one of pages) {
    if (one.page) await render(one)
  }
}

function observe() {
  if (window.__nyaObserver) window.__nyaObserver.disconnect()
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = pages[Number(entry.target.dataset.page) - 1]
        if (entry.isIntersecting) void render(item)
      }
    },
    { root: scroll, rootMargin: '400px 0px' }
  )
  for (const item of pages) seen.observe(item.holder)
  window.__nyaObserver = seen
}

/* ------------------------------------------------------------------ chrome */

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(scale * 100) + '%'
}

async function setScale(next, keepFit) {
  scale = Math.max(0.1, Math.min(8, next))
  if (!keepFit) {
    fitMode = null
    // A fit that was already queued would land after this one and undo it.
    clearTimeout(resizeTimer)
  }
  const anchor = current
  await sizeAll()
  updateZoomLabel()
  goTo(anchor, false)
  for (const item of pages) if (near(item)) void render(item)
}

const near = (item) => {
  const box = item.holder.getBoundingClientRect()
  return box.bottom > -400 && box.top < window.innerHeight + 400
}

function goTo(number, smooth) {
  const item = pages[Math.max(1, Math.min(pdf.numPages, number)) - 1]
  if (!item) return
  scroll.scrollTo({ top: item.holder.offsetTop - 16, behavior: smooth ? 'smooth' : 'auto' })
}

function trackPage() {
  const middle = scroll.scrollTop + scroll.clientHeight / 2
  let found = 1
  for (const item of pages) {
    if (item.holder.offsetTop <= middle) found = item.number
    else break
  }
  if (found !== current) {
    current = found
    if (document.activeElement !== pageInput) pageInput.value = String(current)
  }
}

/* -------------------------------------------------------------- the buttons */

document.getElementById('prev').onclick = () => goTo(current - 1, true)
document.getElementById('next').onclick = () => goTo(current + 1, true)
document.getElementById('in').onclick = () => setScale(STEPS.find((s) => s > scale + 0.001) ?? scale * 1.25)
document.getElementById('out').onclick = () =>
  setScale([...STEPS].reverse().find((s) => s < scale - 0.001) ?? scale / 1.25)
document.getElementById('rotate').onclick = async () => {
  rotation = (rotation + 90) % 360
  if (fitMode && pages[0]?.page) scale = fitScale(pages[0].page)
  await sizeAll()
  updateZoomLabel()
  for (const item of pages) if (near(item)) void render(item)
}
document.getElementById('fit').onclick = async () => {
  fitMode = fitMode === 'width' ? 'page' : 'width'
  const fitButton = document.getElementById('fit')
  fitButton.title = fitMode === 'width' ? words.fitWidth : words.fitPage
  if (pages[0]?.page) await setScale(fitScale(pages[0].page), true)
}
document.getElementById('print').onclick = async () => {
  // Everything has to be on the canvas before the print sheet is taken.
  for (const item of pages) await render(item)
  window.print()
}
const saveButton = document.getElementById('save')
let hasForm = false

/**
 * The document, saved.
 *
 * A plain document is handed over as it arrived. One with a form that has
 * been filled in is rebuilt by PDF.js with the answers in it — which is the
 * difference between a PDF you can fill in and a picture of a form. Notes go
 * out beside it as a text file: they are the reader's, not the document's.
 */
saveButton.onclick = async () => {
  let blob = null
  if (hasForm && pdf) {
    try {
      const bytes = await pdf.saveDocument()
      blob = new Blob([bytes], { type: 'application/pdf' })
    } catch (error) {
      blob = null
    }
  }
  const link = document.createElement('a')
  link.href = blob ? URL.createObjectURL(blob) : './data?src=' + encodeURIComponent(src)
  link.download = document.title
  link.click()
  if (blob) setTimeout(() => URL.revokeObjectURL(link.href), 4000)

  if (notes.length > 0) {
    const text = notes
      .map((one) => words.page + ' ' + one.page + ': ' + one.text)
      .join(String.fromCharCode(10))
    const beside = document.createElement('a')
    beside.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    beside.download = document.title.replace(/.pdf$/i, '') + '.notes.txt'
    beside.click()
    setTimeout(() => URL.revokeObjectURL(beside.href), 4000)
  }
}

/** A note goes where the next click on a page lands. */
document.getElementById('note').onclick = () => {
  placingNote = !placingNote
  doc.style.cursor = placingNote ? 'crosshair' : ''
  if (placingNote) say('<p>' + words.noteHint + '</p>')
  else quiet()
}

doc.addEventListener('click', (event) => {
  if (!placingNote) return
  const holder = event.target.closest('.page')
  if (!holder) return
  const item = pages.find((one) => one.holder === holder)
  if (!item) return
  const box = holder.getBoundingClientRect()
  notes.push({
    page: item.number,
    x: (event.clientX - box.left) / box.width,
    y: (event.clientY - box.top) / box.height,
    text: ''
  })
  saveNotes()
  drawNotes(item)
  placingNote = false
  doc.style.cursor = ''
  quiet()
  const pin = item.noteLayer.lastElementChild
  if (pin) pin.click()
})

document.getElementById('pages-toggle').onclick = () => {
  const panel = document.getElementById('pages')
  panel.classList.toggle('on')
  if (panel.classList.contains('on')) drawPageList()
}

pageInput.addEventListener('change', () => {
  const wanted = parseInt(pageInput.value, 10)
  if (Number.isFinite(wanted)) goTo(wanted, true)
  pageInput.value = String(current)
})
pageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') pageInput.blur()
})

scroll.addEventListener('scroll', trackPage, { passive: true })

window.addEventListener('keydown', (event) => {
  if (event.target === pageInput) return
  if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
    event.preventDefault()
    document.getElementById('in').click()
  } else if (event.ctrlKey && event.key === '-') {
    event.preventDefault()
    document.getElementById('out').click()
  } else if (event.ctrlKey && event.key === '0') {
    event.preventDefault()
    void setScale(1)
  } else if (event.key === 'PageDown') {
    event.preventDefault()
    goTo(current + 1, true)
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    goTo(current - 1, true)
  } else if (event.key === 'Home' && !event.ctrlKey) {
    event.preventDefault()
    goTo(1, true)
  } else if (event.key === 'End' && !event.ctrlKey) {
    event.preventDefault()
    goTo(pdf ? pdf.numPages : 1, true)
  }
})

// Ctrl+wheel is a zoom, everywhere else in the browser and here.
scroll.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    void setScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
  },
  { passive: false }
)

// Watching the scroller rather than the window: a tab gets its width when it
// is first shown, which is not a window resize and can happen long after the
// document has been read.
let lastWidth = 0
new ResizeObserver(() => {
  if (!fitMode || !pages[0]?.page) return
  const width = scroll.clientWidth
  if (width === lastWidth || width < 80) return
  lastWidth = width
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => void setScale(fitScale(pages[0].page), true), 80)
}).observe(scroll)

/* -------------------------------------------------------------------- load */

async function open(password) {
  const task = getDocument({
    url: './data?src=' + encodeURIComponent(src),
    cMapUrl: './lib/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './lib/standard_fonts/',
    wasmUrl: './lib/wasm/',
    iccUrl: './lib/iccs/',
    password
  })
  task.onPassword = (retry, reason) => {
    askPassword(reason === 2)
    window.__nyaRetry = retry
  }
  pdf = await task.promise
  countLabel.textContent = String(pdf.numPages)
  // The order the pages start in, and no turn on any of them: both are only
  // ever changed on purpose, and neither touches the file.
  order = Array.from({ length: pdf.numPages }, (_one, at) => at + 1)
  turns = new Array(pdf.numPages).fill(0)
  loadNotes()
  await build()
  quiet()
  trackPage()
}

function askPassword(wrong) {
  say(
    '<p>' + words.password + '</p>' +
      '<p style="opacity:.7">' + (wrong ? words.wrongPassword : words.passwordHint) + '</p>' +
      '<input type="password" id="pw" autofocus />' +
      '<button class="primary" id="pw-go">' + words.open + '</button>'
  )
  const field = document.getElementById('pw')
  const send = () => window.__nyaRetry && window.__nyaRetry(field.value)
  document.getElementById('pw-go').onclick = send
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send()
  })
  field.focus()
}

open().catch((error) => {
  if (error && error.name === 'PasswordException') return
  say('<p>' + words.failed + '</p><p style="opacity:.7">' + String(error && error.message || error) + '</p>')
})
`
