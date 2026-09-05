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
    plugins: [externalizeDepsPlugin(), pdfjs()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // injected into every page for autofill; exposes nothing to the page
          content: resolve(__dirname, 'src/preload/content.ts')
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
