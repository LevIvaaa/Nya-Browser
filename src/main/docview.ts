// ---------------------------------------------------------------------------
// A viewer for the files a browser meets and then hands to a text editor:
// JSON, Markdown, CSV and plain text (nya://doc).
//
// Chromium shows JSON as one unbroken line, Markdown as its source, and CSV as
// a wall of commas. Every one of those is a file somebody clicked expecting to
// read it. This renders them: JSON folded and coloured, Markdown as the
// document it describes, CSV as a table, text with its encoding worked out.
//
// Same shape as the PDF viewer and for the same reasons: an ordinary sandboxed
// page with no preload, which cannot reach the bytes itself. The main process
// fetches on the tab's own session — a file behind a login is only readable
// with that session's cookies, and a page has no business making that request
// — and serves the result back same-origin. Both endpoints refuse to be
// framed, so no site can wrap one in an iframe and go fishing.
// ---------------------------------------------------------------------------

import type { Session } from 'electron'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { t } from './i18n'
import { decodeText, sniffCharset } from '../shared/charset'

export type DocKind = 'json' | 'markdown' | 'csv' | 'text'

/** What this address looks like it holds, by its name and nothing else. */
export function looksLikeDoc(url: string): DocKind | null {
  let path = ''
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return null
  }
  if (/\.json$|\.jsonc$|\.geojson$/.test(path)) return 'json'
  if (/\.md$|\.markdown$|\.mdown$/.test(path)) return 'markdown'
  if (/\.csv$|\.tsv$/.test(path)) return 'csv'
  return null
}

export const docViewerUrl = (src: string, kind: DocKind) =>
  `nya://doc/?kind=${kind}&src=${encodeURIComponent(src)}`

/** The address a viewer is showing, so the toolbar can say the real one. */
export function docSource(viewer: string): string | null {
  try {
    const url = new URL(viewer)
    if (url.protocol !== 'nya:' || url.host !== 'doc') return null
    return url.searchParams.get('src')
  } catch {
    return null
  }
}

const FRAME_GUARD = "frame-ancestors 'none'"

const notFound = () => new Response('Not found', { status: 404 })

/**
 * Answers everything under nya://doc.
 *
 * `ses` is the session the tab belongs to, so a file behind a login is fetched
 * exactly as the tab would have fetched it.
 */
