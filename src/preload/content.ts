import { contextBridge, ipcRenderer } from 'electron'
import jsQR from 'jsqr'
import { Readability, isProbablyReaderable } from '@mozilla/readability'
import { keywords, shorten } from '../shared/gist'

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

/**
 * Says we do not have the browser-drawn account chooser, because we do not.
 *
 * Federated sign-in — the "continue with Google" buttons — can go two ways: a
 * popup window to the provider, which this browser opens like any other, or
 * the newer one where the browser itself lists the accounts to pick from.
 * Chromium carries the plumbing for the second; the chooser is part of Chrome
 * and not of the engine, so the call runs into nothing and the button does
 * nothing with it. Every library falls back to the popup when the feature is
 * absent, so absent is what it says.
 */
function noFederatedChooser() {
  const view = window as unknown as Record<string, unknown>
  try {
    delete view.IdentityCredential
    delete view.IdentityProvider
  } catch {
    /* a page that pinned it keeps it, and keeps the dead end with it */
  }
}

/**
 * Nothing starts playing on its own.
 *
 * Chromium's own autoplay policy is a launch switch: it needs a restart, and
 * it is all-or-nothing for the whole browser. This is the same idea taken one
 * page at a time — until a person has clicked, tapped or typed on the page,
 * play() is refused the way the browser itself refuses it, with the rejection
 * sites already know how to handle.
 */
function noAutoplay() {
  let touched = false
  const mark = () => {
    touched = true
  }
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(type, mark, { capture: true, passive: true })
  }

  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (touched) return play.call(this)
    try {
      this.pause()
    } catch {
      /* a element mid-load cannot be paused; refusing the promise is enough */
    }
    return Promise.reject(
      new DOMException('play() failed because the user did not interact with the document first.', 'NotAllowedError')
    )
  }
}

/**
 * YouTube without the ads that arrive inside the video's own response.
 *
 * Two halves, because either alone leaves something through. The player asks
 * for a description of what to play; that answer carries the ad breaks, and
 * they are removed from it as it arrives — from the page's first copy and from
 * every later request. Then, for anything the first half missed, an ad that is
 * actually playing is skipped: the button if there is one, otherwise by moving
 * to the end of it, which is what the button does anyway.
 *
 * Nothing here touches the video itself; the fields removed are the ones whose
 * names say what they hold.
 */
function youtubeWithoutAds() {
  const AD_FIELDS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']

  const strip = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    for (const field of AD_FIELDS) if (field in record) delete record[field]
    if (record.playerResponse) strip(record.playerResponse)
    if (Array.isArray(record.onResponseReceivedActions)) {
      for (const item of record.onResponseReceivedActions) strip(item)
    }
    return value
  }

  // The copy the page is built with, before any script reads it.
  try {
    let held: unknown
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => held,
      set: (value) => {
        held = strip(value)
      }
    })
  } catch {
    /* a page that defined it first keeps its own */
  }

  // And every copy fetched afterwards, which is how the rest of a session's
  // videos arrive.
  const realFetch = window.fetch
  window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const response = await realFetch.apply(this as never, args)
    const url = String(args[0] instanceof Request ? args[0].url : args[0] ?? '')
    if (!/\/youtubei\/v1\/(player|next|reel)/.test(url)) return response
    try {
      const text = await response.clone().text()
      const parsed = strip(JSON.parse(text))
      return new Response(JSON.stringify(parsed), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    } catch {
      return response
    }
  } as typeof fetch

  /** An ad that started anyway: end it. */
  const skip = () => {
    const player = document.querySelector('.html5-video-player')
    if (!player || !player.classList.contains('ad-showing')) return
    const button = document.querySelector<HTMLElement>(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
    )
    if (button) return button.click()
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video')
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = video.duration
    }
  }

  const watch = () => {
    skip()
    const observer = new MutationObserver(skip)
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true })
  } else {
    watch()
  }
}
if (/^https?:$/.test(location.protocol)) {
  try {
    contextBridge.executeInMainWorld({ func: chromeShapes })
    contextBridge.executeInMainWorld({ func: noUnaskedPasskeyPrompt })
    contextBridge.executeInMainWorld({ func: noFederatedChooser })
    // Only where it applies, and only while the blocker is on: this is the
    // blocker doing its job by other means, not a thing of its own.
    // Nothing plays before a person touches the page, when asked for.
    if (ipcRenderer.sendSync('autoplay:blocked') === true) {
      contextBridge.executeInMainWorld({ func: noAutoplay })
    }
    if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname)) {
      if (ipcRenderer.sendSync('ads:on') === true) {
        contextBridge.executeInMainWorld({ func: youtubeWithoutAds })
      }
    }
  } catch {
    /* a page that refuses the call keeps the empty object; nothing else breaks */
  }
}

/**
 * Watching the document for things that arrive late.
 *
 * At document-start there is no <html> yet, and MutationObserver.observe()
 * throws when handed nothing — which does not fail quietly: it takes the whole
 * preload down and with it every page-side feature in this file. So the watch
 * waits for a root to exist, and runs once as soon as one does.
 */
const watchDom = (run: () => void) => {
  const begin = () => {
    const root = document.documentElement
    if (!root) return false
    run()
    new MutationObserver(run).observe(root, { childList: true, subtree: true })
    return true
  }
  if (begin()) return
  // No root yet: the first thing the parser creates is the one to watch for.
  const wait = new MutationObserver(() => {
    if (begin()) wait.disconnect()
  })
  wait.observe(document, { childList: true, subtree: true })
}

const isTop = (() => {
  try {
    return window.top === window
  } catch {
    return false
  }
})()

const httpOrigin = /^https?:$/.test(location.protocol)

/**
 * The browser's own PDF viewer is one of these pages too.
 *
 * It is not a site, so almost nothing here applies to it — but a PDF in a
 * language you do not read is exactly as unreadable as a web page in one, and
 * the translator works on text nodes, which is what the viewer's text layer is
 * made of.
 */
