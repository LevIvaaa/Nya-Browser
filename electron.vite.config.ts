import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyPdfjs } from './build/tools/copy-pdfjs.mjs'

/**
 * PDF.js is not bundled — it is copied beside the built main process, because
 * the viewer serves it over nya:// as ordinary files and its worker has to stay
 * a separate script. See build/tools/copy-pdfjs.mjs.
 */
const pdfjs = () => ({
  name: 'nya-pdfjs',
  buildStart() {
    copyPdfjs()
  }
})

export default defineConfig({
  main: {
    // jsqr is bundled into the decoder thread rather than required at run
    // time: a worker loads from the asar archive with fewer guarantees than
    // the main process does, and a thread that cannot find its one library
    // fails without anyone seeing it.
    plugins: [externalizeDepsPlugin({ exclude: ['jsqr'] }), pdfjs()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // QR decoding off the main thread; see src/main/qrscan.ts
          qrworker: resolve(__dirname, 'src/main/qrworker.ts')
        }
      }
    }
  },
  preload: {
    // The page-side script is sandboxed, so nothing it uses can stay
    // external: a require() there has nothing to require from.
    plugins: [externalizeDepsPlugin({ exclude: ['@mozilla/readability', 'jsqr'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // injected into every page for autofill; exposes nothing to the page
          content: resolve(__dirname, 'src/preload/content.ts'),
          // put into an extension's own popup: fills in the part of the
          // extension API Electron leaves out
          extension: resolve(__dirname, 'src/preload/extension.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react()]
  }
})
