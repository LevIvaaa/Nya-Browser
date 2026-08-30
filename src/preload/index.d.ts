import type { BrowserApi } from './index'

declare global {
  interface Window {
    browser: BrowserApi
  }
}

export {}