const pdfViewer = location.protocol === 'nya:' && location.host === 'pdf'

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
if (isTop && (httpOrigin || pdfViewer)) {
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
    compare(false)
  })

  /**
   * The original, under the cursor.
   *
   * A translation is a claim about what the page said, and the only way to
   * check it is to see both. Holding the pointer over a translated paragraph
   * shows the sentence it came from — in a bubble, on the spot, without
   * turning the whole page back.
   */
  let comparing = false
  let bubble: HTMLElement | null = null
  const clearBubble = () => {
    bubble?.remove()
    bubble = null
  }

  const showOriginal = (event: MouseEvent) => {
    if (!comparing || !original) return
    const target = event.target as HTMLElement | null
    if (!target || target.closest('nya-original')) return
    // Which of the remembered nodes lives inside what is under the cursor.
    const found = original.find(
      (item) => item.node.isConnected && item.node.parentElement && target.contains(item.node.parentElement)
    )
    if (!found || !found.text.trim()) return clearBubble()
    clearBubble()
    const rect = target.getBoundingClientRect()
    const host = document.createElement('nya-original')
    const width = Math.min(420, Math.max(220, window.innerWidth - 32))
    host.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483644; width: ' +
        width +
        'px; left: ' +
        Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) +
        'px; top: ' +
        (rect.bottom + 8 + 120 > window.innerHeight ? Math.max(8, rect.top - 128) : rect.bottom + 8) +
        'px'
    )
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent =
      '.box { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f3f7;' +
      ' background: rgba(22,23,30,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;' +
      ' padding: 10px 12px; box-shadow: 0 18px 44px -16px rgba(0,0,0,.7); max-height: 200px; overflow: auto }'
    const box = document.createElement('div')
    box.className = 'box'
    box.textContent = found.text.trim()
    shadow.append(style, box)
    document.documentElement.appendChild(host)
    bubble = host
  }

  const compare = (on: boolean) => {
    comparing = on
    clearBubble()
    if (on) document.addEventListener('mouseover', showOriginal, true)
    else document.removeEventListener('mouseover', showOriginal, true)
  }

  ipcRenderer.on('translate:compare', (_event, on: boolean) => compare(on === true))

  /**
   * One word, translated where it stands.
   *
   * Holding Ctrl and pointing at a word is the gesture every dictionary
   * extension has settled on, and it is worth having built in: reading a page
   * in a language you half-know should not mean copying words into another
   * tab. Nothing is sent until the key is held, and only the one word goes.
   */
  {
    let last = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let word: HTMLElement | null = null

    const clearWord = () => {
      word?.remove()
      word = null
    }

    const wordAt = (x: number, y: number): string => {
      const range = (document as unknown as {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
      }).caretRangeFromPoint?.(x, y)
      const node = range?.startContainer
      if (!node || node.nodeType !== Node.TEXT_NODE) return ''
      const text = node.nodeValue ?? ''
      const at = range?.startOffset ?? 0
      const before = text.slice(0, at).match(/[\p{L}\p{M}'’-]*$/u)?.[0] ?? ''
      const after = text.slice(at).match(/^[\p{L}\p{M}'’-]*/u)?.[0] ?? ''
      const whole = (before + after).trim()
      return whole.length > 1 && whole.length < 40 ? whole : ''
    }

    document.addEventListener(
      'mousemove',
      (event) => {
        if (!event.ctrlKey) {
          last = ''
          if (timer) clearTimeout(timer)
          timer = null
          return clearWord()
        }
        const found = wordAt(event.clientX, event.clientY)
        if (!found || found === last) return
        last = found
        if (timer) clearTimeout(timer)
        const x = event.clientX
        const y = event.clientY
        timer = setTimeout(async () => {
          const answer: string[] = await ipcRenderer.invoke('translate:batch', [found], 'auto')
          const said = answer?.[0]
          if (!said || said.toLowerCase() === found.toLowerCase()) return
          clearWord()
          const host = document.createElement('nya-word')
          host.setAttribute(
            'style',
            'all: initial; position: fixed; z-index: 2147483645; left: ' +
              Math.min(x, window.innerWidth - 260) +
              'px; top: ' +
              (y + 18) +
              'px; max-width: 250px'
          )
          const shadow = host.attachShadow({ mode: 'open' })
          const style = document.createElement('style')
          style.textContent =
            '.w { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f3f7;' +
            ' background: rgba(22,23,30,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 10px;' +
            ' padding: 7px 10px; box-shadow: 0 14px 34px -14px rgba(0,0,0,.7) }' +
            '.src { color: rgba(242,243,247,.6); font-size: 11px; display: block }'
          const box = document.createElement('div')
          box.className = 'w'
          const src = document.createElement('span')
          src.className = 'src'
          src.textContent = found
          const to = document.createElement('span')
          to.textContent = said
          box.append(src, to)
          shadow.append(style, box)
          document.documentElement.appendChild(host)
          word = host
        }, 260)
      },
      true
    )

    window.addEventListener('keyup', (event) => {
      if (event.key === 'Control') {
        last = ''
        clearWord()
      }
    })
    window.addEventListener('blur', clearWord)
  }
}
if (isTop && httpOrigin) {
  const PASSWORD = 'input[type="password"]:not([disabled]):not([readonly])'
  const USERNAME_HINTS = /user|login|email|mail|phone|tel|account|логин|почта|телефон/i

  const visible = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 20 && rect.height > 8
  }

  /**
   * The password boxes on the page, or — when a field says which form it
   * belongs to — the ones on that form.
   *
   * The scope matters on a page with more than one form. Looking at the whole
   * document meant the sign-in box at the top decided what every other form on
   * the page was, and a second login form further down got no offer at all.
   */
  const passwordFields = (near?: Element | null) => {
    const form = (near as HTMLInputElement | null)?.form
    const scope: ParentNode = form ?? document
    return Array.from(scope.querySelectorAll<HTMLInputElement>(PASSWORD)).filter(visible)
  }

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

  /* ------------------------------------------------ paying and posting */

  /**
   * What a field is for. `autocomplete` is the honest answer whenever a form
   * bothers to give one, and most shops do for payment because the browsers
   * they were tested against need it. The rest is the names forms actually
   * use, in the two languages this browser is most often read in.
   */
  /**
   * What a form says outright. autocomplete is not a hint to be weighed
   * against other hints — it is the form telling you what the box is for, so
   * it is answered exactly and nothing else is consulted.
   */
  const DECLARED: Record<string, string> = {
    'cc-number': 'cc-number',
    'cc-name': 'cc-name',
    'cc-given-name': 'cc-name',
    'cc-family-name': 'cc-name',
    'cc-exp': 'cc-exp',
    'cc-exp-month': 'cc-exp-month',
    'cc-exp-year': 'cc-exp-year',
    'cc-csc': 'cc-csc',
    'postal-code': 'postcode',
    country: 'country',
    'country-name': 'country',
    'address-level1': 'region',
    'address-level2': 'city',
    'street-address': 'street',
    'address-line1': 'street',
    'address-line2': 'street',
    'address-line3': 'flat',
    tel: 'tel',
    'tel-national': 'tel',
    'tel-local': 'tel',
    email: 'email',
    name: 'name',
    'given-name': 'name',
    'family-name': 'name',
    'additional-name': 'name'
  }

  /**
   * And what a form only implies: the words it puts on and around the box.
   * Looser, and in the order that settles the overlaps — a box labelled «Дом»
   * is a house number before it is an address.
   */
  const PURPOSES: Array<[string, RegExp]> = [
    ['cc-number', /cardnumber|card.?number|numero.?card|номер.?карт/i],
    ['cc-name', /card.?holder|holder.?name|name.?on.?card|ccname|владел|держател|имя.?(на|с)?.?карт/i],
    ['cc-csc', /cvv|cvc|csc|security.?code|код.?(безопас|прове)/i],
    ['cc-exp-month', /ccmonth|exp.?month|month.*(exp|card)|месяц/i],
    ['cc-exp-year', /ccyear|exp.?year|year.*(exp|card)|год/i],
    ['cc-exp', /expir|valid.?thru|mm.?\/?.?yy|срок|действ/i],
    ['postcode', /postcode|postal|\bzip\b|индекс|почтовый.?инд/i],
    ['country', /country|страна/i],
    ['region', /region|province|oblast|область|регион|\bкрай\b/i],
    ['city', /\bcity\b|town|locality|город|насел.?пункт/i],
    ['flat', /apartment|\bflat\b|suite|кварт|офис/i],
    ['house', /house|building|\bдом\b|корпус|\bстро\b/i],
    ['street', /street|address|адрес|улиц/i],
    ['tel', /phone|mobile|\btel\b|телефон/i],
    ['email', /e-?mail|почт/i],
    ['name', /full.?name|recipient|\bfio\b|получател|фамил|\bимя\b|\bфио\b/i]
  ]

  const CARD_PURPOSES = new Set([
    'cc-number',
    'cc-name',
    'cc-exp',
    'cc-exp-month',
    'cc-exp-year',
    'cc-csc'
  ])

  type Purpose = string | null

  function purposeOf(node: Element): Purpose {
    if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLSelectElement)) return null
    if (node instanceof HTMLInputElement) {
      const type = (node.type || 'text').toLowerCase()
      if (!['text', 'tel', 'email', 'number', 'search', ''].includes(type)) return null
    }
    if (node.disabled) return null
    // 'shipping cc-number' and 'section-one billing email' are both legal:
    // the part that says what the box is for is the last word.
    const auto = (node.autocomplete || '').toLowerCase().trim().split(/\s+/).pop() ?? ''
    if (DECLARED[auto]) return DECLARED[auto]
    // The label is often the only word a form gives a box — «Страна» over an
    // input called `cty` is a country field to everyone but a program that
    // refuses to look.
    const labels = Array.from(node.labels ?? [])
      .map((label) => label.textContent ?? '')
      .join(' ')
      .slice(0, 80)
    const hay = `${node.name} ${node.id} ${node.getAttribute('placeholder') ?? ''} ${node.getAttribute('aria-label') ?? ''} ${labels}`
    for (const [purpose, pattern] of PURPOSES) if (pattern.test(hay)) return purpose
    return null
  }

  /** Which kind of thing this field belongs to, if any. */
  function fieldKind(node: EventTarget | null): 'card' | 'address' | null {
    if (!(node instanceof HTMLElement)) return null
    if (!visible(node)) return null
    const purpose = purposeOf(node)
    if (!purpose) return null
    if (CARD_PURPOSES.has(purpose)) return 'card'
    // A lone name or phone box is a sign-in as often as it is a delivery
    // form; an address is only worth offering where the form asks for one.
    const around = (node as HTMLInputElement).form ?? document
    const purposes = new Set(
      Array.from(around.querySelectorAll('input, select'))
        .map((el) => purposeOf(el))
        .filter(Boolean) as string[]
    )
    const posting = ['street', 'city', 'postcode', 'house', 'region'].filter((p) =>
      purposes.has(p)
    )
    return posting.length >= 2 ? 'address' : null
  }

  /** Sets a text box or picks an option in a list, whichever this is. */
  function fillField(el: Element, value: string) {
    if (!value) return
    if (el instanceof HTMLInputElement) return setValue(el, value)
    if (!(el instanceof HTMLSelectElement)) return
    const want = value.trim().toLowerCase()
    const number = Number(want)
    const option = Array.from(el.options).find((o) => {
      const text = o.text.trim().toLowerCase()
      const own = o.value.trim().toLowerCase()
      if (text === want || own === want) return true
      // Months and years come as numbers in lists written either way: 4,
      // 04, 2030, 30.
      if (!Number.isNaN(number) && number > 0) {
        if (Number(own) === number || Number(text) === number) return true
        if (number > 2000 && (Number(own) === number % 100 || Number(text) === number % 100)) return true
      }
      return false
    })
    if (!option) return
    el.value = option.value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** Every field of a given purpose near the one that was clicked. */
  function fieldsFor(anchor: Element | null): Map<string, Element[]> {
    const scope: ParentNode = (anchor as HTMLInputElement | null)?.form ?? document
    const found = new Map<string, Element[]>()
    for (const el of Array.from(scope.querySelectorAll('input, select'))) {
      const purpose = purposeOf(el)
      if (!purpose || !visible(el as HTMLElement)) continue
      found.set(purpose, [...(found.get(purpose) ?? []), el])
    }
    return found
  }

  let announced = ''

  /**
   * Whether this field is one the browser has something to offer for: the
   * password box itself, or the box the form uses for the account name.
   */
  function loginField(node: EventTarget | null): HTMLInputElement | null {
    if (!(node instanceof HTMLInputElement)) return null
    if (node.matches(PASSWORD)) return node
    const password = passwordFields(node)[0]
    if (password) return usernameFieldFor(password) === node ? node : null
    // A sign-in that asks for the address first and the password on the next
    // screen — which is how Google does it — has no password field to work
    // back from, so the field has to say for itself that it is one.
    const type = (node.type || 'text').toLowerCase()
    if (!['text', 'email', 'tel', ''].includes(type)) return null
    if (!visible(node)) return null
    const auto = (node.autocomplete || '').toLowerCase()
    if (auto === 'username' || auto === 'email') return node
    if (type === 'email') return node
    const hay = `${node.name} ${node.id} ${node.placeholder} ${node.getAttribute('aria-label') ?? ''}`
    return USERNAME_HINTS.test(hay) ? node : null
  }

  /** Words a box asking for a one-time code is labelled with. */
  const CODE_HINTS =
    /one-?time|onetime|otp|2fa|totp|verification|verify|auth.?code|security.?code|код|одноразов|подтвержд/i

  /**
   * A box waiting for the six digits from an authenticator app.
   *
   * Most of these say so outright — `autocomplete="one-time-code"` is what
   * both Apple and Google ask sites to use, and the ones that care do. The
   * rest are recognised by shape: a short numeric box labelled with one of the
   * words above. A card's security code is deliberately excluded; it looks the
   * same and means something else entirely.
   */
  function codeInput(node: EventTarget | null): HTMLInputElement | null {
    if (!(node instanceof HTMLInputElement)) return null
    if (!visible(node)) return null
    if (node.matches(PASSWORD)) return null
    const auto = (node.autocomplete || '').toLowerCase()
    if (auto.includes('one-time-code')) return node
    if (purposeOf(node) === 'cc-csc') return null
    const type = (node.type || 'text').toLowerCase()
    if (!['text', 'tel', 'number', ''].includes(type)) return null
    const hay = `${node.name} ${node.id} ${node.placeholder} ${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('inputmode') ?? ''}`
    if (!CODE_HINTS.test(hay)) return null
    // A long free-text box labelled "code" is a coupon, not a second factor.
    const max = node.maxLength
    return max <= 0 || max <= 10 ? node : null
  }

  /**
   * A password box being asked to hold a new password rather than an old one:
   * a sign-up, or the second half of a change-password form. Both are the
   * moment to offer a generated one.
   */
  function newPasswordField(field: HTMLInputElement): boolean {
    const auto = (field.autocomplete || '').toLowerCase()
    if (auto.includes('new-password')) return true
    if (auto.includes('current-password')) return false
    // Two password boxes on one form is the shape of every "type it twice".
    const scope: ParentNode = field.form ?? document
    const boxes = Array.from(scope.querySelectorAll(PASSWORD)).filter((el) =>
      visible(el as HTMLElement)
    )
    return boxes.length >= 2
  }

  /**
   * Where this form actually sends what is typed into it.
   *
   * Almost always the page's own site, and then this says nothing. When it is
   * not — a login box on one site posting to another — that is worth showing
   * before a password goes into it, because the address bar does not say it
   * and nothing else will.
   */
  function postsTo(field: HTMLElement): string {
    const form = (field as HTMLInputElement).form
    const action = form?.getAttribute('action')
    if (!action) return ''
    try {
      const where = new URL(action, location.href)
      if (!/^https?:/.test(where.protocol)) return ''
      const here = location.host.replace(/^www\./, '')
      const there = where.host.replace(/^www\./, '')
      if (!there || there === here) return ''
      // Same site, different name: mail.example.com posting to example.com is
      // ordinary and saying so would only teach people to ignore the warning.
      const tail = (h: string) => h.split('.').slice(-2).join('.')
      return tail(there) === tail(here) ? '' : there
    } catch {
      return ''
    }
  }

  /**
   * Where the field is, in the page's own coordinates. The browser adds the
   * position of the page inside the window; it cannot know the scroll or the
   * layout, and this side cannot know where the page is drawn.
   */
  function report(
    field: HTMLElement,
    kind: 'login' | 'card' | 'address' | 'code' | 'new-password' = 'login'
  ) {
    const rect = field.getBoundingClientRect()
    ipcRenderer.send('autofill:field', {
      host: location.host,
      kind,
      postsTo: kind === 'login' || kind === 'new-password' ? postsTo(field) : '',
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
  }

  const hide = () => ipcRenderer.send('autofill:leave')

  /** The field the offer is currently anchored to, if any. */
  let anchored: HTMLElement | null = null
  /** and what it was asking for */
  let anchoredKind: 'login' | 'card' | 'address' | 'code' | 'new-password' = 'login'

  const follow = () => {
    if (!anchored) return
    // Scrolled out of sight, or the form was replaced under it.
    if (!anchored.isConnected || !visible(anchored)) {
      anchored = null
      hide()
      return
    }
    report(anchored, anchoredKind)
  }

  const announce = () => {
    const fields = passwordFields()
    const key = `${location.host}:${fields.length}`
    if (!fields.length || key === announced) return
    announced = key
    ipcRenderer.send('autofill:form', { host: location.host })
  }

  /**
   * A form was sent. `near` is whatever the browser was told about it — the
   * element submitted, or the button pressed — so that on a page with several
   * forms the right one is read.
   */
  const reportSubmission = (near?: Element | null) => {
    const password = passwordFields(near)[0] ?? passwordFields()[0]
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
    const password = passwordFields(anchored as Element | null)[0] ?? passwordFields()[0]
    if (!password) return
    const username = usernameFieldFor(password)
    if (username && data.username) setValue(username, data.username)
    setValue(password, data.password)
    password.focus()
  })

  // A card, put in by somebody who picked it. The security code is not here
  // because it is not kept anywhere — it is the part a person types.
  ipcRenderer.on(
    'autofill:fill-card',
    (
      _event,
      data: { host: string; number: string; holder: string; month: number; year: number }
    ) => {
      if (!data || data.host !== location.host) return
      const fields = fieldsFor(anchored)
      const put = (purpose: string, value: string) => {
        for (const el of fields.get(purpose) ?? []) fillField(el, value)
      }
      put('cc-number', data.number)
      put('cc-name', data.holder)
      const mm = String(data.month).padStart(2, '0')
      const yyyy = String(data.year)
      put('cc-exp-month', mm)
      put('cc-exp-year', yyyy)
      // One box for both is written a dozen ways; the form's own maxlength
      // says which of them it wants.
      for (const el of fields.get('cc-exp') ?? []) {
        const max = el instanceof HTMLInputElement ? el.maxLength : -1
        fillField(el, max > 0 && max <= 5 ? `${mm}/${yyyy.slice(2)}` : `${mm}/${yyyy}`)
      }
      const first = (fields.get('cc-csc') ?? [])[0]
      // Straight to the one box that was deliberately left empty.
      if (first instanceof HTMLElement) first.focus()
    }
  )

  /**
   * Six digits into whatever shape the form asks for them in: one box, or six
   * boxes of one character each, which is how most of these are drawn now.
   */
  ipcRenderer.on('autofill:fill-code', (_event, data: { host: string; digits: string }) => {
    if (!data || data.host !== location.host || !anchored) return
    const field = anchored as HTMLInputElement
    const scope: ParentNode = field.form ?? document
    const boxes = Array.from(scope.querySelectorAll('input')).filter(
      (el) => visible(el) && el.maxLength === 1 && !el.disabled && !el.readOnly
    )
    if (boxes.length >= data.digits.length && boxes.includes(field)) {
      const from = boxes.indexOf(field)
      data.digits.split('').forEach((digit, i) => {
        const box = boxes[from + i]
        if (box) setValue(box, digit)
      })
      boxes[from + data.digits.length - 1]?.focus()
      return
    }
    setValue(field, data.digits)
    field.focus()
  })

  /** The same password into every box on the form that asks for one. */
  ipcRenderer.on('autofill:fill-new', (_event, data: { host: string; password: string }) => {
    if (!data || data.host !== location.host) return
    const scope: ParentNode = (anchored as HTMLInputElement | null)?.form ?? document
    const boxes = Array.from(scope.querySelectorAll(PASSWORD)).filter((el) =>
      visible(el as HTMLElement)
    ) as HTMLInputElement[]
    for (const box of boxes) setValue(box, data.password)
    boxes[0]?.focus()
  })

  ipcRenderer.on(
    'autofill:fill-address',
    (_event, data: { host: string; fields: Record<string, string> }) => {
      if (!data || data.host !== location.host) return
      const boxes = fieldsFor(anchored)
      const put = (purpose: string, value: string) => {
        for (const el of boxes.get(purpose) ?? []) fillField(el, value)
      }
      const f = data.fields ?? {}
      put('name', f.name)
      put('tel', f.phone)
      put('email', f.email)
      put('country', f.country)
      put('region', f.region)
      put('city', f.city)
      put('postcode', f.postcode)
      put('house', f.house)
      put('flat', f.flat)
      // A form with no separate box for the house number expects it in the
      // street line, which is how most of them are written.
      const hasHouse = (boxes.get('house') ?? []).length > 0
      put('street', hasHouse ? f.street : [f.street, f.house].filter(Boolean).join(', '))
    }
  )

  const start = () => {
    announce()

    // Every click on a login box, not once per page: an offer that came back
    // only if the page reloaded is the one people described as appearing
    // "every other time".
    const open = (event: Event) => {
      const code = codeInput(event.target)
      if (code) {
        anchored = code
        anchoredKind = 'code'
        return report(code, 'code')
      }
      const field = loginField(event.target)
      if (field) {
        anchored = field
        anchoredKind = field.matches(PASSWORD) && newPasswordField(field) ? 'new-password' : 'login'
        return report(field, anchoredKind)
      }
      // A card or a delivery form: the same offer, from the same vault.
      const kind = fieldKind(event.target)
      if (!kind) return
      anchored = event.target as HTMLElement
      anchoredKind = kind
      report(anchored, kind)
    }
    document.addEventListener('focusin', open, true)
    document.addEventListener('click', open, true)
    document.addEventListener(
      'focusout',
      (event) => {
        if (!loginField(event.target) && !fieldKind(event.target) && !codeInput(event.target)) return
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

    document.addEventListener(
      'submit',
      (event) => reportSubmission(event.target as Element | null),
      true
    )
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null
        if (!target) return
        const button = target.closest('button, input[type="submit"], [role="button"]')
        if (button) setTimeout(() => reportSubmission(button), 0)
      },
      true
    )
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return
        const target = event.target as Element | null
        setTimeout(() => reportSubmission(target), 0)
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

/* ==========================================================================
 * What was typed and never sent
 *
 * Twenty minutes into a comment, a support ticket or an application form, the
 * session expires, the tab crashes, or a stray Backspace goes back a page.
 * Every browser loses that and nobody is surprised any more.
 *
 * So the ordinary text boxes on a page are watched — and only those. A
 * password box is never read here; neither is a card number, a security code
 * or a one-time code. The rest is handed to the browser under this address,
 * kept for a day, and offered back once, in a bubble that has to be clicked.
 * ====================================================================== */
{
  /** Never kept, whatever it is labelled: this is about comments, not secrets. */
  const NEVER = /pass|secret|cvc|csc|cvv|card|one-?time|otp|token|пароль|карт|код|секрет/i
  /** Below this the "draft" is a search box, and offering it back is noise. */
  const WORTH = 30

  const words = {
    title: 'Здесь остался незаконченный текст',
    restore: 'Восстановить',
    dismiss: 'Не нужно'
  }
  ipcRenderer.on('draft:words', (_event, next: Partial<typeof words>) => {
    if (next && typeof next === 'object') Object.assign(words, next)
  })

  const seen = () => location.href

  /** Boxes worth remembering: ordinary text, typed by a person, not a secret. */
  function boxes(): Array<HTMLInputElement | HTMLTextAreaElement> {
    const all = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    )
    return all.filter((el) => {
      if (el.disabled || el.readOnly) return false
      const rect = el.getBoundingClientRect()
      if (rect.width < 24 || rect.height < 12) return false
      if (el instanceof HTMLTextAreaElement) return true
      const type = (el.type || 'text').toLowerCase()
      if (!['text', 'email', 'tel', 'url', 'search', 'number', ''].includes(type)) return false
      const auto = (el.autocomplete || '').toLowerCase()
      if (auto.startsWith('cc-') || auto.includes('one-time-code')) return false
      const hay = `${el.name} ${el.id} ${el.getAttribute('aria-label') ?? ''} ${el.placeholder}`
      return !NEVER.test(hay)
    })
  }

  /**
   * A name for a box that survives a reload. The page's own name or id where
   * there is one — those are stable — and otherwise its place in the document,
   * which is stable enough for a form that has not changed since.
   */
  function keyOf(el: Element, index: number): string {
    const named = el as HTMLInputElement
    const tag = el.tagName.toLowerCase()
    if (named.name) return `${tag}|n:${named.name}`
    if (named.id) return `${tag}|i:${named.id}`
    return `${tag}|p:${index}`
  }

  /**
   * Put text back the way a person would: through the property setter the page
   * framework has wrapped, so React and the rest see the change. Textareas and
   * inputs keep their value on different prototypes.
   */
  function put(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const descriptor = Object.getOwnPropertyDescriptor(proto.prototype, 'value')
    descriptor?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  let timer: ReturnType<typeof setTimeout> | null = null

  const collect = () => {
    const fields: Record<string, string> = {}
    let total = 0
    boxes().forEach((el, index) => {
      const value = el.value
      if (!value || value.length > 20000) return
      fields[keyOf(el, index)] = value
      total += value.length
    })
    return { fields, total }
  }

  const keep = () => {
    const { fields, total } = collect()
    // A page with nothing in it clears what was kept: emptying a form on
    // purpose should not leave the old text waiting to come back.
    if (total > 0 && total < WORTH) return
    ipcRenderer.send('draft:keep', { url: seen(), fields })
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(keep, 900)
  }

  /* ------------------------------------------------------------ the offer */
  let bubble: HTMLElement | null = null
  const clear = () => {
    bubble?.remove()
    bubble = null
  }

  function offer(fields: Record<string, string>) {
    clear()
    const host = document.createElement('nya-draft')
    host.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483645; right: 16px; bottom: 16px; width: 300px'
    )
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '@keyframes nya-draft-in { from { opacity: 0; transform: translateY(8px) }',
      '  to { opacity: 1; transform: translateY(0) } }',
      '.box { animation: nya-draft-in .22s cubic-bezier(.22,1,.36,1) both;',
      '  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f3f7;',
      '  background: rgba(22,23,30,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;',
      '  padding: 11px 13px; box-shadow: 0 18px 44px -16px rgba(0,0,0,.7) }',
      '.row { display: flex; gap: 8px; margin-top: 10px }',
      '.btn { font: 600 12px system-ui, sans-serif; color: #c4bcff; background: rgba(124,108,255,.18);',
      '  border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer }',
      '.btn.plain { color: rgba(242,243,247,.72); background: rgba(255,255,255,.08) }'
    ].join(' ')
    const box = document.createElement('div')
    box.className = 'box'
    const line = document.createElement('span')
    line.textContent = words.title
    const row = document.createElement('div')
    row.className = 'row'
    const yes = document.createElement('button')
    yes.className = 'btn'
    yes.textContent = words.restore
    yes.addEventListener('click', () => {
      boxes().forEach((el, index) => {
        const value = fields[keyOf(el, index)]
        if (typeof value === 'string' && !el.value) put(el, value)
      })
      ipcRenderer.send('draft:drop', seen())
      clear()
    })
    const no = document.createElement('button')
    no.className = 'btn plain'
    no.textContent = words.dismiss
    no.addEventListener('click', () => {
      ipcRenderer.send('draft:drop', seen())
      clear()
    })
    row.append(yes, no)
    box.append(line, row)
    shadow.append(style, box)
    document.documentElement.appendChild(host)
    bubble = host
  }

  ipcRenderer.on('draft:have', (_event, data: { url: string; fields: Record<string, string> }) => {
    if (!data || data.url !== seen()) return
    // Only where the form is empty. A page that restored its own draft — which
    // some editors do — must not be asked about it again.
    const filled = boxes().some((el) => el.value.trim().length > 0)
    if (filled) return
    const worth = Object.values(data.fields ?? {}).join('').length
    if (worth < WORTH) return
    offer(data.fields)
  })

  const startDrafts = () => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return
    ipcRenderer.send('draft:ask', seen())
    document.addEventListener('input', schedule, true)
    // Sent is finished with: what the form did with it is the form's business.
    document.addEventListener(
      'submit',
      () => {
        if (timer) clearTimeout(timer)
        ipcRenderer.send('draft:drop', seen())
        clear()
      },
      true
    )
    // Leaving with the text still in the boxes is exactly the case this is for.
    window.addEventListener('pagehide', keep)
    window.addEventListener('beforeunload', keep)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDrafts, { once: true })
  } else {
    startDrafts()
  }
}

