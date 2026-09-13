import { contextBridge, ipcRenderer } from 'electron'
import { Readability, isProbablyReaderable } from '@mozilla/readability'

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
    if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname)) {
      if (ipcRenderer.sendSync('ads:on') === true) {
        contextBridge.executeInMainWorld({ func: youtubeWithoutAds })
      }
    }
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
    const password = passwordFields()[0]
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

  /**
   * Where the field is, in the page's own coordinates. The browser adds the
   * position of the page inside the window; it cannot know the scroll or the
   * layout, and this side cannot know where the page is drawn.
   */
  function report(field: HTMLElement, kind: 'login' | 'card' | 'address' = 'login') {
    const rect = field.getBoundingClientRect()
    ipcRenderer.send('autofill:field', {
      host: location.host,
      kind,
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
  let anchoredKind: 'login' | 'card' | 'address' = 'login'

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
      const field = loginField(event.target)
      if (field) {
        anchored = field
        anchoredKind = 'login'
        return report(field, 'login')
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
        if (!loginField(event.target) && !fieldKind(event.target)) return
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
 */
if (isTop && httpOrigin) {
  let host: HTMLElement | null = null
  let hidden = ''

  const off = () => {
    if (!host) return
    host.remove()
    host = null
    document.documentElement.style.overflow = hidden
    ipcRenderer.send('reader:state', { on: false })
  }

  const on = async (look: { dark: boolean; size: number; serif: boolean }) => {
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
    const ink = look.dark ? '#e7e7ee' : '#1a1a20'
    const paper = look.dark ? '#15151b' : '#fbfbfd'
    const dim = look.dark ? '#9a9aa8' : '#6b6b78'
    const line = look.dark ? '#2a2a34' : '#e3e3ea'
    const style = document.createElement('style')
    style.textContent = [
      `:host { all: initial }`,
      `.sheet { position: absolute; inset: 0; overflow-y: auto; background: ${paper}; color: ${ink};`,
      `  font: ${look.size}px/1.65 ${look.serif ? 'Georgia, "Times New Roman", serif' : 'system-ui, -apple-system, "Segoe UI", sans-serif'} }`,
            `.column { max-width: 44em; margin: 0 auto; padding: 56px 24px 96px }`,
      // The article brings its own class names with it; none of ours may be
      // among them, and anything it does bring is neutralised here.
      `.column * { position: static !important; float: none !important }`,
      `h1 { font-size: 1.9em; line-height: 1.2; margin: 0 0 .3em; letter-spacing: -.02em }`,
      `.by { color: ${dim}; font-size: .85em; margin: 0 0 2em; padding-bottom: 1.2em; border-bottom: 1px solid ${line} }`,
      `p, li { margin: 0 0 1.1em }`,
      `h2, h3, h4 { line-height: 1.25; margin: 1.8em 0 .6em }`,
      `img, video, figure, table { max-width: 100%; height: auto; margin: 1.4em 0 }`,
      `figcaption, small { color: ${dim}; font-size: .85em }`,
      `a { color: inherit; text-underline-offset: 2px }`,
      `pre, code { font-family: ui-monospace, Consolas, monospace; font-size: .9em }`,
      `pre { overflow-x: auto; padding: 1em; border-radius: 10px; background: ${look.dark ? '#1d1d25' : '#f1f1f6'} }`,
      `blockquote { margin: 1.4em 0; padding-left: 1.2em; border-left: 3px solid ${line}; color: ${dim} }`,
      `hr { border: 0; border-top: 1px solid ${line}; margin: 2em 0 }`
    ].join(NEWLINE)

    const page = document.createElement('div')
    page.className = 'sheet'
    const wrap = document.createElement('div')
    wrap.className = 'column'
    const title = document.createElement('h1')
    title.textContent = article.title || document.title
    wrap.appendChild(title)
    const by = [article.byline, article.siteName, readingTime(article.textContent ?? '')]
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
    page.appendChild(wrap)
    shadow.appendChild(style)
    shadow.appendChild(page)
    document.documentElement.appendChild(host)
    hidden = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    ipcRenderer.send('reader:state', { on: true })
  }

  /** Two headings that read the same, whatever the spacing and case. */
  const same = (a: string, b: string) =>
    a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

  /** Roughly how long this is to read, which is the one number people want. */
  const readingTime = (text: string) => {
    const words = text.trim().split(/\s+/).length
    const minutes = Math.max(1, Math.round(words / 200))
    return `${minutes} ` + MINUTES
  }

  ipcRenderer.on('reader:toggle', (_event, look: { dark: boolean; size: number; serif: boolean }) => {
    if (host) return off()
    void on(look ?? { dark: true, size: 19, serif: false })
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
