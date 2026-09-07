import { contextBridge, ipcRenderer } from 'electron'

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

/* ------------------------------------------------- the four Chrome shapes */

/**
 * Chrome leaves four things on `window.chrome` that no page uses for anything
 * real: app, csi, loadTimes and runtime. Chromium on its own leaves the object
 * empty, and that emptiness is how a site tells an embedded browser from the
 * one people download.
 *
 * Google reads it on the sign-in form. Measured here: type an address, and the
 * answer is "this browser or app may not be secure", with no way past it.
 * Measured again with these four in place: the same address gets the ordinary
 * "couldn't find your account" — the form works. Nothing about the engine
 * changes; this is the same Chromium that Chrome ships, patch for patch, and
 * the shapes below are inert.
 *
 * It has to run in the page's own world, because that is the only world the
 * page can read. Nothing of the browser goes with it: the function is copied
 * across on its own, without the scope it was written in.
 */
function chromeShapes() {
  const target = window as unknown as { chrome?: Record<string, unknown> }
  const chrome = target.chrome ?? (target.chrome = {})
  const seconds = () => (performance.timeOrigin + performance.now()) / 1000
  if (!chrome.app) {
    chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run'
    }
  }
  if (!chrome.csi) {
    chrome.csi = () => ({
      onloadT: Date.now(),
      startE: Date.now(),
      pageT: performance.now(),
      tran: 15
    })
  }
  if (!chrome.loadTimes) {
    chrome.loadTimes = () => ({
      requestTime: seconds(),
      startLoadTime: seconds(),
      commitLoadTime: seconds(),
      finishDocumentLoadTime: seconds(),
      finishLoadTime: seconds(),
      firstPaintTime: seconds(),
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2'
    })
  }
  if (!chrome.runtime) {
    // Present but inert, the way it is on a page with no extension talking to
    // it: the enums exist and the calls throw as Chrome's do.
    chrome.runtime = {
      OnInstalledReason: {},
      OnRestartRequiredReason: {},
      PlatformArch: {},
      PlatformNaclArch: {},
      PlatformOs: {},
      RequestUpdateCheckStatus: {},
      connect: () => {
        throw new TypeError('Error in invocation of runtime.connect')
      },
      sendMessage: () => {
        throw new TypeError('Error in invocation of runtime.sendMessage')
      }
    }
  }
}

/**
 * Turns off the passkey prompt a page can start without being asked.
 *
 * "Conditional mediation" is the passkey offer that is supposed to appear
 * quietly inside the address field's own suggestion list — Chrome has a place
 * to draw it, and Chromium on its own does not. What happens instead is that
 * Windows throws its full-screen "use your passkey / scan a QR code / insert a
 * security key" dialog over the page the moment it loads, before anyone has
 * clicked anything. Google's sign-in form starts one on every visit.
 *
 * Saying the quiet kind is unavailable is the honest answer: we have nowhere to
 * put it. Passkeys themselves are untouched — a page's "Sign in with a passkey"
 * button still works, because that one is a real click and the dialog is then
 * the answer to it.
 */
function noUnaskedPasskeyPrompt() {
  const api = (window as unknown as { PublicKeyCredential?: { isConditionalMediationAvailable?: unknown } })
    .PublicKeyCredential
  if (!api) return
  try {
    api.isConditionalMediationAvailable = () => Promise.resolve(false)
  } catch {
    /* a browser that will not let it be replaced keeps the dialog */
  }
}

if (/^https?:$/.test(location.protocol)) {
  try {
    contextBridge.executeInMainWorld({ func: chromeShapes })
    contextBridge.executeInMainWorld({ func: noUnaskedPasskeyPrompt })
  } catch {
    /* a page that refuses the call keeps the empty object; nothing else breaks */
  }
}

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

/* --------------------------------------------------------------- translate */

/**
 * Translating what is on the page, in place.
 *
 * Only text nodes are touched, and only their contents — no markup is built
 * from what comes back, so a translation can never turn into a script. What
 * was there before is kept beside each node, which is the whole of showing the
 * original again.
 */