/* ==========================================================================
 * Somebody is here
 *
 * One bit, sent at most once a second: a person touched this page. The browser
 * uses it for exactly one question — whether a download that just started was
 * asked for by anybody. Nothing about what was pressed is sent, because
 * nothing about it is needed.
 * ====================================================================== */
{
  let last = 0
  const touched = () => {
    const now = Date.now()
    if (now - last < 1000) return
    last = now
    ipcRenderer.send('page:gesture')
  }
  for (const kind of ['pointerdown', 'keydown', 'wheel'] as const) {
    document.addEventListener(kind, touched, { capture: true, passive: true })
  }
}

/* ==========================================================================
 * Everything on this page that is a file
 *
 * A gallery, a page of documents, an album of scans: every one of them ends
 * with the same twenty minutes of right-click, save as, right-click, save as.
 * The browser asks the page once, the page answers with the list, and the
 * person ticks what they want.
 *
 * Only what the page itself links to or shows. Nothing is guessed from an
 * address, and nothing is fetched here.
 * ====================================================================== */
{
  /** Endings worth offering. An .html link is a page, not a file. */
  const FILE_RE =
    /\.(pdf|docx?|xlsx?|pptx?|odt|ods|rtf|txt|csv|epub|fb2|djvu|zip|rar|7z|tar|gz|bz2|xz|iso|dmg|exe|msi|apk|deb|rpm|mp3|m4a|flac|wav|ogg|opus|mp4|mkv|webm|mov|avi|m4v|png|jpe?g|gif|webp|avif|bmp|svg|ttf|otf|woff2?)(\?|#|$)/i

  interface Found {
    url: string
    name: string
    kind: 'picture' | 'media' | 'file'
  }

  const nameOf = (url: string) => {
    try {
      const path = new URL(url, location.href).pathname
      return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '') || url
    } catch {
      return url
    }
  }

  const absolute = (url: string | null | undefined): string => {
    if (!url) return ''
    try {
      const full = new URL(url, location.href)
      return /^https?:$/.test(full.protocol) ? full.toString() : ''
    } catch {
      return ''
    }
  }

  ipcRenderer.on('page:harvest', () => {
    const seen = new Set<string>()
    const found: Found[] = []
    const add = (url: string, kind: Found['kind']) => {
      if (!url || seen.has(url) || found.length >= 300) return
      seen.add(url)
      found.push({ url, name: nameOf(url), kind })
    }

    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const url = absolute(a.getAttribute('href'))
      // A link with a download attribute is a file whatever it is called.
      if (url && (FILE_RE.test(url) || a.hasAttribute('download'))) add(url, 'file')
    }
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const picture = img as HTMLImageElement
      // Thumbnails and spacers are not what anybody means by "the pictures".
      if (picture.naturalWidth > 0 && picture.naturalWidth < 150) continue
      add(absolute(picture.currentSrc || picture.src), 'picture')
    }
    for (const media of Array.from(document.querySelectorAll('video, audio, source'))) {
      add(absolute(media.getAttribute('src')), 'media')
    }
    ipcRenderer.send('page:files', { host: location.host, files: found.slice(0, 300) })
  })
}

/* ==========================================================================
 * Mouse gestures
 *
 * Hold the right button and draw: left for back, right for forward, down for
 * a new tab, up to reload, down-then-right to close the tab. It is off unless
 * somebody turns it on, because a browser that reacts to a right-drag nobody
 * meant is worse than one without gestures.
 *
 * The stroke is read as a sequence of directions rather than a shape: a line
 * drawn by hand is never straight, and what people mean by "left" is "mostly
 * left, eventually".
 * ====================================================================== */
{
  /** How far the pointer has to travel before a wobble counts as a direction. */
  const STEP = 30

  let on = false
  let drawing = false
  let moved = false
  let lastX = 0
  let lastY = 0
  let path = ''

  ipcRenderer.on('gesture:on', (_event, value: boolean) => {
    on = value === true
  })

  const finish = () => {
    drawing = false
    if (path) ipcRenderer.send('gesture:done', path)
    path = ''
  }

  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!on || event.button !== 2) return
      drawing = true
      moved = false
      path = ''
      lastX = event.clientX
      lastY = event.clientY
    },
    true
  )

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!drawing) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      if (Math.abs(dx) < STEP && Math.abs(dy) < STEP) return
      const step = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'
      lastX = event.clientX
      lastY = event.clientY
      moved = true
      // Four steps is more than any gesture here needs, and stops a scribble
      // from becoming a string nothing matches.
      if (path[path.length - 1] !== step && path.length < 4) path += step
    },
    true
  )

  window.addEventListener('pointerup', (event) => {
    if (!drawing || event.button !== 2) return
    finish()
  }, true)

  // A gesture must not also open the menu; a plain right-click still must.
  window.addEventListener(
    'contextmenu',
    (event) => {
      if (!on || !moved) return
      moved = false
      event.preventDefault()
      event.stopPropagation()
    },
    true
  )
}

/* ==========================================================================
 * What this page said
 *
 * History remembers titles; people remember sentences. So the opening of the
 * page's own text is handed over once, a moment after it settles, and the
 * history page can be searched for a phrase rather than for a name.
 *
 * Only the main document, only http and https, and only what is visible: no
 * scripts, no styles, no navigation. A private window never gets here at all,
 * because the browser does not ask.
 * ====================================================================== */
{
  const SKIP = /^(script|style|noscript|nav|header|footer|aside|svg|template)$/i

  const visibleText = (): string => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement
        if (!parent || SKIP.test(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (!(node.nodeValue ?? '').trim()) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })
    const parts: string[] = []
    let total = 0
    for (let node = walker.nextNode(); node && total < 6000; node = walker.nextNode()) {
      const piece = (node.nodeValue ?? '').trim()
      parts.push(piece)
      total += piece.length + 1
    }
    return parts.join(' ')
  }

  ipcRenderer.on('page:read-text', () => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return
    ipcRenderer.send('page:text', { url: location.href, title: document.title, text: visibleText() })
  })
}

/* ==========================================================================
 * Everything else about what is playing
 *
 * The browser already knows what a tab is playing and can start, stop and
 * seek it. This is the rest of what people do with a video or a track: come
 * back to where they stopped, keep one loud site quieter than the others, make
 * speech audible on a bad recording, fall asleep to something, take a frame
 * out of it, turn the subtitles on, skip the silences, and keep the player in
 * sight while reading the page under it.
 *
 * All of it lives in the page, over the ordinary <video> and <audio> elements,
 * and none of it needs the site's cooperation.
 * ====================================================================== */
if (isTop && httpOrigin) {
  /** How this site is set, as the browser remembers it. */
  interface MediaLook {
    rate: number
    volume: number
    /** an upper bound for this site, as a share of full volume */
    ceiling: number
    /** even out the loud and the quiet parts */
    level: boolean
    /** lift the range speech lives in */
    voice: boolean
    /** turn subtitles on by themselves where there are any */
    subtitles: boolean
    /** run through the quiet parts rather than sitting through them */
    skipSilence: boolean
  }

  let look: MediaLook = {
    rate: 1,
    volume: 1,
    ceiling: 1,
    level: false,
    voice: false,
    subtitles: false,
    skipSilence: false
  }

  /** What the player says, in the language the browser wears. */
  const words = {
    replay: 'Назад на 15 секунд',
    frame: 'Снимок кадра',
    sleep: 'Таймер сна',
    off: 'Выключить',
    minutes: 'мин',
    speed: 'Скорость',
    chapters: 'Главы'
  }
  ipcRenderer.on('media:words', (_event, next: Partial<typeof words>) => {
    if (next && typeof next === 'object') Object.assign(words, next)
  })

  const media = () =>
    Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio')).filter(
      (el) => el.readyState > 0 || el.currentSrc || el.src
    )

  /** Whatever is playing, or the last thing that was. */
  const current = (): HTMLMediaElement | null => {
    const all = media()
    return (
      all.find((el) => !el.paused && !el.ended) ??
      all.find((el) => el.currentTime > 0 && !el.ended) ??
      all[0] ??
      null
    )
  }

  /* ---------------------------------------------------- where you stopped */

  /**
   * Coming back to where you were.
   *
   * A forty-minute talk closed at minute twenty-six reopens at minute
   * twenty-six. The position is kept by the browser against the address, not
   * by the site, so it works on the sites that never bothered — which is most
   * of them. Anything under two minutes is not worth remembering, and anything
   * within thirty seconds of the end is finished.
   */
  const remember = (el: HTMLMediaElement) => {
    if (!Number.isFinite(el.duration) || el.duration < 120) return
    const at = el.currentTime
    if (at < 20 || at > el.duration - 30) {
      ipcRenderer.send('media:forget', { url: location.href })
      return
    }
    ipcRenderer.send('media:position', { url: location.href, at: Math.round(at), of: Math.round(el.duration) })
  }

  ipcRenderer.on('media:resume-at', (_event, at: number) => {
    const el = current()
    if (!el || typeof at !== 'number' || at < 20) return
    if (!Number.isFinite(el.duration) || at > el.duration - 30) return
    // Only if the page has not already put it somewhere itself.
    if (el.currentTime > 5) return
    el.currentTime = at
  })

  /* -------------------------------------------------------- the sound path */

  /**
   * One audio graph per element, built the first time it is needed.
   *
   * A MediaElementSource can only be made once per element and takes the sound
   * away from the element for good, so it is made only when something actually
   * needs it — levelling, voice lift or silence-skipping — and kept.
   */
  interface Chain {
    ctx: AudioContext
    gain: GainNode
    compressor: DynamicsCompressorNode
    voice: BiquadFilterNode
    analyser: AnalyserNode
  }
  const chains = new WeakMap<HTMLMediaElement, Chain>()

  function chainFor(el: HTMLMediaElement): Chain | null {
    const found = chains.get(el)
    if (found) return found
    try {
      const ctx = new AudioContext()
      const source = ctx.createMediaElementSource(el)
      const compressor = ctx.createDynamicsCompressor()
      // Gentle: the point is to stop a whisper and an explosion being forty
      // decibels apart, not to squash the music flat.
      compressor.threshold.value = -28
      compressor.knee.value = 24
      compressor.ratio.value = 4
      compressor.attack.value = 0.01
      compressor.release.value = 0.25
      const voice = ctx.createBiquadFilter()
      // Two to four kilohertz is where consonants live; lifting it is what
      // makes a badly mixed film audible without turning everything up.
      voice.type = 'peaking'
      voice.frequency.value = 2600
      voice.Q.value = 0.9
      voice.gain.value = 0
      const gain = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(compressor)
      compressor.connect(voice)
      voice.connect(gain)
      gain.connect(analyser)
      analyser.connect(ctx.destination)
      const chain = { ctx, gain, compressor, voice, analyser }
      chains.set(el, chain)
      return chain
    } catch {
      // Cross-origin media cannot be routed; the plain element still plays.
      return null
    }
  }

  /** Puts the whole of this site's settings onto one element. */
  function apply(el: HTMLMediaElement) {
    if (look.rate !== 1) el.playbackRate = look.rate
    const wanted = Math.min(look.volume, look.ceiling)
    if (wanted < 1) el.volume = Math.max(0, Math.min(1, wanted))
    if (look.subtitles) showSubtitles(el)
    if (look.level || look.voice || look.skipSilence) {
      const chain = chainFor(el)
      if (chain) {
        void chain.ctx.resume()
        chain.compressor.ratio.value = look.level ? 4 : 1
        chain.compressor.threshold.value = look.level ? -28 : 0
        chain.voice.gain.value = look.voice ? 7 : 0
      }
    }
  }

  /** The first subtitle track there is, shown. */
  function showSubtitles(el: HTMLMediaElement) {
    const tracks = Array.from(el.textTracks ?? [])
    const wanted =
      tracks.find((track) => track.kind === 'captions' || track.kind === 'subtitles') ?? null
    if (!wanted) return
    if (tracks.some((track) => track.mode === 'showing')) return
    wanted.mode = 'showing'
  }

  /* -------------------------------------------------- running past silence */

  /**
   * The quiet parts, at speed.
   *
   * A lecture with long pauses is an hour of which ten minutes are somebody
   * thinking. When nothing has been heard for a second and a half, this runs
   * at double speed until something is; it is the one trick that makes a bad
   * recording watchable, and it costs one look at the waveform every tenth of
   * a second.
   */
  let silenceTimer: ReturnType<typeof setInterval> | null = null
  function watchSilence() {
    if (silenceTimer) clearInterval(silenceTimer)
    silenceTimer = setInterval(() => {
      if (!look.skipSilence) return
      const el = current()
      if (!el || el.paused) return
      const chain = chains.get(el)
      if (!chain) return
      const data = new Uint8Array(chain.analyser.frequencyBinCount)
      chain.analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128))
      const quiet = peak < 4
      const base = look.rate || 1
      if (quiet) {
        quietFor += 100
        if (quietFor > 1500 && el.playbackRate < base * 2) el.playbackRate = base * 2
      } else {
        quietFor = 0
        if (el.playbackRate > base) el.playbackRate = base
      }
    }, 100)
  }
  let quietFor = 0

  /* ------------------------------------------------------------ the player */

  let panel: HTMLElement | null = null
  let sleepAt = 0
  let sleepTimer: ReturnType<typeof setInterval> | null = null

  const closePanel = () => {
    panel?.remove()
    panel = null
  }

  /**
   * A small player that stays put.
   *
   * Scrolling a page away from the video is the ordinary way of losing the
   * controls, and picture-in-picture takes the picture out of the page
   * altogether. This is the middle: the controls, the position and the two
   * things people reach for — back fifteen seconds and a frame — in a corner,
   * over the page, while the video stays where it is.
   */
  function openPanel() {
    closePanel()
    const el = current()
    if (!el) return
    const host = document.createElement('nya-player')
    host.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483644; right: 16px; bottom: 16px; width: 320px'
    )
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '@keyframes nya-player-in { from { opacity: 0; transform: translateY(10px) }',
      '  to { opacity: 1; transform: none } }',
      '.box { animation: nya-player-in .22s cubic-bezier(.22,1,.36,1) both;',
      '  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f3f7;',
      '  background: rgba(22,23,30,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 14px;',
      '  padding: 12px; box-shadow: 0 20px 48px -18px rgba(0,0,0,.75) }',
      '.title { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }',
      '.row { display: flex; align-items: center; gap: 8px; margin-top: 10px }',
      '.btn { font: 600 12px system-ui; color: #c4bcff; background: rgba(124,108,255,.18); border: 0;',
      '  border-radius: 8px; padding: 6px 9px; cursor: pointer; white-space: nowrap }',
      '.btn.plain { color: rgba(242,243,247,.72); background: rgba(255,255,255,.08) }',
      '.line { flex: 1; accent-color: #7c6cff }',
      '.time { font-variant-numeric: tabular-nums; color: rgba(242,243,247,.6); font-size: 11px }',
      '.shot { display: block; width: 100%; border-radius: 8px; margin-top: 10px }'
    ].join(' ')

    const box = document.createElement('div')
    box.className = 'box'
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = navigator.mediaSession?.metadata?.title || document.title
    box.appendChild(title)

    const seekRow = document.createElement('div')
    seekRow.className = 'row'
    const seek = document.createElement('input')
    seek.type = 'range'
    seek.className = 'line'
    seek.min = '0'
    seek.max = String(Math.max(1, Math.round(el.duration || 1)))
    seek.value = String(Math.round(el.currentTime || 0))
    const time = document.createElement('span')
    time.className = 'time'
    const clock = (n: number) => {
      const whole = Math.max(0, Math.round(n))
      const m = Math.floor(whole / 60)
      const s = whole % 60
      return `${m}:${String(s).padStart(2, '0')}`
    }
    time.textContent = `${clock(el.currentTime)} / ${clock(el.duration || 0)}`
    seek.addEventListener('input', () => {
      el.currentTime = Number(seek.value)
    })
    seekRow.append(seek, time)
    box.appendChild(seekRow)

    const buttons = document.createElement('div')
    buttons.className = 'row'
    const make = (label: string, act: () => void, plain = false) => {
      const button = document.createElement('button')
      button.className = plain ? 'btn plain' : 'btn'
      button.textContent = label
      button.addEventListener('click', act)
      buttons.appendChild(button)
      return button
    }
    const playButton = make(el.paused ? '▶' : '❚❚', () => {
      if (el.paused) void el.play()
      else el.pause()
      playButton.textContent = el.paused ? '▶' : '❚❚'
    })
    make('↺ 15', () => {
      el.currentTime = Math.max(0, el.currentTime - 15)
    }, true)
    make(words.frame, () => grabFrame(el, box), true)
    make('✕', closePanel, true)
    box.appendChild(buttons)

    shadow.append(style, box)
    document.documentElement.appendChild(host)
    panel = host

    const tick = setInterval(() => {
      if (!panel) return clearInterval(tick)
      seek.max = String(Math.max(1, Math.round(el.duration || 1)))
      if (document.activeElement !== seek) seek.value = String(Math.round(el.currentTime || 0))
      time.textContent = `${clock(el.currentTime)} / ${clock(el.duration || 0)}`
      playButton.textContent = el.paused ? '▶' : '❚❚'
    }, 500)
  }

  /**
   * The frame on screen, as a picture.
   *
   * Drawn from the video into a canvas, which is refused outright for media
   * from another origin without permission — so this says so rather than
   * handing back a black rectangle.
   */
  function grabFrame(el: HTMLMediaElement, into: HTMLElement) {
    if (!(el instanceof HTMLVideoElement)) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = el.videoWidth
      canvas.height = el.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx || !canvas.width) return
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/png')
      ipcRenderer.send('media:frame', { data, title: document.title })
      const preview = into.querySelector('.shot') ?? document.createElement('img')
      preview.className = 'shot'
      ;(preview as HTMLImageElement).src = data
      into.appendChild(preview)
    } catch {
      ipcRenderer.send('media:frame', { data: '', title: '' })
    }
  }

  /* ----------------------------------------------------------- the browser */

  ipcRenderer.on('media:look', (_event, next: Partial<MediaLook>) => {
    look = { ...look, ...(next ?? {}) }
    for (const el of media()) apply(el)
    watchSilence()
  })

  ipcRenderer.on('media:panel', () => (panel ? closePanel() : openPanel()))

  ipcRenderer.on('media:replay', () => {
    const el = current()
    if (el) el.currentTime = Math.max(0, el.currentTime - 15)
  })

  ipcRenderer.on('media:frame-now', () => {
    const el = current()
    if (el) grabFrame(el, panel?.shadowRoot?.querySelector('.box') ?? document.createElement('div'))
  })

  ipcRenderer.on('media:subtitles', () => {
    const el = current()
    if (!el) return
    const tracks = Array.from(el.textTracks ?? [])
    const on = tracks.some((track) => track.mode === 'showing')
    for (const track of tracks) track.mode = on ? 'disabled' : track.mode
    if (!on) showSubtitles(el)
  })

  /**
   * Stop in so many minutes.
   *
   * The thing everybody wants from a player at midnight, and almost nothing
   * on the web has. It fades the sound down over the last ten seconds rather
   * than cutting it, because being woken by silence arriving suddenly is its
   * own kind of rude.
   */
  ipcRenderer.on('media:sleep', (_event, minutes: number) => {
    if (sleepTimer) clearInterval(sleepTimer)
    sleepTimer = null
    if (!minutes || minutes <= 0) {
      sleepAt = 0
      return
    }
    sleepAt = Date.now() + minutes * 60_000
    sleepTimer = setInterval(() => {
      const left = sleepAt - Date.now()
      const el = current()
      if (!el) return
      if (left <= 0) {
        el.pause()
        el.volume = Math.min(1, look.volume)
        if (sleepTimer) clearInterval(sleepTimer)
        sleepTimer = null
        sleepAt = 0
        return
      }
      if (left < 10_000) el.volume = Math.max(0, Math.min(1, look.volume) * (left / 10_000))
    }, 500)
  })

  /** Chapters, where the page gives any. */
  ipcRenderer.on('media:chapters', () => {
    const el = current()
    const tracks = Array.from(el?.textTracks ?? []).filter((track) => track.kind === 'chapters')
    const out: Array<{ at: number; title: string }> = []
    for (const track of tracks) {
      track.mode = 'hidden'
      for (const cue of Array.from(track.cues ?? [])) {
        out.push({ at: Math.round(cue.startTime), title: String((cue as VTTCue).text ?? '').slice(0, 120) })
      }
    }
    ipcRenderer.send('media:chapters', { list: out.slice(0, 200) })
  })

  /* Anything that turns up later gets the same treatment. */
  const watch = () => {
    for (const el of media()) {
      if (el.dataset.nyaSeen) continue
      el.dataset.nyaSeen = '1'
      apply(el)
      el.addEventListener('loadedmetadata', () => {
        apply(el)
        ipcRenderer.send('media:ask-position', { url: location.href })
      })
      el.addEventListener('timeupdate', () => {
        if (Math.round(el.currentTime) % 5 === 0) remember(el)
      })
      el.addEventListener('ended', () => ipcRenderer.send('media:ended', { url: location.href }))
    }
  }
  const observer = new MutationObserver(watch)
  const start = () => {
    watch()
    observer.observe(document.documentElement, { childList: true, subtree: true })
    ipcRenderer.send('media:ask-look', { host: location.host })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
  window.addEventListener('pagehide', () => {
    const el = current()
    if (el) remember(el)
    closePanel()
  })
}