export async function serveDoc(request: Request, ses: Session): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/data') {
    return serveData(url.searchParams.get('src') ?? '', ses)
  }

  const src = url.searchParams.get('src') ?? ''
  const kind = (url.searchParams.get('kind') ?? 'text') as DocKind
  return new Response(viewerPage(src, kind), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy':
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; ` +
        `img-src nya: data: https: http:; connect-src nya:; ${FRAME_GUARD}`
    }
  })
}

/** The bytes themselves, decoded to text with the encoding worked out. */
async function serveData(src: string, ses: Session): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    return notFound()
  }

  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; ${FRAME_GUARD}`
  }

  const answer = (bytes: Uint8Array, declared: string) =>
    new Response(decodeText(bytes, declared), { headers })

  if (parsed.protocol === 'file:') {
    try {
      const body = await readFile(fileURLToPath(parsed))
      return answer(new Uint8Array(body), '')
    } catch {
      return notFound()
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return notFound()

  try {
    const response = await ses.fetch(src)
    if (!response.ok) return new Response('Upstream ' + response.status, { status: 502 })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return answer(bytes, response.headers.get('content-type') ?? '')
  } catch {
    return new Response('Cannot fetch', { status: 502 })
  }
}

/* ------------------------------------------------------------------- the page */

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const documentName = (src: string) => {
  try {
    const path = new URL(src).pathname
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || src
  } catch {
    return src
  }
}

function viewerPage(src: string, kind: DocKind): string {
  // Everything the page says, translated here: the viewer has no access to the
  // browser's dictionaries.
  const words = {
    loading: t('Открываем документ…'),
    failed: t('Не удалось открыть документ'),
    raw: t('Исходный текст'),
    pretty: t('Как документ'),
    copy: t('Копировать'),
    copied: t('Скопировано'),
    rows: t('строк'),
    columns: t('столбцов'),
    encoding: t('Кодировка'),
    collapse: t('Свернуть всё'),
    expand: t('Развернуть всё'),
    saveCsv: t('Сохранить как CSV')
  }

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${esc(documentName(src))}</title>
<style>
  :root {
    --bg: #1b1d24; --bar: #16171d; --line: rgba(255,255,255,.1);
    --text: #f2f3f7; --dim: rgba(242,243,247,.6); --hover: rgba(255,255,255,.09);
    --accent: #7c6cff; --key: #8ab4ff; --str: #9ae6a0; --num: #ffd479; --bool: #ff9ecd;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f4f5f8; --bar: #fff; --line: rgba(15,18,34,.1);
      --text: #14161d; --dim: rgba(20,22,29,.6); --hover: rgba(15,18,34,.06);
      --key: #1a56c4; --str: #147a3d; --num: #a35a00; --bool: #a4166e;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.6 system-ui, "Segoe UI", sans-serif;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; gap: 8px; padding: 0 10px;
    height: 42px; flex: none; background: var(--bar);
    border-bottom: 1px solid var(--line);
  }
  header .name { font-weight: 600; margin-right: auto; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  header .meta { color: var(--dim); font-size: 12px; white-space: nowrap; }
  button {
    font: 500 12px/1 system-ui, sans-serif; color: inherit; cursor: pointer;
    background: transparent; border: 1px solid var(--line); border-radius: 8px;
    padding: 6px 10px;
  }
  button:hover { background: var(--hover); }
  button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  main { flex: 1; overflow: auto; padding: 16px 20px 40px; }

  /* ---- json ---- */
  .json { font: 13px/1.65 ui-monospace, "Cascadia Mono", Consolas, monospace; }
  .json .k { color: var(--key); }
  .json .s { color: var(--str); }
  .json .n { color: var(--num); }
  .json .b { color: var(--bool); }
  .json details { margin-left: 14px; }
  .json summary { cursor: pointer; list-style: none; }
  .json summary::-webkit-details-marker { display: none; }
  .json summary::before { content: '▸'; display: inline-block; width: 12px; color: var(--dim); }
  .json details[open] > summary::before { content: '▾'; }
  .json .leaf { margin-left: 26px; }
  .json .count { color: var(--dim); font-size: 11px; margin-left: 6px; }

  /* ---- markdown ---- */
  .md { max-width: 74ch; margin: 0 auto; }
  .md h1, .md h2, .md h3 { line-height: 1.25; margin: 1.4em 0 .5em; }
  .md h1 { font-size: 28px; } .md h2 { font-size: 22px; } .md h3 { font-size: 18px; }
  .md p { margin: .8em 0; }
  .md code { font: 12.5px ui-monospace, Consolas, monospace;
    background: var(--hover); padding: 1px 5px; border-radius: 5px; }
  .md pre { background: var(--hover); padding: 12px 14px; border-radius: 10px; overflow: auto; }
  .md pre code { background: none; padding: 0; }
  .md blockquote { margin: 1em 0; padding-left: 14px; border-left: 3px solid var(--line); color: var(--dim); }
  .md ul, .md ol { padding-left: 24px; }
  .md a { color: var(--accent); }
  .md hr { border: none; border-top: 1px solid var(--line); margin: 1.6em 0; }
  .md table { border-collapse: collapse; }
  .md th, .md td { border: 1px solid var(--line); padding: 5px 9px; }

  /* ---- csv ---- */
  .csv { border-collapse: collapse; font: 13px ui-monospace, Consolas, monospace; }
  .csv th, .csv td { border: 1px solid var(--line); padding: 4px 9px; white-space: pre; }
  .csv th { position: sticky; top: 0; background: var(--bar); text-align: left; }
  .csv tr:nth-child(even) td { background: var(--hover); }

  .raw { white-space: pre-wrap; word-break: break-word;
    font: 13px/1.6 ui-monospace, Consolas, monospace; }
  .note { color: var(--dim); padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<header>
  <span class="name">${esc(documentName(src))}</span>
  <span class="meta" id="meta"></span>
  <button id="mode" aria-pressed="true">${esc(words.pretty)}</button>
  <button id="copy">${esc(words.copy)}</button>
  <span id="extra"></span>
</header>
<main id="out"><p class="note">${esc(words.loading)}</p></main>

<script>
const WORDS = ${JSON.stringify(words)}
const KIND = ${JSON.stringify(kind)}
const SRC = ${JSON.stringify(src)}
const out = document.getElementById('out')
const meta = document.getElementById('meta')
const extra = document.getElementById('extra')
const modeButton = document.getElementById('mode')
let text = ''
let pretty = true

const esc = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ------------------------------------------------------------------- json */

function drawJson(value, key) {
  const label = key === undefined ? '' : '<span class="k">' + esc(key) + '</span>: '
  if (value === null) return '<div class="leaf">' + label + '<span class="b">null</span></div>'
  const kind = typeof value
  if (kind === 'string') return '<div class="leaf">' + label + '<span class="s">"' + esc(value) + '"</span></div>'
  if (kind === 'number') return '<div class="leaf">' + label + '<span class="n">' + esc(value) + '</span></div>'
  if (kind === 'boolean') return '<div class="leaf">' + label + '<span class="b">' + value + '</span></div>'

  const array = Array.isArray(value)
  const entries = array ? value.map((one, at) => [at, one]) : Object.entries(value)
  const brackets = array ? ['[', ']'] : ['{', '}']
  const count = '<span class="count">' + entries.length + '</span>'
  // Open by default down to a size where opening everything is still readable;
  // a thousand-entry array opened on arrival is a page nobody can scroll.
  const open = entries.length <= 40 ? ' open' : ''
  return (
    '<details' + open + '><summary>' + label + brackets[0] + count + '</summary>' +
    entries.map(([k, v]) => drawJson(v, array ? undefined : k)).join('') +
    '<div class="leaf">' + brackets[1] + '</div></details>'
  )
}

/* --------------------------------------------------------------- markdown */

/**
 * Markdown, rendered without a library.
 *
 * Deliberately small: headings, emphasis, code, links, lists, quotes, rules
 * and tables. Everything is escaped before any tag is added, so a document
 * cannot smuggle markup through — which is the whole risk of rendering
 * somebody else's file.
 */
function drawMarkdown(source) {
  const lines = esc(source).split(/\\r?\\n/)
  const html = []
  let list = null
  let code = null

  const inline = (line) =>
    line
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\\*([^*]+)\\*/g, '$1<em>$2</em>')
      .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="$2" rel="noreferrer">$1</a>')

  const closeList = () => {
    if (list) { html.push('</' + list + '>'); list = null }
  }

  for (const line of lines) {
    const fence = line.match(/^\`\`\`(.*)$/)
    if (fence) {
      if (code === null) { closeList(); code = []; continue }
      html.push('<pre><code>' + code.join('\\n') + '</code></pre>')
      code = null
      continue
    }
    if (code !== null) { code.push(line); continue }

    const heading = line.match(/^(#{1,6})\\s+(.*)$/)
    if (heading) {
      closeList()
      const level = Math.min(6, heading[1].length)
      html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>')
      continue
    }
    if (/^\\s*(-{3,}|\\*{3,})\\s*$/.test(line)) { closeList(); html.push('<hr>'); continue }
    const quote = line.match(/^&gt;\\s?(.*)$/)
    if (quote) { closeList(); html.push('<blockquote>' + inline(quote[1]) + '</blockquote>'); continue }

    const bullet = line.match(/^\\s*[-*+]\\s+(.*)$/)
    const numbered = line.match(/^\\s*\\d+[.)]\\s+(.*)$/)
    if (bullet || numbered) {
      const want = bullet ? 'ul' : 'ol'
      if (list !== want) { closeList(); html.push('<' + want + '>'); list = want }
      html.push('<li>' + inline((bullet || numbered)[1]) + '</li>')
      continue
    }

    if (!line.trim()) { closeList(); continue }
    closeList()
    html.push('<p>' + inline(line) + '</p>')
  }
  closeList()
  if (code !== null) html.push('<pre><code>' + code.join('\\n') + '</code></pre>')
  return '<div class="md">' + html.join('') + '</div>'
}

/* -------------------------------------------------------------------- csv */

/** One CSV file, read the way a spreadsheet reads it: quotes and all. */
function parseCsv(source) {
  const comma = source.includes('\\t') && !source.includes(',') ? '\\t' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let at = 0; at < source.length; at++) {
    const ch = source[at]
    if (quoted) {
      if (ch === '"') {
        if (source[at + 1] === '"') { cell += '"'; at++ }
        else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === comma) { row.push(cell); cell = ''; continue }
    if (ch === '\\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    if (ch === '\\r') continue
    cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function drawCsv(source) {
  const rows = parseCsv(source)
  if (rows.length === 0) return '<p class="note">' + esc(WORDS.failed) + '</p>'
  const widest = Math.max(...rows.map((one) => one.length))
  meta.textContent = rows.length + ' ' + WORDS.rows + ' · ' + widest + ' ' + WORDS.columns
  const head = rows[0]
  const body = rows.slice(1)
  return (
    '<table class="csv"><thead><tr>' +
    head.map((one) => '<th>' + esc(one) + '</th>').join('') +
    '</tr></thead><tbody>' +
    body
      .map(
        (one) =>
          '<tr>' +
          Array.from({ length: widest }, (_x, at) => '<td>' + esc(one[at] ?? '') + '</td>').join('') +
          '</tr>'
      )
      .join('') +
    '</tbody></table>'
  )
}

/* ------------------------------------------------------------------ paint */

function paint() {
  modeButton.textContent = pretty ? WORDS.raw : WORDS.pretty
  modeButton.setAttribute('aria-pressed', String(pretty))
  if (!pretty) {
    out.innerHTML = '<div class="raw">' + esc(text) + '</div>'
    return
  }
  try {
    if (KIND === 'json') {
      out.innerHTML = '<div class="json">' + drawJson(JSON.parse(text)) + '</div>'
    } else if (KIND === 'markdown') {
      out.innerHTML = drawMarkdown(text)
    } else if (KIND === 'csv') {
      out.innerHTML = drawCsv(text)
    } else {
      out.innerHTML = '<div class="raw">' + esc(text) + '</div>'
    }
  } catch (error) {
    // A file that does not parse is still a file somebody wanted to read.
    out.innerHTML = '<div class="raw">' + esc(text) + '</div>'
  }
}

modeButton.addEventListener('click', () => { pretty = !pretty; paint() })
document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(text)
    const button = document.getElementById('copy')
    button.textContent = WORDS.copied
    setTimeout(() => (button.textContent = WORDS.copy), 1400)
  } catch {}
})

if (KIND === 'json') {
  const fold = document.createElement('button')
  fold.textContent = WORDS.collapse
  let open = true
  fold.addEventListener('click', () => {
    open = !open
    for (const one of out.querySelectorAll('details')) one.open = open
    fold.textContent = open ? WORDS.collapse : WORDS.expand
  })
  extra.append(fold)
}

fetch('nya://doc/data?src=' + encodeURIComponent(SRC))
  .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
  .then((body) => {
    text = body
    if (KIND !== 'csv') meta.textContent = new Intl.NumberFormat().format(body.length) + ' B'
    paint()
  })
  .catch(() => {
    out.innerHTML = '<p class="note">' + esc(WORDS.failed) + '</p>'
  })
</script>
</body>
</html>`
}

/** Re-exported so the tab can decide before it navigates. */
export { sniffCharset }