if (isTop && httpOrigin) {
  const SKIP = /^(script|style|noscript|code|pre|kbd|samp|textarea|svg|math)$/i
  /** No page needs more than this translated, and no service wants it. */
  const MAX_NODES = 1500
  const CHUNK = 1400

  let original: Array<{ node: Text; text: string }> | null = null
  let busy = false

  const worthIt = (value: string) => {
    const text = value.trim()
    // A stray bullet or a number is not language.
    return text.length > 1 && /[\p{L}]/u.test(text)
  }

  function collect(): Text[] {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement
        if (!parent || SKIP.test(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT
        if (!worthIt(node.nodeValue ?? '')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })
    const out: Text[] = []
    for (let node = walker.nextNode(); node && out.length < MAX_NODES; node = walker.nextNode()) {
      out.push(node as Text)
    }
    return out
  }

  async function translate(to: string) {
    if (busy) return
    busy = true
    try {
      const nodes = collect()
      if (nodes.length === 0) {
        ipcRenderer.send('translate:done', { count: 0 })
        return
      }
      // Remember the page as it was before the first word changes.
      if (!original) original = nodes.map((node) => ({ node, text: node.nodeValue ?? '' }))

      let batch: Text[] = []
      let size = 0
      let done = 0
      const flush = async () => {
        if (batch.length === 0) return
        const sending = batch
        batch = []
        size = 0
        const answer: string[] = await ipcRenderer.invoke(
          'translate:batch',
          sending.map((node) => (node.nodeValue ?? '').trim()),
          to
        )
        sending.forEach((node, index) => {
          const text = answer[index]
          // Nodes carry the spacing around them; putting a trimmed answer back
          // where a padded original was would run words together.
          if (!text || !node.isConnected) return
          const source = node.nodeValue ?? ''
          const lead = source.match(/^\s*/)?.[0] ?? ''
          const tail = source.match(/\s*$/)?.[0] ?? ''
          node.nodeValue = lead + text + tail
        })
        done += sending.length
        ipcRenderer.send('translate:progress', { done, total: nodes.length })
      }

      for (const node of nodes) {
        const text = (node.nodeValue ?? '').trim()
        if (size + text.length > CHUNK && batch.length > 0) await flush()
        batch.push(node)
        size += text.length
      }
      await flush()
      ipcRenderer.send('translate:done', { count: nodes.length })
    } finally {
      busy = false
    }
  }

  ipcRenderer.on('translate:start', (_event, data: { to?: string }) => {
    void translate(typeof data?.to === 'string' && data.to ? data.to : 'ru')
  })

  ipcRenderer.on('translate:restore', () => {
    if (!original) return
    for (const item of original) if (item.node.isConnected) item.node.nodeValue = item.text
    original = null
  })
}
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

  /**
   * Whether this field is one the browser has something to offer for: the
   * password box itself, or the box the form uses for the account name.
   */
  function loginField(node: EventTarget | null): HTMLInputElement | null {
    if (!(node instanceof HTMLInputElement)) return null
    if (node.matches(PASSWORD)) return node
    const password = passwordFields()[0]
    if (!password) return null
    return usernameFieldFor(password) === node ? node : null
  }

  /**
   * Where the field is, in the page's own coordinates. The browser adds the
   * position of the page inside the window; it cannot know the scroll or the
   * layout, and this side cannot know where the page is drawn.
   */
  function report(field: HTMLInputElement) {
    const rect = field.getBoundingClientRect()
    ipcRenderer.send('autofill:field', {
      host: location.host,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
  }

  const hide = () => ipcRenderer.send('autofill:leave')

  /** The field the offer is currently anchored to, if any. */
  let anchored: HTMLInputElement | null = null

  const follow = () => {
    if (!anchored) return
    // Scrolled out of sight, or the form was replaced under it.
    if (!anchored.isConnected || !visible(anchored)) {
      anchored = null
      hide()
      return
    }
    report(anchored)
  }

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

    // Every click on a login box, not once per page: an offer that came back
    // only if the page reloaded is the one people described as appearing
    // "every other time".
    const open = (event: Event) => {
      const field = loginField(event.target)
      if (!field) return
      anchored = field
      report(field)
    }
    document.addEventListener('focusin', open, true)
    document.addEventListener('click', open, true)
    document.addEventListener(
      'focusout',
      (event) => {
        if (!loginField(event.target)) return
        anchored = null
        hide()
      },
      true
    )
    // The offer is a separate layer over the page, so it does not scroll with
    // it by itself. It follows, and gives up when the field leaves the view.
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !anchored) return
        anchored = null
        hide()
      },
      true
    )
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