/* ==========================================================================
 * Letters on every link.
 *
 * One key lights up everything on the page that can be followed, each with a
 * short label; type the label and it opens. Tab reaches the same links in the
 * order the document happens to be written in, which on a news site is four
 * hundred presses to reach the article — this is two.
 *
 * It is off unless somebody turns it on, because a browser that swallows a
 * letter while you are typing in a box is a broken browser. The key is
 * ignored inside anything editable, and everything is put back on Escape, on
 * a click, and on any scroll.
 * ====================================================================== */
{
  /** Letters that are easy to reach and hard to confuse with each other. */
  const ALPHABET = 'asdfghjklqwertyuiopzxcvbnm'

  let on = false
  let key = 'f'
  let showing = false
  let typed = ''
  let layer: HTMLDivElement | null = null
  let marks: Array<{ label: string; target: HTMLElement; tag: HTMLElement }> = []

  ipcRenderer.on('hints:on', (_event, value: { on?: boolean; key?: string }) => {
    on = value?.on === true
    if (typeof value?.key === 'string' && /^[a-z]$/.test(value.key)) key = value.key
    if (!on) hide()
  })

  /** Labels of one or two letters, enough for however many links there are. */
  const labelsFor = (count: number): string[] => {
    const out: string[] = []
    if (count <= ALPHABET.length) {
      for (let i = 0; i < count; i++) out.push(ALPHABET[i])
      return out
    }
    for (const first of ALPHABET) {
      for (const second of ALPHABET) {
        out.push(first + second)
        if (out.length === count) return out
      }
    }
    return out
  }

  /** Everything on the screen right now that is worth a letter. */
  const reachable = (): HTMLElement[] => {
    const all = document.querySelectorAll<HTMLElement>(
      'a[href], button, [role="button"], [role="link"], input:not([type="hidden"]), select, textarea, summary'
    )
    const out: HTMLElement[] = []
    for (const one of all) {
      const box = one.getBoundingClientRect()
      if (box.width < 4 || box.height < 4) continue
      if (box.bottom < 0 || box.top > window.innerHeight) continue
      if (box.right < 0 || box.left > window.innerWidth) continue
      const style = window.getComputedStyle(one)
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.1) continue
      out.push(one)
      // Two hundred is more than anybody reads at once, and past that the
      // labels themselves start covering the page.
      if (out.length === 200) break
    }
    return out
  }

  function hide() {
    showing = false
    typed = ''
    layer?.remove()
    layer = null
    marks = []
  }

  const show = () => {
    const targets = reachable()
    if (targets.length === 0) return
    const labels = labelsFor(targets.length)
    layer = document.createElement('div')
    layer.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;pointer-events:none')
    marks = targets.map((target, at) => {
      const box = target.getBoundingClientRect()
      const tag = document.createElement('span')
      tag.textContent = labels[at]
      tag.setAttribute(
        'style',
        // Just off the corner rather than on top of it: a label over the
        // first two letters of a link is a label covering the thing it names.
        'position:absolute;left:' +
          Math.max(0, Math.round(box.left) - 7) +
          'px;top:' +
          Math.max(0, Math.round(box.top) - 9) +
          'px;font:600 11px/1.4 ui-monospace,monospace;letter-spacing:0.5px;' +
          'padding:1px 4px;border-radius:4px;background:#ffd60a;color:#1b1b1f;' +
          'box-shadow:0 1px 3px rgba(0,0,0,0.45);text-transform:uppercase'
      )
      layer?.append(tag)
      return { label: labels[at], target, tag }
    })
    document.documentElement.append(layer)
    showing = true
    typed = ''
  }

  /** What a label opens: a link goes where it points, anything else is pressed. */
  const follow = (element: HTMLElement) => {
    hide()
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      element.focus()
      return
    }
    element.focus?.()
    element.click()
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (!on) return
      const target = event.target as HTMLElement | null
      const editing =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      if (showing) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          return hide()
        }
        if (event.key === 'Backspace') {
          event.preventDefault()
          typed = typed.slice(0, -1)
        } else if (/^[a-z]$/i.test(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          typed += event.key.toLowerCase()
        } else {
          return
        }
        const exact = marks.find((one) => one.label === typed)
        if (exact) return follow(exact.target)
        const left = marks.filter((one) => one.label.startsWith(typed))
        if (left.length === 0) return hide()
        // Narrowing as you type: what cannot match any more goes away, so what
        // is left is what your next letter chooses between.
        for (const one of marks) one.tag.style.display = one.label.startsWith(typed) ? '' : 'none'
        return
      }
      if (editing || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key.toLowerCase() !== key) return
      event.preventDefault()
      event.stopPropagation()
      show()
    },
    true
  )

  // Anything that moves the page moves the labels off what they pointed at.
  window.addEventListener('scroll', () => showing && hide(), true)
  window.addEventListener('pointerdown', () => showing && hide(), true)
  window.addEventListener('blur', () => showing && hide())
}

/* ==========================================================================
 * Making this browser look like every other one.
 *
 * A fingerprint is not one thing a site reads; it is fifty small true answers
 * that together identify one machine out of a million. The usual answer is to
 * lie about all of them, which fails twice over: a machine whose answers are
 * impossible is *more* identifiable, not less, and half the web breaks.
 *
 * So this changes as little as possible. Canvas and audio readings get noise
 * that is stable for one site and one session — enough that the number cannot
 * be matched against another site, small enough that nothing looks wrong. The
 * two counters that are pure bragging (how many cores, how much memory) are
 * rounded to the commonest answer. Everything else is left alone.
 *
 * It has to run in the page's own world. A preload lives in an isolated one,
 * and a canvas patched there is a canvas the page never sees — which is why
 * this goes through executeInMainWorld and why the answer about whether to do
 * it at all is asked for synchronously: by the time a message could arrive,
 * the page's own scripts have already read what they came for.
 * ====================================================================== */
{
  const guard = ipcRenderer.sendSync('shield:ask') as
    | { fingerprint?: boolean; clipboard?: boolean }
    | undefined

  /**
   * One number per site per session, from the address and a random start.
   *
   * Per site, so two sites cannot compare notes; per session, so the same site
   * cannot follow one machine across a restart. It is a number, not a fresh
   * random value each call: a canvas that reads differently every time is a
   * canvas every fingerprinting script notices immediately.
   */
  const seed = (() => {
    let hash = Math.floor(Math.random() * 0xffffffff)
    for (const ch of location.host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    return hash
  })()

  if (guard?.fingerprint) {
    try {
      contextBridge.executeInMainWorld({
        args: [seed],
        // Self-contained on purpose: this function is serialised across into
        // the page's world, so it can close over nothing at all.
        func: (SEED: number) => {
          const wobble = (at: number) => (((SEED ^ (at * 2654435761)) >>> 0) % 3) - 1

          const readCanvas = HTMLCanvasElement.prototype.toDataURL
          const readBlob = HTMLCanvasElement.prototype.toBlob
          const readPixels = CanvasRenderingContext2D.prototype.getImageData

          const smudge = (canvas: HTMLCanvasElement) => {
            try {
              const context = canvas.getContext('2d')
              if (!context) return
              const size = Math.min(canvas.width, 8)
              if (size < 1 || canvas.height < 1) return
              const pixels = readPixels.call(context, 0, 0, size, 1)
              for (let at = 0; at < pixels.data.length; at += 4) {
                pixels.data[at] = Math.max(0, Math.min(255, pixels.data[at] + wobble(at)))
              }
              context.putImageData(pixels, 0, 0)
            } catch {
              /* a tainted canvas can be neither read nor written */
            }
          }

          /* eslint-disable @typescript-eslint/no-explicit-any */
          HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...args: any[]) {
            smudge(this)
            return (readCanvas as any).apply(this, args)
          }
          HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, ...args: any[]) {
            smudge(this)
            return (readBlob as any).apply(this, args)
          }
          CanvasRenderingContext2D.prototype.getImageData = function (
            this: CanvasRenderingContext2D,
            ...args: any[]
          ) {
            const pixels = (readPixels as any).apply(this, args) as ImageData
            for (let at = 0; at < pixels.data.length; at += 997 * 4) {
              pixels.data[at] = Math.max(0, Math.min(255, pixels.data[at] + wobble(at)))
            }
            return pixels
          }

          if (typeof AnalyserNode !== 'undefined') {
            const readFloat = AnalyserNode.prototype.getFloatFrequencyData
            AnalyserNode.prototype.getFloatFrequencyData = function (
              this: AnalyserNode,
              array: Float32Array
            ) {
              ;(readFloat as (a: Float32Array) => void).call(this, array)
              for (let at = 0; at < array.length; at += 101) array[at] += wobble(at) * 0.0001
            }
          }

          // Eight cores and eight gigabytes is the commonest pair on the
          // desktop, so saying it puts this browser in the crowd rather than
          // beside it.
          const flatten = (object: object, name: string, value: unknown) => {
            try {
              Object.defineProperty(object, name, { get: () => value, configurable: true })
            } catch {
              /* a page that froze navigator first keeps its own answer */
            }
          }
          flatten(Navigator.prototype, 'hardwareConcurrency', 8)
          if ('deviceMemory' in navigator) flatten(Navigator.prototype, 'deviceMemory', 8)
          /* eslint-enable @typescript-eslint/no-explicit-any */
        }
      })
    } catch {
      /* an older runtime without executeInMainWorld leaves the page as it was */
    }
  }

  /*
   * The clipboard.
   *
   * Reading what somebody copied is a permission in every browser and a
   * formality in most: the prompt appears, it is accepted once, and the site
   * can read the clipboard for as long as it is open. A page has no business
   * knowing what is in there unless a person pastes it — which is a gesture
   * the page is told about anyway.
   */
  if (guard?.clipboard) {
    try {
      contextBridge.executeInMainWorld({
        func: () => {
          if (!navigator.clipboard) return
          const refuse = () =>
            Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError'))
          try {
            Object.defineProperty(navigator.clipboard, 'readText', {
              value: refuse,
              configurable: true
            })
            Object.defineProperty(navigator.clipboard, 'read', { value: refuse, configurable: true })
          } catch {
            /* the page got there first; the permission prompt is still the gate */
          }
        }
      })
    } catch {
      /* same as above */
    }
  }
}

