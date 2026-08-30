import type { BrowserApi } from '../../preload/index'

declare global {
  interface Window {
    browser: BrowserApi
  }
}

export {}
