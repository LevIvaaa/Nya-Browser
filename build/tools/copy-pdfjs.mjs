// Puts PDF.js where the packaged app can reach it.
//
// Electron ships no PDF viewer: a PDF navigation produces the embedder page
// with the plugin missing, which is a blank tab. So the browser brings its own
// renderer, and these are its parts. They are copied into out/ rather than read
// from node_modules because out/ is what electron-builder packs, and because a
// viewer that stops working when a dependency is pruned is not a viewer.
//
// Called from electron.vite.config.ts on every build, and runnable by hand.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const from = join(root, 'node_modules', 'pdfjs-dist')
const to = join(root, 'out', 'pdfjs')

// The library and its worker, then the resources a PDF asks for only
// sometimes — each of them a page that renders wrong without it: cmaps for CJK
// text, standard_fonts for the fourteen fonts a PDF may assume rather than
// embed, wasm for JPEG 2000 and JBIG2 images, iccs for tagged colour.
const PARTS = [
  ['build/pdf.min.mjs', 'pdf.min.mjs'],
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
  ['wasm', 'wasm'],
  ['iccs', 'iccs']
]

function bytesIn(path) {
  const stat = statSync(path)
  if (stat.isFile()) return stat.size
  return readdirSync(path).reduce((total, name) => total + bytesIn(join(path, name)), 0)
}

export function copyPdfjs() {
  if (!existsSync(from)) throw new Error('pdfjs-dist is not installed — run npm install')
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  let bytes = 0
  for (const [source, target] of PARTS) {
    const src = join(from, source)
    if (!existsSync(src)) throw new Error(`pdfjs-dist is missing ${source}`)
    cpSync(src, join(to, target), { recursive: true })
    bytes += bytesIn(src)
  }
  return bytes
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  console.log(`pdfjs -> out/pdfjs (${Math.round(copyPdfjs() / 1024)} KB)`)
}