/* ==========================================================================
 * A password box on a page that is not encrypted.
 *
 * Chromium says "not secure" in the address bar, which is next to the address
 * and not next to the box somebody is about to type a password into. This
 * marks the box itself, where the typing happens.
 * ====================================================================== */
{
  const mark = () => {
    if (location.protocol === 'https:' && !document.querySelector('form[action^="http:"]')) return
    const boxes = document.querySelectorAll<HTMLInputElement>('input[type="password"]')
    if (boxes.length === 0) return
    for (const box of boxes) {
      if (box.dataset.nyaWarned) continue
      box.dataset.nyaWarned = '1'
      box.style.outline = '2px solid #d97706'
      box.style.outlineOffset = '1px'
      box.title = INSECURE_FORM
    }
    ipcRenderer.send('shield:insecure-form', location.href)
  }

  // Forms arrive late on half the web, so this watches rather than looks once.
  watchDom(mark)
}

/** What the outline on an unencrypted password box says, in the browser's language. */
let INSECURE_FORM = 'Пароль на этой странице уйдёт незашифрованным'
ipcRenderer.on('shield:words', (_event, words: { insecureForm?: string }) => {
  if (typeof words?.insecureForm === 'string') INSECURE_FORM = words.insecureForm
})

/* ==========================================================================
 * A table, taken away.
 *
 * Every table on the web is a spreadsheet somebody typed into HTML, and
 * getting it back out means selecting it by hand and hoping the paste lands
 * in the right columns. A small button on the table's corner writes it as
 * CSV instead — the format every spreadsheet on earth opens.
 *
 * Only tables worth the offer: at least two rows and two columns, and not a
 * table being used for layout (one cell, or no header anywhere).
 * ====================================================================== */
{
  /** A field, quoted the way a spreadsheet expects to read it back. */
  const field = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    return /[",;\n]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean
  }

  /**
   * One table as CSV.
   *
   * A cell that spans columns is repeated across them rather than left out:
   * a spreadsheet has no idea what a colspan is, and a row with three cells
   * where the others have five is worse than a repeated heading.
   */
  const toCsv = (table: HTMLTableElement): string => {
    const lines: string[] = []
    for (const row of table.rows) {
      const cells: string[] = []
      for (const cell of row.cells) {
        const text = field(cell.innerText ?? cell.textContent ?? '')
        for (let at = 0; at < Math.max(1, cell.colSpan); at++) cells.push(text)
      }
      if (cells.length > 0) lines.push(cells.join(','))
    }
    return lines.join(NEWLINE)
  }

  const worthIt = (table: HTMLTableElement) => {
    if (table.rows.length < 2) return false
    const widest = Math.max(...[...table.rows].map((row) => row.cells.length))
    if (widest < 2) return false
    // A table with no heading cell anywhere is almost always somebody laying
    // a page out with a table, which was normal in 1999 and never stopped.
    return table.querySelector('th') !== null || table.rows.length > 3
  }

  const mark = () => {
    for (const table of document.querySelectorAll('table')) {
      if (table.dataset.nyaCsv || !worthIt(table)) continue
      table.dataset.nyaCsv = '1'

      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = CSV_WORD
      button.setAttribute(
        'style',
        'position:absolute;z-index:2147483000;font:500 11px/1 system-ui,sans-serif;' +
          'padding:4px 8px;border-radius:7px;border:1px solid rgba(0,0,0,.18);' +
          'background:#fff;color:#1b1b1f;cursor:pointer;opacity:0;' +
          'transition:opacity .12s linear;box-shadow:0 1px 4px rgba(0,0,0,.2)'
      )

      const place = () => {
        const box = table.getBoundingClientRect()
        button.style.left = `${Math.round(box.right + window.scrollX - 64)}px`
        button.style.top = `${Math.round(box.top + window.scrollY + 4)}px`
      }

      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        ipcRenderer.send('table:csv', { name: document.title || 'table', csv: toCsv(table) })
      })

      table.addEventListener('mouseenter', () => {
        place()
        button.style.opacity = '1'
      })
      table.addEventListener('mouseleave', () => {
        button.style.opacity = '0'
      })

      document.body.append(button)
      place()
    }
  }

  watchDom(mark)
}

/* ==========================================================================
 * A copy button on every block of code.
 *
 * Selecting a shell command with a mouse gets the prompt, the output and half
 * the next paragraph. Every documentation site that cares has added this
 * button itself; the ones that have not are exactly the ones where it is
 * needed, so the browser adds it.
 * ====================================================================== */
{
  const mark = () => {
    for (const block of document.querySelectorAll('pre')) {
      if (block.dataset.nyaCopy) continue
      const text = block.innerText ?? ''
      // A one-word <pre> is a layout choice, not a command.
      if (text.trim().length < 12) continue
      // A site that already offers one does not need a second.
      if (block.querySelector('button, [role="button"]')) continue
      block.dataset.nyaCopy = '1'

      const holder = window.getComputedStyle(block).position === 'static' ? block : block
      holder.style.position = holder.style.position || 'relative'

      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = COPY_WORD
      button.setAttribute(
        'style',
        'position:absolute;top:6px;right:6px;z-index:5;font:500 11px/1 system-ui,sans-serif;' +
          'padding:4px 8px;border-radius:7px;border:1px solid rgba(127,127,127,.35);' +
          'background:rgba(127,127,127,.14);color:inherit;cursor:pointer;opacity:0;' +
          'transition:opacity .12s linear'
      )
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        ipcRenderer.send('code:copy', block.innerText ?? '')
        button.textContent = COPIED_WORD
        window.setTimeout(() => (button.textContent = COPY_WORD), 1400)
      })
      block.addEventListener('mouseenter', () => (button.style.opacity = '1'))
      block.addEventListener('mouseleave', () => (button.style.opacity = '0'))
      block.append(button)
    }
  }

  watchDom(mark)
}

/* ==========================================================================
 * A picture, copied as it actually is.
 *
 * Chromium's own "copy image" flattens transparency onto white, so a logo
 * pasted anywhere but a white page arrives with a white box around it. This
 * reads the picture into a canvas and hands back PNG bytes, which keep the
 * alpha channel — and the browser writes those to the clipboard.
 * ====================================================================== */
ipcRenderer.on('image:copy', (_event, src: string) => {
  const picture = new Image()
  picture.crossOrigin = 'anonymous'
  picture.decoding = 'sync'
  picture.onload = () => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = picture.naturalWidth
      canvas.height = picture.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no context')
      context.drawImage(picture, 0, 0)
      ipcRenderer.send('image:copy-done', canvas.toDataURL('image/png'))
    } catch {
      // A picture from another site with no CORS header taints the canvas and
      // cannot be read; the ordinary copy is still there.
      ipcRenderer.send('image:copy-done', '')
    }
  }
  picture.onerror = () => ipcRenderer.send('image:copy-done', '')
  picture.src = src
})

/** Words for the two buttons the browser adds to a page. */
let CSV_WORD = 'CSV'
let COPY_WORD = 'Копировать'
let COPIED_WORD = 'Скопировано'
ipcRenderer.on('page:words', (_event, words: { csv?: string; copy?: string; copied?: string }) => {
  if (typeof words?.csv === 'string') CSV_WORD = words.csv
  if (typeof words?.copy === 'string') COPY_WORD = words.copy
  if (typeof words?.copied === 'string') COPIED_WORD = words.copied
})

/** The word for minutes, handed over by the browser in the reader's language. */
let MINUTES = 'мин'
const NEWLINE = String.fromCharCode(10)
ipcRenderer.on('reader:words', (_event, words: { minutes?: string }) => {
  if (typeof words?.minutes === 'string') MINUTES = words.minutes
})
/* ==========================================================================
   Reading mode
   ========================================================================== */

/**
 * The article, and nothing else on the page.
 *
 * The reading is Mozilla's Readability, which is what Firefox uses, run over a
 * copy of the document so the page itself is never touched. What it finds is
 * drawn inside a shadow root: the site's own stylesheet cannot reach in, ours
 * cannot leak out, and turning it off is removing one element.
 *
 * Around it is everything reading an article actually needs — how big the text
 * is and how wide the column, where you are in it, what is in it, what it says
 * in short, and the article read out loud. All of it lives here, in the page,
 * because that is where the text is; the browser only says when to start and
 * remembers how it was left.
 */
