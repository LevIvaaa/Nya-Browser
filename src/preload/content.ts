import { ipcRenderer } from 'electron'

/**
 * Autofill content script.
 *
 * It runs in the isolated preload world of every top-level page and exposes
 * NOTHING to the page: no contextBridge, no globals. A site therefore cannot
 * ask for stored credentials — it can only be handed values by the browser
 * after the user picked an entry themselves.
 *
 * What it does:
 *  - notices login forms and tells the browser "this origin has a login form";
 *  - reports a submitted username/password so the browser can offer to save it
 *    (the page already knows those values, so nothing new is disclosed);
 *  - fills fields when the browser pushes a credential.
 */

const isTop = (() => {
  try {
    return window.top === window
  } catch {
    return false
  }
})()

const httpOrigin = /^https?:$/.test(location.protocol)

/* ------------------------------------------------------ instant hiding */
// The element-hiding CSS for this host, injected before the first paint.
// Waiting for DOMContentLoaded (the old way) let ad frames flash for a moment
// before disappearing; this is the flash removed. The synchronous call is a
// sub-millisecond lookup against an in-memory index, and an empty answer
// (blocker off, engine not ready) costs one round trip and nothing else.
if (isTop && httpOrigin) {
  try {
    const css = ipcRenderer.sendSync('cosmetic:boot', location.hostname) as string
    if (css) {
      const style = document.createElement('style')
      style.textContent = css
      const attach = () => {
        const root = document.head ?? document.documentElement
        if (root) root.appendChild(style)
        return style.isConnected
      }
      // At document-start there is no <html> yet; catch it the moment it lands.
      if (!attach()) {
        new MutationObserver((_mutations, observer) => {
          if (attach()) observer.disconnect()
        }).observe(document, { childList: true, subtree: true })
      }
    }
  } catch {
    /* a page without the hiding CSS is a page, not a failure */
  }
}

/* ------------------------------------------------------ editing keys */
// Chromium inside a WebContentsView never runs its own accelerator table, so
// Ctrl+C/V/X/A/Z/Y arrive at the page as plain keydowns and then die. The
// listener sits on window in the bubble phase — a page that handled the key
// itself (its own undo stack, its own paste) sets defaultPrevented and we
// stay out of its way; otherwise main performs the editing command natively.
const EDIT_COMMANDS: Record<string, string> = {
  c: 'copy',
  x: 'cut',
  v: 'paste',
  a: 'selectAll',
  z: 'undo',
  y: 'redo'
}

const isMac = process.platform === 'darwin'
window.addEventListener('keydown', (event) => {
  const mod = isMac ? event.metaKey : event.ctrlKey
  const other = isMac ? event.ctrlKey : event.metaKey
  if (!mod || other || event.altKey || event.defaultPrevented) return
  const key = event.key.toLowerCase()
  const command = event.shiftKey ? (key === 'z' ? 'redo' : '') : (EDIT_COMMANDS[key] ?? '')
  if (command) ipcRenderer.send('edit:command', command)
})

if (isTop && httpOrigin) {
  const PASSWORD = 'input[type="password"]:not([disabled]):not([readonly])'
  const USERNAME_HINTS = /user|login|email|mail|phone|tel|account|логин|почта|телефон/i

  const visible = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 20 && rect.height > 8
  }

  const passwordFields = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>(PASSWORD)).filter(visible)

  /** The text field a login form uses for the account name. */
  function usernameFieldFor(password: HTMLInputElement): HTMLInputElement | null {
    const form = password.form
    const scope: ParentNode = form ?? document
    const candidates = Array.from(
      scope.querySelectorAll<HTMLInputElement>('input:not([type="password"]):not([type="hidden"])')
    ).filter((input) => {
      const type = (input.type || 'text').toLowerCase()
      return ['text', 'email', 'tel', 'search', ''].includes(type) && visible(input)
    })
    if (candidates.length === 0) return null

    const scored = candidates.map((input) => {
      const hay = `${input.name} ${input.id} ${input.autocomplete} ${input.placeholder} ${input.getAttribute('aria-label') ?? ''}`
      let score = USERNAME_HINTS.test(hay) ? 10 : 0
      if (input.autocomplete === 'username' || input.autocomplete === 'email') score += 20
      if (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) score += 5
      return { input, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0].input
  }

  const setValue = (input: HTMLInputElement, value: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  let announced = ''

  const announce = () => {
    const fields = passwordFields()
    const key = `${location.host}:${fields.length}`
    if (!fields.length || key === announced) return
    announced = key
    ipcRenderer.send('autofill:form', { host: location.host })
  }

  const reportSubmission = () => {
    const password = passwordFields()[0]
    if (!password || !password.value) return
    const username = usernameFieldFor(password)
    ipcRenderer.send('autofill:submitted', {
      host: location.host,
      username: username?.value ?? '',
      password: password.value
    })
  }

  // Fill on demand — only the main process can trigger this.
  ipcRenderer.on('autofill:fill', (_event, data: { username: string; password: string; host: string }) => {
    if (!data || data.host !== location.host) return
    const password = passwordFields()[0]
    if (!password) return
    const username = usernameFieldFor(password)
    if (username && data.username) setValue(username, data.username)
    setValue(password, data.password)
    password.focus()
  })

  const start = () => {
    announce()
    const observer = new MutationObserver(() => announce())
    observer.observe(document.documentElement, { childList: true, subtree: true })

    document.addEventListener('submit', reportSubmission, true)
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null
        if (!target) return
        const button = target.closest('button, input[type="submit"], [role="button"]')
        if (button) setTimeout(reportSubmission, 0)
      },
      true
    )
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter') setTimeout(reportSubmission, 0)
      },
      true
    )
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