if (isTop && httpOrigin) {
  interface Look {
    theme: 'system' | 'light' | 'sepia' | 'dark'
    dark: boolean
    size: number
    serif: boolean
    width: number
    spacing: number
    textOnly: boolean
  }

  /** The words the sheet uses, in the language the browser is wearing. */
  const words = {
    minutes: 'мин',
    contents: 'Оглавление',
    aloud: 'Озвучить',
    stop: 'Остановить',
    summary: 'Коротко',
    pdf: 'В PDF',
    settings: 'Вид',
    close: 'Закрыть',
    textOnly: 'Только текст',
    size: 'Размер',
    width: 'Ширина',
    spacing: 'Интервал',
    serif: 'С засечками',
    theme: 'Тема',
    quote: 'Цитата скопирована'
  }
  ipcRenderer.on('reader:words', (_event, next: Partial<typeof words>) => {
    if (next && typeof next === 'object') Object.assign(words, next)
  })

  let host: HTMLElement | null = null
  let hidden = ''
  let look: Look = {
    theme: 'system',
    dark: true,
    size: 19,
    serif: false,
    width: 44,
    spacing: 1.65,
    textOnly: false
  }

  const off = () => {
    if (!host) return
    speechSynthesis.cancel()
    host.remove()
    host = null
    document.documentElement.style.overflow = hidden
    ipcRenderer.send('reader:state', { on: false })
  }

  /** Two headings that read the same, whatever the spacing and case. */
  const same = (a: string, b: string) =>
    a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

  /** Roughly how long this is to read, which is the one number people want. */
  const readingTime = (text: string) => {
    const count = text.trim().split(/\s+/).length
    const minutes = Math.max(1, Math.round(count / 200))
    return `${minutes} ` + words.minutes
  }

  /**
   * Marks those words inside one element, without touching links.
   *
   * Capped on purpose. Twelve words across a long article is three hundred
   * marks, which is not a hint — it is a highlighter emptied over the page.
   * Sixty is enough to see where the subject is discussed and few enough that
   * the page still reads as text.
   */
  function markWords(root: HTMLElement, list: string[], most = 60) {
    if (list.length === 0) return
    let marked = 0
    const pattern = new RegExp(`(^|[^\\p{L}])(${list.map(escapeRe).join('|')})(?=$|[^\\p{L}])`, 'giu')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      // Not the title, not a heading, not a link, not code: those are read
      // rather than skimmed, and marking them is noise.
      if (!node.data.trim()) continue
      if (node.parentElement?.closest('mark, a, pre, code, h1, h2, h3, h4, .by')) continue
      texts.push(node)
    }
    for (const node of texts) {
      if (marked >= most) break
      if (!pattern.test(node.data)) continue
      pattern.lastIndex = 0
      const holder = document.createElement('span')
      holder.innerHTML = node.data
        .replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string)
        .replace(pattern, (whole, before: string, word: string) => {
          if (marked >= most) return whole
          marked += 1
          return `${before}<mark>${word}</mark>`
        })
      node.replaceWith(...Array.from(holder.childNodes))
    }
  }

  const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const on = async (next: Look) => {
    look = { ...look, ...next }
    // Readability rewrites the document it is given, so it is given a copy.
    if (!isProbablyReaderable(document)) {
      ipcRenderer.send('reader:state', { on: false, nothing: true })
      return
    }
    const article = new Readability(document.cloneNode(true) as Document).parse()
    if (!article || !article.content) {
      ipcRenderer.send('reader:state', { on: false, nothing: true })
      return
    }

    host = document.createElement('nya-reader')
    host.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 2147483647')
    // Open, not closed: the isolation that matters here is the stylesheet's,
    // and a shadow root nobody can look into cannot be checked either.
    const shadow = host.attachShadow({ mode: 'open' })

    // Three papers, and the one the browser is wearing.
    const dark = look.theme === 'dark' || (look.theme === 'system' && look.dark)
    const sepia = look.theme === 'sepia'
    const ink = dark ? '#e7e7ee' : sepia ? '#3b3025' : '#1a1a20'
    const paper = dark ? '#15151b' : sepia ? '#f4ecd8' : '#fbfbfd'
    const dim = dark ? '#9a9aa8' : sepia ? '#7a6a55' : '#6b6b78'
    const line = dark ? '#2a2a34' : sepia ? '#e0d4ba' : '#e3e3ea'
    const accent = '#7c6cff'

    const style = document.createElement('style')
    style.textContent = [
      `:host { all: initial }`,
      // It rises into place. A sheet that simply exists where a page was
      // reads as the page breaking.
      `@keyframes nya-read-in { from { opacity: 0; transform: translate3d(0, 10px, 0) }`,
      `  to { opacity: 1; transform: none } }`,
      `.sheet { animation: nya-read-in .26s cubic-bezier(.22,1,.36,1) both;`,
      `  position: absolute; inset: 0; overflow-y: auto; background: ${paper}; color: ${ink};`,
      `  font: ${look.size}px/${look.spacing} ${look.serif ? 'Georgia, "Times New Roman", serif' : 'system-ui, -apple-system, "Segoe UI", sans-serif'} }`,
      `.column { max-width: ${look.width}em; margin: 0 auto; padding: 72px 24px 96px }`,
      // The article brings its own class names with it; none of ours may be
      // among them, and anything it does bring is neutralised here.
      `.column * { position: static !important; float: none !important }`,
      `h1 { font-size: 1.9em; line-height: 1.2; margin: 0 0 .3em; letter-spacing: -.02em }`,
      `.by { color: ${dim}; font-size: .85em; margin: 0 0 2em; padding-bottom: 1.2em; border-bottom: 1px solid ${line} }`,
      `p, li { margin: 0 0 1.1em }`,
      `h2, h3, h4 { line-height: 1.25; margin: 1.8em 0 .6em; scroll-margin-top: 80px }`,
      `img, video, figure, table { max-width: 100%; height: auto; margin: 1.4em 0 }`,
      look.textOnly ? `img, video, figure, iframe, svg, picture { display: none !important }` : '',
      `figcaption, small { color: ${dim}; font-size: .85em }`,
      `a { color: inherit; text-underline-offset: 2px }`,
      `mark { background: color-mix(in srgb, ${accent} 26%, transparent); color: inherit; border-radius: 3px; padding: 0 1px }`,
      `pre, code { font-family: ui-monospace, Consolas, monospace; font-size: .9em }`,
      `pre { overflow-x: auto; padding: 1em; border-radius: 10px; background: ${dark ? '#1d1d25' : sepia ? '#ece0c6' : '#f1f1f6'} }`,
      `blockquote { margin: 1.4em 0; padding-left: 1.2em; border-left: 3px solid ${line}; color: ${dim} }`,
      /*
       * Tables, made to look deliberate.
       *
       * Readability keeps an article's infobox, and an unstyled one renders as
       * bold right-aligned labels floating beside their values — which reads
       * as a page that broke rather than as a table. Rows get a hairline, the
       * label column gets the left edge and the dim colour it deserves, and a
       * table too wide for the column scrolls instead of pushing the article
       * sideways.
       */
      `table { width: 100%; border-collapse: collapse; font-size: .92em; display: block; overflow-x: auto }`,
      `th, td { padding: .5em .7em; text-align: left; vertical-align: top; border-bottom: 1px solid ${line} }`,
      `th { color: ${dim}; font-weight: 600; white-space: nowrap }`,
      `table img { margin: .4em 0 }`,
      `caption { color: ${dim}; font-size: .9em; padding-bottom: .5em; text-align: left }`,
      `hr { border: 0; border-top: 1px solid ${line}; margin: 2em 0 }`,
      // ---- the bar across the top, and the two panels that drop out of it
      `.bar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 6px;`,
      `  padding: 8px 14px; background: ${paper}; border-bottom: 1px solid ${line};`,
      `  font: 13px system-ui, -apple-system, "Segoe UI", sans-serif }`,
      `.btn { font: 600 12px system-ui; color: ${ink}; border: 0; cursor: pointer;`,
      `  background: color-mix(in srgb, ${ink} 7%, transparent);`,
      `  border-radius: 9px; padding: 6px 10px; white-space: nowrap;`,
      `  transition: background .12s linear }`,
      `.btn:hover { background: color-mix(in srgb, ${ink} 10%, transparent) }`,
      `.btn.on { color: ${accent}; background: color-mix(in srgb, ${accent} 16%, transparent) }`,
      `.grow { flex: 1 }`,
      `.progress { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: transparent }`,
      `.progress > i { display: block; height: 100%; width: 0; background: ${accent}; transition: width .1s linear }`,
      `.panel { position: sticky; top: 41px; z-index: 2; max-height: 46vh; overflow-y: auto;`,
      `  background: ${paper}; border-bottom: 1px solid ${line}; padding: 10px 14px 14px;`,
      `  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif }`,
      `.toc a { display: block; padding: 4px 0; color: ${dim}; text-decoration: none; cursor: pointer }`,
      `.toc a:hover { color: ${ink} }`,
      `.toc a.deep { padding-left: 16px; font-size: .95em }`,
      `.gist li { margin: 0 0 .6em }`,
      `.row { display: flex; align-items: center; gap: 10px; margin: 8px 0 }`,
      `.row > span:first-child { width: 92px; color: ${dim} }`,
      `.row input[type=range] { flex: 1; accent-color: ${accent} }`,
      `.swatch { width: 26px; height: 26px; border-radius: 8px; border: 1px solid ${line}; cursor: pointer }`,
      `.swatch.on { outline: 2px solid ${accent}; outline-offset: 1px }`,
      `.speaking { background: color-mix(in srgb, ${accent} 18%, transparent); border-radius: 4px }`
    ]
      .filter(Boolean)
      .join(NEWLINE)

    const page = document.createElement('div')
    page.className = 'sheet'

    /* ------------------------------------------------------------ the bar */
    const bar = document.createElement('div')
    bar.className = 'bar'
    const progress = document.createElement('div')
    progress.className = 'progress'
    const progressBar = document.createElement('i')
    progress.appendChild(progressBar)
    bar.appendChild(progress)

    const button = (label: string, act: () => void) => {
      const el = document.createElement('button')
      el.className = 'btn'
      el.textContent = label
      el.addEventListener('click', act)
      bar.appendChild(el)
      return el
    }

    /* --------------------------------------------------------- the article */
    const wrap = document.createElement('div')
    wrap.className = 'column'
    const title = document.createElement('h1')
    title.textContent = article.title || document.title
    wrap.appendChild(title)
    /*
     * Who wrote it, where it is from, how long it takes.
     *
     * Readability's byline is whatever the page put in an author field, and
     * on a wiki that is «Contributors to Wikimedia projects» — a string that
     * tells a reader nothing and looks like a bug beside a Russian title. A
     * byline that is not a name, or that simply repeats the site, is dropped.
     */
    const site = (article.siteName ?? '').trim()
    const author = (article.byline ?? '').trim()
    const looksLikeName =
      author.length > 0 &&
      author.length < 60 &&
      author.toLowerCase() !== site.toLowerCase() &&
      !/contributors|authors|редакция|editorial|staff/i.test(author)

    const by = [looksLikeName ? author : '', site, readingTime(article.textContent ?? '')]
      .filter(Boolean)
      .join(' · ')
    if (by) {
      const line2 = document.createElement('p')
      line2.className = 'by'
      line2.textContent = by
      wrap.appendChild(line2)
    }
    // The article's own markup, parsed as markup and not as a page: a
    // document fragment cannot run a script even if one is in there.
    const parsed = new DOMParser().parseFromString(article.content, 'text/html')
    for (const bad of Array.from(parsed.querySelectorAll('script, style, iframe, object, embed'))) {
      bad.remove()
    }
    // Readability keeps the article's own heading, which is the same words as
    // the title above it.
    const heading = parsed.querySelector('h1, h2')
    if (heading && same(heading.textContent ?? '', title.textContent ?? '')) heading.remove()
    for (const node of Array.from(parsed.body.childNodes)) wrap.appendChild(node)

    page.appendChild(bar)
    const panels = document.createElement('div')
    page.appendChild(panels)
    page.appendChild(wrap)
    shadow.appendChild(style)
    shadow.appendChild(page)

    /* ------------------------------------------------------- what is in it */
    const headings = Array.from(wrap.querySelectorAll('h2, h3')) as HTMLElement[]
    headings.forEach((node, index) => {
      node.id = node.id || `nya-h${index}`
    })

    let panel: HTMLElement | null = null
    const closePanel = () => {
      panel?.remove()
      panel = null
      for (const el of Array.from(bar.querySelectorAll('.btn.on'))) el.classList.remove('on')
    }
    const openPanel = (owner: HTMLElement, build: (into: HTMLElement) => void) => {
      const wasMine = owner.classList.contains('on')
      closePanel()
      if (wasMine) return
      owner.classList.add('on')
      panel = document.createElement('div')
      panel.className = 'panel'
      build(panel)
      panels.appendChild(panel)
    }

    const tocButton = button(words.contents, () =>
      openPanel(tocButton, (into) => {
        const list = document.createElement('div')
        list.className = 'toc'
        for (const node of headings) {
          const link = document.createElement('a')
          link.textContent = node.textContent?.trim() ?? ''
          if (node.tagName === 'H3') link.className = 'deep'
          link.addEventListener('click', () => {
            node.scrollIntoView({ behavior: 'smooth', block: 'start' })
            closePanel()
          })
          list.appendChild(link)
        }
        into.appendChild(list)
      })
    )
    if (headings.length < 2) tocButton.remove()

    const gist = shorten(article.textContent ?? '')
    /*
     * The gist, and the words it is built from marked in the text.
     *
     * The marking used to happen the moment reading mode opened, which is
     * a highlighter emptied over an article somebody sat down to read. It
     * belongs here instead: this is the skimming mode, and the marks are how
     * you get from the summary back to the place it came from. Done once —
     * a second press just shows the panel again.
     */
    let markedAlready = false
    const gistButton = button(words.summary, () =>
      openPanel(gistButton, (into) => {
        if (!markedAlready) {
          markedAlready = true
          markWords(wrap, keywords(article.textContent ?? ''))
        }
        const list = document.createElement('ul')
        list.className = 'gist'
        for (const sentence of gist) {
          const item = document.createElement('li')
          item.textContent = sentence
          list.appendChild(item)
        }
        into.appendChild(list)
      })
    )
    if (gist.length === 0) gistButton.remove()

    /* --------------------------------------------------------- read aloud */
    let speaking = false
    const aloudButton = button(words.aloud, () => {
      if (speaking) {
        speechSynthesis.cancel()
        speaking = false
        aloudButton.textContent = words.aloud
        aloudButton.classList.remove('on')
        return
      }
      const text = (article.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text) return
      speak(text)
      speaking = true
      aloudButton.textContent = words.stop
      aloudButton.classList.add('on')
    })

    bar.appendChild(Object.assign(document.createElement('div'), { className: 'grow' }))

    /* ---------------------------------------------------------- the look */
    const lookButton = button(words.settings, () =>
      openPanel(lookButton, (into) => {
        const slider = (
          label: string,
          value: number,
          min: number,
          max: number,
          step: number,
          set: (n: number) => void
        ) => {
          const row = document.createElement('div')
          row.className = 'row'
          const name = document.createElement('span')
          name.textContent = label
          const input = document.createElement('input')
          input.type = 'range'
          input.min = String(min)
          input.max = String(max)
          input.step = String(step)
          input.value = String(value)
          const shown = document.createElement('span')
          shown.textContent = String(value)
          input.addEventListener('input', () => {
            shown.textContent = input.value
            set(Number(input.value))
          })
          row.append(name, input, shown)
          into.appendChild(row)
        }

        // Every change redraws the sheet from the same article, which is how
        // the column can widen under you without the page reloading.
        const again = (patch: Partial<Look>) => {
          const next = { ...look, ...patch }
          ipcRenderer.send('reader:look', patch)
          off()
          void on(next)
        }

        const themes = document.createElement('div')
        themes.className = 'row'
        const themeName = document.createElement('span')
        themeName.textContent = words.theme
        themes.appendChild(themeName)
        for (const [id, colour] of [
          ['light', '#fbfbfd'],
          ['sepia', '#f4ecd8'],
          ['dark', '#15151b']
        ] as Array<[Look['theme'], string]>) {
          const swatch = document.createElement('button')
          swatch.className = look.theme === id ? 'swatch on' : 'swatch'
          swatch.style.background = colour
          swatch.addEventListener('click', () => again({ theme: id }))
          themes.appendChild(swatch)
        }
        into.appendChild(themes)

        slider(words.size, look.size, 14, 30, 1, (size) => again({ size }))
        slider(words.width, look.width, 28, 72, 2, (width) => again({ width }))
        slider(words.spacing, look.spacing, 1.2, 2.2, 0.05, (spacing) => again({ spacing }))

        for (const [label, key] of [
          [words.serif, 'serif'],
          [words.textOnly, 'textOnly']
        ] as Array<[string, 'serif' | 'textOnly']>) {
          const row = document.createElement('div')
          row.className = 'row'
          const name = document.createElement('span')
          name.textContent = label
          const box = document.createElement('input')
          box.type = 'checkbox'
          box.checked = Boolean(look[key])
          box.addEventListener('change', () => again({ [key]: box.checked } as Partial<Look>))
          row.append(name, box)
          into.appendChild(row)
        }
      })
    )

    button(words.pdf, () => {
      ipcRenderer.send('reader:pdf', {
        title: article.title || document.title,
        byline: by,
        url: location.href,
        html: wrap.innerHTML
      })
    })
    button(words.close, off)

    document.documentElement.appendChild(host)
    hidden = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'


    // How far down the article you are, along the bottom of the bar.
    const trackProgress = () => {
      const seen = page.scrollTop
      const whole = page.scrollHeight - page.clientHeight
      progressBar.style.width = `${whole > 0 ? Math.min(100, Math.round((seen / whole) * 100)) : 0}%`
    }
    page.addEventListener('scroll', trackProgress, { passive: true })
    trackProgress()

    // A quotation keeps where it came from. Copying out of a reading sheet is
    // almost always for somewhere else, and a quote without its source is the
    // thing everybody then has to go looking for again.
    page.addEventListener('copy', (event) => {
      const text = String(window.getSelection() ?? '').trim()
      if (text.length < 40) return
      const clip = (event as ClipboardEvent).clipboardData
      if (!clip) return
      event.preventDefault()
      clip.setData('text/plain', `«${text}»\n— ${article.title || document.title}, ${location.href}`)
    })

    ipcRenderer.send('reader:state', { on: true })
  }

  /**
   * The article, read out.
   *
   * Chromium's own speech synthesis, with the system's voices, so nothing is
   * downloaded and nothing leaves the machine. It is fed in pieces because a
   * single utterance of a long article cannot be paused, resumed or stopped
   * sensibly on any platform.
   */
  function speak(text: string) {
    speechSynthesis.cancel()
    const pieces = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text]
    let at = 0
    const chunks: string[] = []
    let buffer = ''
    for (const piece of pieces) {
      if (buffer.length + piece.length > 400) {
        chunks.push(buffer)
        buffer = ''
      }
      buffer += piece
    }
    if (buffer) chunks.push(buffer)

    const voices = speechSynthesis.getVoices()
    const wanted = (document.documentElement.lang || navigator.language || 'ru').slice(0, 2)
    const voice = voices.find((one) => one.lang.toLowerCase().startsWith(wanted))

    const next = () => {
      if (at >= chunks.length) return
      const say = new SpeechSynthesisUtterance(chunks[at])
      if (voice) say.voice = voice
      say.onend = () => {
        at += 1
        next()
      }
      speechSynthesis.speak(say)
    }
    next()
  }

  /** The selection, read out — from the page or from the sheet. */
  ipcRenderer.on('reader:speak-selection', () => {
    const text = String(window.getSelection() ?? '').trim()
    if (!text) return
    speak(text)
  })
  ipcRenderer.on('reader:speak-stop', () => speechSynthesis.cancel())

  ipcRenderer.on('reader:toggle', (_event, next: Look) => {
    if (host) return off()
    void on(next ?? look)
  })

  // Leaving the page leaves reading mode with it.
  window.addEventListener('pagehide', off)
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && host) off()
    },
    true
  )
}

/* ==========================================================================
   Choosing a piece of the page to photograph
   ========================================================================== */

if (isTop && httpOrigin) {
  let picking: HTMLElement | null = null

  // Named, and taken off again: a listener added with `once` is spent by the
  // first key anyone presses, which left Escape working exactly one time.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') stop()
  }

  const stop = () => {
    picking?.remove()
    picking = null
    document.removeEventListener('keydown', onKey, true)
  }

  ipcRenderer.on('capture:area', (_event, words: { hint?: string }) => {
    if (picking) return
    const host = document.createElement('nya-shot')
    host.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair')
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '@keyframes nya-veil-in { from { opacity: 0 } to { opacity: 1 } }',
      '@keyframes nya-hint-in { from { opacity: 0; transform: translate(-50%, -8px) }',
      '  to { opacity: 1; transform: translate(-50%, 0) } }',
      '.veil { animation: nya-veil-in .16s ease-out both;',
      '  position: absolute; inset: 0; background: rgba(10,10,16,.45) }',
      '.box { position: absolute; border: 1px solid #fff; box-shadow: 0 0 0 9999px rgba(10,10,16,.45); background: transparent }',
      '.size { position: absolute; transform: translate(0, -22px); font: 12px system-ui; color: #fff;',
      '  background: rgba(20,20,28,.9); padding: 2px 6px; border-radius: 6px; white-space: nowrap }',
      '.hint { animation: nya-hint-in .24s cubic-bezier(.22,1,.36,1) both;',
      '  position: absolute; left: 50%; top: 24px; transform: translateX(-50%); font: 13px system-ui;',
      '  color: #fff; background: rgba(20,20,28,.92); padding: 7px 12px; border-radius: 10px; white-space: nowrap }'
    ].join(' ')
    const veil = document.createElement('div')
    veil.className = 'veil'
    const box = document.createElement('div')
    box.className = 'box'
    box.style.display = 'none'
    const size = document.createElement('div')
    size.className = 'size'
    box.appendChild(size)
    const hint = document.createElement('div')
    hint.className = 'hint'
    hint.textContent = words?.hint ?? ''
    shadow.appendChild(style)
    shadow.appendChild(veil)
    if (hint.textContent) shadow.appendChild(hint)
    shadow.appendChild(box)
    document.documentElement.appendChild(host)
    picking = host

    let from: { x: number; y: number } | null = null
    const rect = (to: { x: number; y: number }) => ({
      x: Math.min(from!.x, to.x),
      y: Math.min(from!.y, to.y),
      width: Math.abs(to.x - from!.x),
      height: Math.abs(to.y - from!.y)
    })

    host.addEventListener('pointerdown', (event: PointerEvent) => {
      from = { x: event.clientX, y: event.clientY }
      veil.style.display = 'none'
      hint.remove()
      box.style.display = 'block'
      host.setPointerCapture(event.pointerId)
    })
    host.addEventListener('pointermove', (event: PointerEvent) => {
      if (!from) return
      const r = rect({ x: event.clientX, y: event.clientY })
      box.style.left = `${r.x}px`
      box.style.top = `${r.y}px`
      box.style.width = `${r.width}px`
      box.style.height = `${r.height}px`
      size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`
    })
    host.addEventListener('pointerup', (event: PointerEvent) => {
      if (!from) return stop()
      const r = rect({ x: event.clientX, y: event.clientY })
      stop()
      // A click and no drag is not a mistake: it is the whole of what you can
      // see, which is the other thing people mean by a screenshot.
      ipcRenderer.send('capture:area-done', r.width < 4 || r.height < 4 ? { x: 0, y: 0, width: 0, height: 0 } : r)
    })
    document.addEventListener('keydown', onKey, true)
  })

  // Escape never reaches a page — the browser keeps that key — so it is the
  // browser that says when the choosing is off.
  ipcRenderer.on('capture:cancel', stop)
  window.addEventListener('pagehide', stop)
}

/* ==========================================================================
   QR-код на странице
   ========================================================================== */

/**
 * A QR code on a page is a dead end: it is meant for a phone camera, and there
 * is no camera here. So the browser reads it.
 *
 * Pictures that could be a code — square, big enough — are looked at once the
 * page has settled, and a found code lights up where it is and says what it
 * holds, with a way to copy it or go there. Nothing is sent anywhere: the
 * reading happens on this machine, in this page.
 */
{
  const seen = new WeakSet<HTMLImageElement | HTMLCanvasElement>()
  let bubble: HTMLElement | null = null
  let ring: HTMLElement | null = null

  const clear = () => {
    bubble?.remove()
    ring?.remove()
    bubble = null
    ring = null
  }

  /** The image, as pixels, even when the site's server refuses us its canvas. */
  const pixels = async (node: HTMLImageElement | HTMLCanvasElement): Promise<ImageData | null> => {
    const width = node instanceof HTMLImageElement ? node.naturalWidth : node.width
    const height = node instanceof HTMLImageElement ? node.naturalHeight : node.height
    if (width < 48 || height < 48 || width > 4000 || height > 4000) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    try {
      ctx.drawImage(node, 0, 0, width, height)
      return ctx.getImageData(0, 0, width, height)
    } catch {
      // A picture from another site taints the canvas. The browser itself can
      // fetch it — it is not bound by the page's origin — and hand back bytes.
      if (!(node instanceof HTMLImageElement) || !node.currentSrc) return null
      try {
        const data: ArrayBuffer | null = await ipcRenderer.invoke('qr:bytes', node.currentSrc)
        if (!data) return null
        const blob = new Blob([data])
        const url = URL.createObjectURL(blob)
        const copy = new Image()
        await new Promise((done, fail) => {
          copy.onload = done
          copy.onerror = fail
          copy.src = url
        })
        canvas.width = copy.naturalWidth
        canvas.height = copy.naturalHeight
        ctx.drawImage(copy, 0, 0)
        const out = ctx.getImageData(0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        return out
      } catch {
        return null
      }
    }
  }

  const show = (node: Element, text: string) => {
    clear()
    const rect = node.getBoundingClientRect()
    const link = /^(https?:\/\/|www\.)/i.test(text)

    // The code itself, outlined where it sits.
    const halo = document.createElement('nya-qr-ring')
    halo.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483644; pointer-events: none;' +
        ' left: ' + Math.round(rect.left - 4) + 'px; top: ' + Math.round(rect.top - 4) + 'px;' +
        ' width: ' + Math.round(rect.width + 8) + 'px; height: ' + Math.round(rect.height + 8) + 'px'
    )
    const halowrap = halo.attachShadow({ mode: 'open' })
    const halostyle = document.createElement('style')
    halostyle.textContent =
      '@keyframes nya-qr-pulse { 0% { box-shadow: 0 0 0 0 rgba(124,108,255,.55) }' +
      ' 70% { box-shadow: 0 0 0 10px rgba(124,108,255,0) }' +
      ' 100% { box-shadow: 0 0 0 0 rgba(124,108,255,0) } }' +
      '.r { position: absolute; inset: 0; border: 2px solid #9b8fff; border-radius: 10px;' +
      ' animation: nya-qr-pulse 1.8s cubic-bezier(.22,1,.36,1) 2 }'
    const r = document.createElement('div')
    r.className = 'r'
    halowrap.append(halostyle, r)
    document.documentElement.appendChild(halo)
    ring = halo

    // What it says, under it.
    const host = document.createElement('nya-qr')
    const width = Math.min(340, Math.max(240, window.innerWidth - 32))
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
    const below = rect.bottom + 12
    const top = below + 92 > window.innerHeight ? Math.max(8, rect.top - 96) : below
    host.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483645; left: ' + left + 'px; top: ' + top + 'px; width: ' + width + 'px'
    )
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '@keyframes nya-qr-in { from { opacity: 0; transform: translateY(-6px) }',
      '  to { opacity: 1; transform: translateY(0) } }',
      '.box { animation: nya-qr-in .22s cubic-bezier(.22,1,.36,1) both;',
      '  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f3f7;',
      '  background: rgba(22,23,30,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;',
      '  padding: 10px 12px; box-shadow: 0 18px 44px -16px rgba(0,0,0,.7) }',
      '.text { display: block; word-break: break-all; user-select: text; -webkit-user-select: text;',
      '  max-height: 84px; overflow: auto }',
      '.row { display: flex; gap: 8px; margin-top: 10px }',
      '.btn { font: 600 12px system-ui, sans-serif; color: #c4bcff; background: rgba(124,108,255,.18);',
      '  border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer }',
      '.btn.plain { color: rgba(242,243,247,.72); background: rgba(255,255,255,.08) }'
    ].join(' ')
    const box = document.createElement('div')
    box.className = 'box'
    const line = document.createElement('span')
    line.className = 'text'
    line.textContent = text
    const row = document.createElement('div')
    row.className = 'row'
    if (link) {
      const go = document.createElement('button')
      go.className = 'btn'
      go.textContent = words.open
      go.addEventListener('click', () => {
        ipcRenderer.send('qr:open', text)
        clear()
      })
      row.append(go)
    }
    const copy = document.createElement('button')
    copy.className = 'btn plain'
    copy.textContent = words.copy
    copy.addEventListener('click', () => {
      ipcRenderer.send('qr:copy', text)
      clear()
    })
    row.append(copy)
    box.append(line, row)
    shadow.append(style, box)
    document.documentElement.appendChild(host)
    bubble = host
  }

  // The words come from the browser, which is the side that knows the language.
  const words: { open: string; copy: string } = { open: 'Открыть', copy: 'Копировать' }

  const read = async (node: HTMLImageElement | HTMLCanvasElement, loud: boolean) => {
    if (!loud && seen.has(node)) return false
    seen.add(node)
    const data = await pixels(node)
    if (!data) return false
    const found = jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' })
    if (!found || !found.data) return false
    show(node, found.data)
    return true
  }

  /** Square enough to be a code, big enough to be worth looking at. */
  const candidate = (image: HTMLImageElement) => {
    const w = image.clientWidth
    const h = image.clientHeight
    if (w < 64 || h < 64) return false
    const ratio = w / h
    return ratio > 0.8 && ratio < 1.25
  }

  const sweep = async () => {
    const images = Array.from(document.images).filter(candidate).slice(0, 8)
    for (const image of images) {
      if (!image.complete) continue
      if (await read(image, false)) return
    }
  }

  // Asked for by name, from the picture's own menu: then even a wide banner
  // is worth a look, because somebody thinks there is a code in it.
  ipcRenderer.on('qr:scan', async (_event, payload: { src?: string; open?: string; copy?: string }) => {
    if (payload?.open) words.open = payload.open
    if (payload?.copy) words.copy = payload.copy
    const src = String(payload?.src ?? '')
    const image =
      Array.from(document.images).find((i) => i.currentSrc === src || i.src === src) ?? null
    if (image && (await read(image, true))) return
    ipcRenderer.send('qr:none')
  })

  ipcRenderer.on('qr:words', (_event, payload: { open?: string; copy?: string }) => {
    if (payload?.open) words.open = payload.open
    if (payload?.copy) words.copy = payload.copy
  })

  // Once, after the page has settled: a sweep on every mutation would be a
  // scan of the whole web.
  window.addEventListener('load', () => {
    setTimeout(() => void sweep(), 1200)
  })
  document.addEventListener('mousedown', (event) => {
    if (bubble && !event.composedPath().includes(bubble)) clear()
  }, true)
  window.addEventListener('scroll', clear, true)
  window.addEventListener('pagehide', clear)
}

/* ==========================================================================
   Где эту страницу читали
   ========================================================================== */

/**
 * The browser keeps the scroll position of every tab so a restored session
 * opens where it was left. The page is the only one who knows it, and it says
 * so rarely: once things stop moving, and once more when the page goes away.
 */
{
  let timer = 0
  let last = -1
  const tell = () => {
    const y = Math.round(window.scrollY)
    if (y === last) return
    last = y
    ipcRenderer.send('page:scroll', y)
  }
  window.addEventListener(
    'scroll',
    () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(tell, 900)
    },
    { passive: true, capture: true }
  )
  window.addEventListener('pagehide', tell)
}

/* ==========================================================================
   Глазок у поля пароля
   ========================================================================== */

/**
 * Half the sites that ask for a password draw no way to look at it, and a
 * password out of the generator is exactly the kind you need to look at. The
 * browser adds the eye itself: a small button that floats over the right edge
 * of the field while it has the focus, and is gone the moment it does not.
 *
 * Nothing is inserted into the page's own layout — the button is fixed to the
 * viewport over the field, so a site's CSS cannot be broken by it and cannot
 * break it.
 */
{
  const EYE =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"' +
    ' stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>' +
    '<circle cx="12" cy="12" r="3.2"/></svg>'
  const EYE_OFF =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"' +
    ' stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l16 16"/>' +
    '<path d="M9.6 6.1A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.3 3.9"/>' +
    '<path d="M6.3 8.2A17 17 0 0 0 2.5 12s3.5 6.2 9.5 6.2c1.3 0 2.5-.3 3.6-.7"/></svg>'

  let eye: HTMLElement | null = null
  let field: HTMLInputElement | null = null

  const gone = () => {
    eye?.remove()
    eye = null
    field = null
  }

  const place = () => {
    if (!eye || !field) return
    const rect = field.getBoundingClientRect()
    if (rect.width < 60 || rect.height < 16) return gone()
    eye.style.left = Math.round(rect.right - 30) + 'px'
    eye.style.top = Math.round(rect.top + rect.height / 2 - 13) + 'px'
  }

  const draw = (input: HTMLInputElement) => {
    gone()
    field = input
    const host = document.createElement('nya-eye')
    host.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483645; width: 26px; height: 26px; cursor: pointer'
    )
    const shadow = host.attachShadow({ mode: 'open' })
    const button = document.createElement('div')
    button.setAttribute(
      'style',
      'width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center;' +
        ' justify-content: center; color: #6b7280; background: rgba(127,127,127,.12)'
    )
    button.innerHTML = EYE
    // The page must not lose the field when the eye is pressed, or the value
    // is submitted with the caret somewhere else.
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      if (!field) return
      const shown = field.type === 'text'
      field.type = shown ? 'password' : 'text'
      button.innerHTML = shown ? EYE : EYE_OFF
      field.focus()
    })
    shadow.append(button)
    document.documentElement.appendChild(host)
    eye = host
    place()
  }

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLInputElement && target.type === 'password') draw(target)
      else if (eye && !(target && eye.contains(target))) gone()
    },
    true
  )
  document.addEventListener('focusout', () => setTimeout(() => {
    if (field && document.activeElement !== field) gone()
  }, 120), true)
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  window.addEventListener('pagehide', gone)
}

/* ==========================================================================
   Перемотка видео стрелками
   ========================================================================== */

/**
 * Arrows seek the video, on any site, the way they do on the big ones: five
 * seconds a press, ten with shift held.
 *
 * Only when nobody else wants the key. A player that handles arrows itself
 * calls preventDefault, and this listens after the page has had its say — so
 * on YouTube nothing here happens at all, and on the small site with a bare
 * <video> the arrows finally work.
 */
{
  const playing = (): HTMLVideoElement | null => {
    const videos = Array.from(document.querySelectorAll('video'))
    // The one being watched: playing, and big enough to be the point of the page.
    return (
      videos.find((v) => !v.paused && !v.ended && v.readyState > 2 && v.clientWidth > 160) ??
      videos.find((v) => v.clientWidth > 320 && v.readyState > 2) ??
      null
    )
  }

  const typing = (node: EventTarget | null) => {
    const el = node as HTMLElement | null
    if (!el) return false
    if (el.isContentEditable) return true
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (typing(event.target)) return
    const video = playing()
    if (!video) return
    const step = event.shiftKey ? 10 : 5
    const to = event.key === 'ArrowRight' ? video.currentTime + step : video.currentTime - step
    video.currentTime = Math.max(0, Math.min(video.duration || to, to))
    event.preventDefault()
  })
}

/* ==========================================================================
   Перевод выделенного
   ========================================================================== */

/**
 * The browser can already translate a whole page, which is a heavy thing to do
 * to read one sentence. This is the small version: the selected words come back
 * translated in a bubble under them, the page itself untouched.
 */
{
  let bubble: HTMLElement | null = null

  const close = () => {
    bubble?.remove()
    bubble = null
  }

  /** Where the selection is, in viewport coordinates. */
  const around = (): DOMRect | null => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    return rect.width + rect.height > 0 ? rect : null
  }

  const show = (text: string, waiting: boolean) => {
    const rect = around()
    close()
    const host = document.createElement('nya-tr')
    const width = Math.min(360, Math.max(220, window.innerWidth - 32))
    const left = rect
      ? Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
      : window.innerWidth / 2 - width / 2
    // Under the words when there is room below, over them when there is not.
    const below = rect ? rect.bottom + 10 : 80
    const overshoots = below + 90 > window.innerHeight
    const top = rect && overshoots ? Math.max(8, rect.top - 96) : below
    host.setAttribute(
      'style',
      'all: initial; position: fixed; z-index: 2147483646; left: ' + left + 'px; top: ' + top + 'px; width: ' + width + 'px'
    )
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '@keyframes nya-tr-in { from { opacity: 0; transform: translateY(-6px) }',
      '  to { opacity: 1; transform: translateY(0) } }',
      '.box { animation: nya-tr-in .2s cubic-bezier(.22,1,.36,1) both;',
      '  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f3f7;',
      '  background: rgba(22,23,30,.96); border: 1px solid rgba(255,255,255,.12);',
      '  border-radius: 12px; padding: 10px 12px; box-shadow: 0 18px 44px -16px rgba(0,0,0,.7);',
      '  max-height: 220px; overflow: auto; user-select: text; -webkit-user-select: text }',
      '.wait { opacity: .6 }'
    ].join(' ')
    const box = document.createElement('div')
    box.className = waiting ? 'box wait' : 'box'
    box.textContent = text
    shadow.append(style, box)
    document.documentElement.appendChild(host)
    bubble = host
  }

  ipcRenderer.on('selection:translating', () => show('…', true))
  ipcRenderer.on('selection:translation', (_event, text: string) => show(text, false))

  // Anywhere else, any key, any scroll — the bubble was never a window.
  document.addEventListener(
    'mousedown',
    (event) => {
      if (bubble && !event.composedPath().includes(bubble)) close()
    },
    true
  )
  document.addEventListener('keydown', () => close(), true)
  window.addEventListener('scroll', close, true)
  window.addEventListener('pagehide', close)
}

/* ==========================================================================
   What language this is in
   ========================================================================== */

/**
 * So that the offer to translate appears by itself, on the page that needs it,
 * and nowhere else.
 *
 * A page usually says so itself, in one attribute. When it does not, the
 * writing itself answers for it: a page in Cyrillic is not a page in Greek,
 * whatever it forgot to declare. Latin letters are left unanswered — English
 * and Polish cannot be told apart by their alphabet, and guessing wrongly
 * would put the offer on every page in the world.
 */
if (isTop && httpOrigin) {
  const SCRIPTS: Array<[string, RegExp]> = [
    ['ru', /[Ѐ-ӿ]/g],
    ['el', /[Ͱ-Ͽ]/g],
    ['he', /[֐-׿]/g],
    ['ar', /[؀-ۿ]/g],
    ['hy', /[԰-֏]/g],
    ['ka', /[Ⴀ-ჿ]/g],
    ['hi', /[ऀ-ॿ]/g],
    ['bn', /[ঀ-৿]/g],
    ['ta', /[஀-௿]/g],
    ['te', /[ఀ-౿]/g],
    ['th', /[฀-๿]/g],
    ['km', /[ក-៿]/g],
    ['ko', /[가-힯]/g],
    ['ja', /[぀-ヿ]/g],
    ['zh', /[一-鿿]/g]
  ]

  const guess = () => {
    const said = (document.documentElement.getAttribute('lang') || '').trim().toLowerCase()
    // «pl-PL» and «pl» are the same answer to the only question being asked.
    if (said && said !== 'und') return said.split(/[-_]/)[0]
    let text = ''
    try {
      text = (document.body?.innerText ?? '').slice(0, 4000)
    } catch {
      return ''
    }
    const letters = text.replace(/\s/g, '').length
    if (letters < 60) return ''
    for (const [code, pattern] of SCRIPTS) {
      const found = text.match(pattern)
      if (found && found.length > letters * 0.2) return code
    }
    return ''
  }

  // Nothing said yet, which is not the same as «no language».
  let told = 'unknown'
  const tell = () => {
    const now = guess()
    if (now === told) return
    told = now
    ipcRenderer.send('page:language', now)
  }

  // Once when the page is there to look at, and again when it has settled:
  // a page that fills itself in afterwards changes its mind about its own
  // language surprisingly often.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tell, { once: true })
  } else {
    tell()
  }
  setTimeout(tell, 1200)
  setTimeout(tell, 3500)
}

/* ==========================================================================
   What is playing here
   ========================================================================== */

/**
 * A page that plays something does not have to leave anything in the document
 * to do it: `new Audio(url).play()` never touches the DOM, and a good half of
 * the music sites on the internet work exactly that way. Looking for `<audio>`
 * tags therefore finds nothing on them.
 *
 * So the looking is done from inside the page itself. The small script below
 * is put into the page's own world before its scripts run, and from there it
 * sees what no amount of searching from outside would find: every element the
 * page has ever pressed play on, what it told the system it is playing, and
 * which of the buttons on a pair of headphones it knows how to answer.
 *
 * It reports over a custom event and takes its orders the same way — a string
 * each way, the only thing that safely crosses between the page's world and
 * this one.
 */
const PAGE_SCRIPT = `(() => {
  if (document.documentElement.dataset.nyaMedia === 'on') return
  document.documentElement.dataset.nyaMedia = 'on'

  /* Everything the page has pressed play on, whether it is in the document
     or not. */
  const played = new Set()
  const remember = (el) => { try { if (el && el.tagName) played.add(el) } catch (e) {} }
  try {
    const proto = HTMLMediaElement.prototype
    const play = proto.play
    proto.play = function () { remember(this); later(); return play.apply(this, arguments) }
  } catch (e) {}

  /* What the page says about itself: the same words the machine's own media
     popup shows, plus the buttons it has offered to answer. */
  const handlers = new Map()
  const told = { position: 0, duration: 0, rate: 1, at: 0, moved: 0 }
  try {
    const ms = navigator.mediaSession
    if (ms && ms.setActionHandler) {
      const set = ms.setActionHandler.bind(ms)
      ms.setActionHandler = function (name, fn) {
        try { fn ? handlers.set(name, fn) : handlers.delete(name) } catch (e) {}
        later()
        return set(name, fn)
      }
    }
    if (ms && ms.setPositionState) {
      const put = ms.setPositionState.bind(ms)
      ms.setPositionState = function (state) {
        try {
          if (state) {
            const to = Number(state.position) || 0
            /* A page that never says whether it is playing still moves: the
               moment it last moved is the honest answer to that question —
               and a word that comes with no movement behind it means it has
               stopped, which is the answer arriving rather than timing out. */
            const now = Date.now()
            if (to > told.position + 0.05) told.moved = now
            else if (now - told.at > 600) told.moved = 0
            told.duration = Number(state.duration) || 0
            told.position = to
            told.rate = Number(state.playbackRate) || 1
            told.at = Date.now()
          }
        } catch (e) {}
        later()
        return put(state)
      }
    }
  } catch (e) {}

  /* Elements in the document, including ones a page keeps inside its own
     components. The deep walk only earns its cost when the plain look finds
     nothing at all. */
  /* Which window an element was found in, so that what that window says
     about the track can be read along with it. */
  const homes = new WeakMap()
  const claim = (list, win) => {
    for (let i = 0; i < list.length; i++) { try { homes.set(list[i], win) } catch (e) {} }
    return list
  }

  /* Players one document down, where the document is ours to look into.
     A frame from somewhere else keeps its secrets; the browser still hears
     it, and says so on its own. */
  const framed = () => {
    const out = []
    let frames
    try { frames = document.querySelectorAll('iframe') } catch (e) { return out }
    for (let i = 0; i < frames.length && i < 12; i++) {
      try {
        const doc = frames[i].contentDocument
        if (!doc) continue
        const found = Array.prototype.slice.call(doc.querySelectorAll('video, audio'))
        claim(found, frames[i].contentWindow)
        for (let k = 0; k < found.length; k++) out.push(found[k])
      } catch (e) {
        /* another origin, and none of our business */
      }
    }
    return out
  }

  /* A page that has never made a sound is never searched through: the walk
     below is only ever worth doing for a page that plays something we have
     failed to find the ordinary way. */
  let heard = false
  let deepAt = 0
  const inDocument = () => {
    const plain = claim(
      Array.prototype.slice.call(document.querySelectorAll('video, audio')),
      window
    ).concat(framed())
    if (plain.length || played.size || !heard || Date.now() - deepAt < 4000) return plain
    deepAt = Date.now()
    const out = []
    const walk = (root, depth) => {
      if (depth > 6) return
      let all
      try { all = root.querySelectorAll('*') } catch (e) { return }
      for (let i = 0; i < all.length; i++) {
        const el = all[i]
        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') out.push(el)
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1)
      }
    }
    walk(document, 0)
    return claim(out, window)
  }

  /* Playing, for a page with nothing in the document to look at: what it
     said, and failing that whether the place it says it is keeps changing. */
  const running = () => {
    const ms = navigator.mediaSession
    const said = ms ? ms.playbackState : 'none'
    if (said === 'playing') return true
    if (said === 'paused') return false
    return Date.now() - told.moved < 2500
  }

  const alive = (el) => { try { return !el.ended && (el.currentTime > 0 || el.readyState > 0) } catch (e) { return false } }
  const going = (el) => { try { return !el.paused && !el.ended } catch (e) { return false } }

  /** The one that speaks for this frame: what plays, else what was played. */
  const current = () => {
    const all = inDocument().concat(Array.prototype.slice.call(played))
    let best = null
    for (let i = 0; i < all.length; i++) {
      const el = all[i]
      if (going(el)) { if (!best || !going(best) || el.tagName === 'VIDEO') best = el }
      else if (!best && alive(el)) best = el
    }
    return best
  }

  const state = () => {
    const el = current()
    /* The words belong to the frame the sound is in: a player inside a frame
       of ours names its own track, not its host page's. */
    let home = window
    try { home = (el && homes.get(el)) || window } catch (e) { home = window }
    let ms = null
    try { ms = home.navigator.mediaSession || null } catch (e) { ms = null }
    if (!ms) ms = navigator.mediaSession || null
    const meta = (ms && ms.metadata) || null
    const session = ms ? ms.playbackState : 'none'
    /* Neither an element nor a word about itself: nothing is playing here. */
    if (!el && !meta) return null
    const art = meta && meta.artwork && meta.artwork.length
      ? (meta.artwork[meta.artwork.length - 1] || {}).src || ''
      : ''
    /* Where it is: what the element knows, else what the page announced,
       carried forward by the clock since it said so. */
    let position = 0
    let duration = 0
    let seekable = false
    if (el) {
      position = el.currentTime || 0
      duration = isFinite(el.duration) ? el.duration : 0
      seekable = duration > 0
    } else if (told.at) {
      const on = running()
      position = told.position + (on ? ((Date.now() - told.at) / 1000) * told.rate : 0)
      duration = told.duration
      seekable = duration > 0 && handlers.has('seekto')
      if (duration > 0) position = Math.min(position, duration)
    }
    const video = !!el && el.tagName === 'VIDEO'
    return {
      title: (meta && meta.title) || document.title || location.host,
      artist: (meta && (meta.artist || meta.album)) || '',
      art: art,
      playing: el ? going(el) : running(),
      muted: el ? !!el.muted : false,
      volume: el && typeof el.volume === 'number' ? el.volume : 1,
      position: Math.max(0, Math.round(position)),
      duration: Math.max(0, Math.round(duration)),
      video: video,
      seekable: seekable,
      /* Only a player we hold can be asked to go faster; nought means the
         question does not arise. */
      rate: el ? el.playbackRate || 1 : 0,
      next: handlers.has('nexttrack'),
      prev: handlers.has('previoustrack'),
      pip: !!(video && document.pictureInPictureEnabled && el && !el.disablePictureInPicture)
    }
  }

  let last = 'start'
  const tell = () => {
    let now = null
    try { now = state() } catch (e) { now = null }
    const key = now
      ? [now.title, now.artist, now.playing, now.muted, now.volume, now.position, now.duration, now.next, now.prev, now.pip, now.rate].join('|')
      : ''
    if (key === last) return
    last = key
    try {
      document.dispatchEvent(new CustomEvent('nya-media', { detail: now ? JSON.stringify(now) : '' }))
    } catch (e) {}
  }
  let soon = 0
  const later = () => { if (!soon) soon = setTimeout(() => { soon = 0; tell() }, 60) }

  const act = (name, arg) => {
    const fn = handlers.get(name)
    if (!fn) return false
    try { fn(Object.assign({ action: name }, arg || {})) } catch (e) {}
    return true
  }

  document.addEventListener('nya-media-do', (event) => {
    let c = null
    try { c = JSON.parse(String(event.detail || '{}')) } catch (e) { return }
    const el = current()
    const to = typeof c.to === 'number' ? c.to : 0
    const where = () => (el ? el.currentTime || 0 : told.position + (Date.now() - told.at) / 1000)
    try {
      const guess = (on) => { told.moved = on ? Date.now() : 0; told.at = Date.now() }
      if (c.do === 'play') el ? el.play() : (act('play'), guess(true))
      else if (c.do === 'pause') el ? el.pause() : (act('pause'), guess(false))
      else if (c.do === 'toggle') {
        if (el) el.paused ? el.play() : el.pause()
        else if (typeof c.to === 'number' ? c.to : running()) { act('pause'); guess(false) }
        else { act('play'); guess(true) }
      } else if (c.do === 'seek') {
        if (el) el.currentTime = to
        else if (act('seekto', { seekTime: to })) { told.position = to; told.at = Date.now() }
      } else if (c.do === 'skip') {
        const at = Math.max(0, where() + to)
        if (el) el.currentTime = at
        else if (act('seekto', { seekTime: at })) { told.position = at; told.at = Date.now() }
        else act(to > 0 ? 'seekforward' : 'seekbackward', { seekOffset: Math.abs(to) })
      } else if (c.do === 'next') act('nexttrack')
      else if (c.do === 'prev') act('previoustrack')
      else if (c.do === 'rate') {
        if (el) el.playbackRate = Math.max(0.25, Math.min(4, to || 1))
      } else if (c.do === 'volume') {
        if (el) { el.volume = Math.max(0, Math.min(1, to)); if (to > 0) el.muted = false }
      } else if (c.do === 'pip') {
        if (el && el.tagName === 'VIDEO') {
          if (document.pictureInPictureElement) document.exitPictureInPicture()
          else el.requestPictureInPicture()
        }
      }
    } catch (e) {}
    setTimeout(tell, 60)
    setTimeout(tell, 400)
  })

  for (const name of ['play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'durationchange', 'emptied', 'seeked']) {
    document.addEventListener(name, () => { heard = true; later() }, true)
  }
  setInterval(tell, 1000)
  tell()
})()`

if (httpOrigin) {
  /** Puts the watcher into the page, as early as there is a page to put it in. */
  const inject = () => {
    try {
      const holder = document.documentElement || document.head || document.body
      if (!holder) return false
      const script = document.createElement('script')
      script.textContent = PAGE_SCRIPT
      holder.appendChild(script)
      script.remove()
      const ran = document.documentElement?.dataset.nyaMedia === 'on'
      // The mark was only ever a way of asking «did that run», and a page has
      // no business finding our fingerprints on its own root element.
      if (ran && document.documentElement) delete document.documentElement.dataset.nyaMedia
      return ran
    } catch {
      return false
    }
  }

  /**
   * What can be seen from outside the page, for a site whose rules do not
   * allow a script to be put into it. Elements in the document are all this
   * can find — but that is most of the web, and it costs one look a second.
   */
  const fromOutside = () => {
    let last = 'start'
    const pick = () => {
      const all = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'))
      return (
        all.find((el) => !el.paused && !el.ended) ??
        all.find((el) => el.currentTime > 0 && !el.ended) ??
        null
      )
    }
    const tell = () => {
      const el = pick()
      if (!el) {
        if (last === '') return
        last = ''
        return ipcRenderer.send('media:state', null)
      }
      const meta = navigator.mediaSession?.metadata ?? null
      const duration = Number.isFinite(el.duration) ? Math.round(el.duration) : 0
      const state = {
        title: meta?.title || document.title || location.host,
        artist: meta?.artist || meta?.album || '',
        art: meta?.artwork?.[meta.artwork.length - 1]?.src ?? '',
        playing: !el.paused && !el.ended,
        muted: el.muted,
        volume: typeof el.volume === 'number' ? el.volume : 1,
        position: Math.round(el.currentTime || 0),
        duration,
        video: el.tagName === 'VIDEO',
        seekable: duration > 0,
        rate: el.playbackRate || 1,
        next: false,
        prev: false,
        pip:
          el.tagName === 'VIDEO' &&
          document.pictureInPictureEnabled &&
          !(el as HTMLVideoElement).disablePictureInPicture
      }
      const key = Object.values(state).join('|')
      if (key === last) return
      last = key
      ipcRenderer.send('media:state', state)
    }
    for (const name of ['play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'ratechange']) {
      document.addEventListener(name, tell, true)
    }
    setInterval(tell, 1000)

    ipcRenderer.on('media:command', (_event, command: { do: string; to?: number }) => {
      const el = pick()
      if (!el) return
      const to = typeof command.to === 'number' ? command.to : 0
      if (command.do === 'play') void el.play()
      else if (command.do === 'pause') el.pause()
      else if (command.do === 'toggle') el.paused ? void el.play() : el.pause()
      else if (command.do === 'seek') el.currentTime = to
      else if (command.do === 'skip') el.currentTime = Math.max(0, (el.currentTime || 0) + to)
      else if (command.do === 'volume') {
        el.volume = Math.max(0, Math.min(1, to))
        if (to > 0) el.muted = false
      } else if (command.do === 'rate') el.playbackRate = Math.max(0.25, Math.min(4, to || 1))
      setTimeout(tell, 60)
    })
  }

  /** Everything heard from inside the page goes straight on to the browser. */
  document.addEventListener('nya-media', (event) => {
    const detail = String((event as CustomEvent).detail || '')
    let state: unknown = null
    try {
      state = detail ? JSON.parse(detail) : null
    } catch {
      state = null
    }
    ipcRenderer.send('media:state', state)
  })

  ipcRenderer.on('media:command', (_event, command: { do: string; to?: number }) => {
    try {
      document.dispatchEvent(new CustomEvent('nya-media-do', { detail: JSON.stringify(command) }))
    } catch {
      /* the page is going away */
    }
  })

  window.addEventListener('pagehide', () => ipcRenderer.send('media:state', null))

  if (!inject()) {
    // No root element yet: the page is still being built. The moment it has
    // one the watcher goes in — still before the page's own scripts run.
    //
    // Once, and once only. Putting a script into a page is itself a change to
    // the page, so an observer that tried again on every change would answer
    // its own work for ever, and a site that refuses the script at all would
    // never stop it. That is a frozen tab, and it was one.
    const watch = new MutationObserver(() => {
      if (!document.documentElement) return
      watch.disconnect()
      if (!inject()) fromOutside()
    })
    try {
      watch.observe(document, { childList: true })
      setTimeout(() => watch.disconnect(), 10000)
    } catch {
      fromOutside()
    }
  }
}

/* ==========================================================================
 * A head start
 *
 * Two small habits that cost nothing and save a second each time they are
 * right.
 *
 * The pointer resting on a link is the best guess anybody has about the next
 * page: by the time the click lands, the connection is open and the document
 * is on its way. A page that names its own next page — `rel="next"`, which
 * search results, forum threads and documentation all set — is the other.
 *
 * Both only send an address. The main process decides whether to fetch it at
 * all: it knows whether the setting is on, whether this is a private window
 * and whether the machine is on battery, and none of those are the page's
 * business.
 * ====================================================================== */
if (isTop && httpOrigin) {
  const sent = new Set<string>()
  const offer = (url: string) => {
    if (!url || sent.has(url) || !/^https:/i.test(url)) return
    if (sent.size > 120) sent.clear()
    sent.add(url)
    ipcRenderer.send('page:prefetch', url)
  }

  // A quarter of a second: long enough that sweeping the pointer across a
  // paragraph of links does not fetch all of them, short enough to still be
  // ahead of the click.
  let timer: ReturnType<typeof setTimeout> | null = null
  document.addEventListener(
    'mouseover',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link) return
      const href = link.href
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => offer(href), 250)
    },
    { capture: true, passive: true }
  )
  document.addEventListener('mouseout', () => {
    if (timer) clearTimeout(timer)
    timer = null
  }, { capture: true, passive: true })

  // The page's own idea of what comes after it, once it has finished saying so.
  window.addEventListener('load', () => {
    setTimeout(() => {
      const next =
        document.querySelector<HTMLLinkElement>('link[rel~="next"][href]') ??
        document.querySelector<HTMLAnchorElement>('a[rel~="next"][href]')
      if (next) ipcRenderer.send('page:prefetch-next', next.href)
    }, 1200)
  })
}

/* ==========================================================================
 * Still, on battery
 *
 * The browser says when the machine is running off its battery and the saver
 * is on. What a page does about it is one stylesheet: animations and
 * transitions stop, and anything the page marked as decorative motion stops
 * with them. Nothing is hidden and nothing is resized — a page that looks
 * different on battery would be a worse trade than the battery it saved.
 *
 * `prefers-reduced-motion` is deliberately not touched: that is somebody's
 * standing preference about motion and not ours to answer on their behalf.
 * ====================================================================== */
if (isTop && httpOrigin) {
  const ID = 'nya-power-saver'
  ipcRenderer.on('page:power', (_event, saving: boolean) => {
    const root = document.documentElement
    if (!root) return
    const existing = document.getElementById(ID)
    if (!saving) {
      existing?.remove()
      return
    }
    if (existing) return
    const style = document.createElement('style')
    style.id = ID
    style.textContent =
      '*, *::before, *::after { animation-duration: 0s !important;' +
      ' animation-iteration-count: 1 !important; transition-duration: 0s !important }'
    root.appendChild(style)
  })
}
