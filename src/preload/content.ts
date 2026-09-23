import { contextBridge, ipcRenderer } from 'electron'
import { Readability, isProbablyReaderable } from '@mozilla/readability'
import jsQR from 'jsqr'

/** Подписи кнопок под найденным кодом: перевод живёт в главном процессе. */
const qrWords = { open: 'Открыть', copy: 'Копировать', accent: '#7C6CFF', sec: '{n} с' }
ipcRenderer.on(
  'qr:words',
  (_event, words: { open?: string; copy?: string; accent?: string; sec?: string }) => {
    if (words?.open) qrWords.open = words.open
    if (words?.copy) qrWords.copy = words.copy
    // Подсказка перемотки: «+5 с» по-русски, «+5 s» по-английски, «+5 秒»…
    if (words?.sec && words.sec.indexOf('{n}') !== -1) qrWords.sec = words.sec
    // Цвет отметки — выбранный в настройках акцент: подсветка на чужой
    // странице всё равно наша, и выглядеть должна как остальной браузер.
    if (words?.accent && /^#[0-9a-f]{6}$/i.test(words.accent)) qrWords.accent = words.accent
  }
)

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
      // It rises into place. A sheet that simply exists where a page was
      // reads as the page breaking.
      `@keyframes nya-read-in { from { opacity: 0; transform: translate3d(0, 10px, 0) }`,
      `  to { opacity: 1; transform: none } }`,
      `.sheet { animation: nya-read-in .26s cubic-bezier(.22,1,.36,1) both;`,
      `  position: absolute; inset: 0; overflow-y: auto; background: ${paper}; color: ${ink};`,
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
   Перевод выделенного — пузырьком под словами
   ========================================================================== */

/**
 * Перевести пару строк, не трогая страницу.
 *
 * Перевод всей страницы возвращает её другой: вёрстка едет, место прокрутки
 * теряется, а половина сайтов после этого просто ломается. Ради одного
 * предложения это слишком. Здесь страница остаётся как была, а перевод
 * появляется прямо под выделением — там, где на него и смотрят.
 */
{
  let bubble: HTMLElement | null = null

  const hideBubble = () => {
    bubble?.remove()
    bubble = null
  }

  /** Пузырёк под последней строкой выделения, а не под курсором. */
  const showBubble = (text: string, waiting: boolean) => {
    hideBubble()
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rects = range ? [...range.getClientRects()] : []
    const last = rects[rects.length - 1]
    if (!last) return

    const box = document.createElement('nya-translation')
    box.textContent = text
    box.setAttribute(
      'style',
      [
        'position: fixed',
        'left: ' + Math.max(8, Math.min(last.left, window.innerWidth - 340)) + 'px',
        'top: ' + Math.min(last.bottom + 8, window.innerHeight - 80) + 'px',
        'max-width: 320px',
        'z-index: 2147483646',
        'padding: 9px 12px',
        'border-radius: 11px',
        'background: rgba(22, 23, 30, 0.97)',
        'color: #f2f3f7',
        'font: 14px/1.45 system-ui, sans-serif',
        'box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.6)',
        'white-space: pre-wrap',
        'opacity: ' + (waiting ? '0.6' : '1'),
        'pointer-events: none'
      ].join(';')
    )
    document.documentElement.appendChild(box)
    bubble = box
  }

  ipcRenderer.on('selection:translating', () => showBubble('…', true))
  ipcRenderer.on('selection:translation', (_event, text: string) =>
    showBubble(String(text ?? ''), false)
  )

  // Уходит от любого движения: пузырёк поверх текста мешает читать тот самый
  // текст, ради которого он появился.
  for (const name of ['scroll', 'pointerdown', 'keydown']) {
    window.addEventListener(name, hideBubble, { passive: true, capture: true })
  }
}

/* ==========================================================================
   Глазок в поле пароля
   ========================================================================== */

/**
 * Показать пароль, который вводишь.
 *
 * Сайты рисуют такую кнопку через раз, а без неё длинный пароль набирают
 * вслепую и ошибаются — особенно тот, что сгенерирован и состоит из
 * случайных знаков.
 *
 * Кнопка живёт рядом с полем, а не внутри него: класть что-то внутрь чужого
 * поля значит менять его разметку, а на этом ломаются сайты, которые за
 * своей разметкой следят.
 */
{
  // Тот же глаз, что у браузера везде: Icons.tsx, та же геометрия и та же
  // толщина линии. Кнопка стоит на чужой странице, но она наша, и выглядеть
  // должна как наша, а не как ещё один значок, нарисованный на скорую руку.
  const EYE =
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>' +
    '<circle cx="12" cy="12" r="3"/>'
  const EYE_OFF =
    '<path d="M4 4l16 16"/>' +
    '<path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4.1' +
    'M6.5 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"/>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'

  const eyed = new WeakSet<HTMLInputElement>()

  const eyeSvg = (open: boolean) =>
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    (open ? EYE_OFF : EYE) +
    '</svg>'

  const addEye = (field: HTMLInputElement) => {
    if (eyed.has(field)) return
    // Спрятанные поля и одноразовые коды из шести клеточек кнопкой не
    // снабжаем: в первых нечего показывать, вторые слишком узкие.
    if (field.type !== 'password' || field.offsetParent === null) return
    if (field.getBoundingClientRect().width < 90) return
    eyed.add(field)

    const eye = document.createElement('nya-eye')
    eye.innerHTML = eyeSvg(false)
    eye.setAttribute('role', 'button')
    eye.setAttribute(
      'style',
      [
        'position: absolute',
        'z-index: 2147483000',
        'width: 26px',
        'height: 26px',
        'display: grid',
        'place-items: center',
        'border-radius: 7px',
        'cursor: pointer',
        'color: rgba(104, 108, 126, 0.92)',
        'transition: color 120ms linear, background 120ms linear'
      ].join(';')
    )

    // Отклик на наведение: без него непонятно, что это вообще кнопка.
    eye.addEventListener('pointerenter', () => {
      eye.style.color = 'rgba(58, 61, 76, 0.96)'
      eye.style.background = 'rgba(127, 131, 150, 0.14)'
    })
    eye.addEventListener('pointerleave', () => {
      eye.style.color = 'rgba(104, 108, 126, 0.92)'
      eye.style.background = 'transparent'
    })

    const place = () => {
      const r = field.getBoundingClientRect()
      if (r.width === 0) return
      eye.style.left = window.scrollX + r.right - 32 + 'px'
      eye.style.top = window.scrollY + r.top + (r.height - 26) / 2 + 'px'
    }

    eye.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const open = field.type === 'text'
      field.type = open ? 'password' : 'text'
      eye.innerHTML = eyeSvg(!open)
      field.focus()
    })

    document.body.appendChild(eye)
    place()

    // Поле переезжает: страница раскрылась, окно изменили, выше что-то
    // дорисовалось.
    const watch = new ResizeObserver(place)
    watch.observe(field)
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place, { passive: true })

    // Поле убрали со страницы — убираем и кнопку, иначе она повиснет.
    const gone = new MutationObserver(() => {
      if (!field.isConnected) {
        eye.remove()
        watch.disconnect()
        gone.disconnect()
      }
    })
    gone.observe(document.body, { childList: true, subtree: true })
  }

  const sweepEyes = () => {
    const fields = document.querySelectorAll('input[type="password"]')
    for (let i = 0; i < fields.length; i++) addEye(fields[i] as HTMLInputElement)
  }

  if (isTop) {
    const startEyes = () => {
      sweepEyes()
      // Форма входа почти всегда дорисовывается позже самой страницы.
      new MutationObserver(() => sweepEyes()).observe(document.documentElement, {
        childList: true,
        subtree: true
      })
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startEyes, { once: true })
    } else {
      startEyes()
    }
  }
}

/* ==========================================================================
   Перемотка видео стрелками
   ========================================================================== */

/**
 * Стрелки перематывают видео, какой бы плеер его ни показывал.
 *
 * Свой плеер есть у каждого второго сайта, и половина из них про клавиатуру
 * не слышала: перемотка только мышью, целясь в полоску в четыре пикселя.
 * Браузер знает про video больше, чем страница рассказывает, и может
 * перематывать его сам.
 *
 * Не трогаем, когда человек печатает: в поле ввода стрелка — это стрелка.
 */
{
  const STEP = 5
  const BIG_STEP = 30

  const isTyping = () => {
    const at = document.activeElement as HTMLElement | null
    if (!at) return false
    if (at.isContentEditable) return true
    const tag = at.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  /** Видео, которое сейчас смотрят: играющее, иначе самое большое. */
  const watched = (): HTMLVideoElement | null => {
    const all = Array.prototype.slice.call(
      document.querySelectorAll('video')
    ) as HTMLVideoElement[]
    if (all.length === 0) return null
    for (const one of all) {
      if (!one.paused && !one.ended && one.readyState > 2) return one
    }
    all.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
    return all[0] ?? null
  }

  /**
   * Короткая подсказка: без неё перемотку на пять секунд не заметить.
   *
   * Стоит посреди того видео, которое перематывают, а не посреди экрана:
   * ролик на странице редко стоит в центре, и подсказка сбоку от него
   * читается как чужая.
   */
  let seekHint: HTMLElement | null = null
  let hideHintAt = 0
  const saySeek = (text: string, video: HTMLVideoElement) => {
    if (!seekHint) {
      seekHint = document.createElement('nya-seek')
      seekHint.setAttribute(
        'style',
        [
          'position: fixed',
          'transform: translate(-50%, -50%)',
          'z-index: 2147483646',
          'padding: 10px 16px',
          'border-radius: 999px',
          'background: rgba(12, 13, 18, 0.82)',
          'color: #fff',
          'font: 600 15px/1 system-ui, sans-serif',
          'pointer-events: none',
          'transition: opacity 180ms linear'
        ].join(';')
      )
      document.documentElement.appendChild(seekHint)
    }
    const r = video.getBoundingClientRect()
    const x = Math.max(60, Math.min(window.innerWidth - 60, r.left + r.width / 2))
    const y = Math.max(30, Math.min(window.innerHeight - 30, r.top + r.height / 2))
    seekHint.style.left = x + 'px'
    seekHint.style.top = y + 'px'
    // Во весь экран видно только одно дерево — подсказка переезжает в него.
    const host = (document.fullscreenElement as Element | null) ?? document.documentElement
    if (seekHint.parentNode !== host) host.appendChild(seekHint)
    seekHint.textContent = text
    seekHint.style.opacity = '1'
    hideHintAt = Date.now() + 700
    setTimeout(() => {
      if (seekHint && Date.now() >= hideHintAt) seekHint.style.opacity = '0'
    }, 750)
  }

  if (isTop) {
    window.addEventListener(
      'keydown',
      (event) => {
        if (isTyping() || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        const video = watched()
        if (!video || !isFinite(video.duration)) return
        const step = event.shiftKey ? BIG_STEP : STEP
        const back = event.key === 'ArrowLeft'
        video.currentTime = Math.max(
          0,
          Math.min(video.duration, video.currentTime + (back ? -step : step))
        )
        saySeek((back ? '−' : '+') + qrWords.sec.replace('{n}', String(step)), video)
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )
  }
}

/* ==========================================================================
   QR-код на странице
   ========================================================================== */

/**
 * Браузер читает квадрат сам — где бы он ни был.
 *
 * QR-код на странице — тупик: он сделан для камеры телефона, а камеры здесь
 * нет. Человек достаёт телефон ради ссылки, которая уже лежит перед ним на
 * экране.
 *
 * Код ищется двумя путями. Картинки и холсты страница читает сама, в полном
 * разрешении, — так находятся и мелкие коды. Всё остальное, что видно глазом,
 * — кадр видео, векторный рисунок, фон блока, чужой фрейм — браузер находит
 * на снимке отрисованной страницы (qrscan.ts в главном процессе).
 *
 * Найденный код обводится кольцом, и под ним появляется карточка с тем, что
 * в нём написано. Кольцо держится за код при прокрутке и изменении окна.
 * Нажатие на сам код гасит подсветку, следующее — возвращает. Код в видео
 * живёт, пока он в кадре, и нажатия по нему остаются плееру: остановить видео
 * щелчком — его право.
 *
 * Наружу не уходит ничего: всё читается на этой машине.
 */
{
  type Part = { x: number; y: number; w: number; h: number }
  type Code = {
    text: string
    /** Что держит код: картинка, холст, видео или блок, в котором он нарисован. */
    anchor: Element
    /** Где код внутри хозяина, в долях его размера; null — код и есть хозяин. */
    part: Part | null
    /** Код в кадре видео: сменится кадр — уйдёт и он. */
    live: boolean
    /** Сколько просмотров подряд код не нашёлся на своём месте. */
    missed: number
    /** Подсветку погасили нажатием. */
    hushed: boolean
    ring: HTMLElement
  }

  const codes: Code[] = []
  // Не const: при переходе внутри одностраничного сайта картинки часто
  // остаются теми же элементами с новым содержимым, и смотреть их надо заново.
  let looked = new WeakSet<Element>()
  let card: HTMLElement | null = null
  let cardFor: Code | null = null
  let ticking = false

  /** Цвет отметки — тот, который человек выбрал в браузере. */
  const ink = () => qrWords.accent

  /**
   * Куда вешать отметки. Во весь экран показывается только одно дерево, и
   * кольцо, оставленное снаружи, пропало бы вместе с остальной страницей.
   */
  const host = () => (document.fullscreenElement as Element | null) ?? document.documentElement

  const closeCard = () => {
    card?.remove()
    card = null
    cardFor = null
  }

  /** Прямоугольник кода на экране — по хозяину и месту внутри него. */
  const rectOf = (code: Code) => {
    const r = code.anchor.getBoundingClientRect()
    if (!code.part) return { left: r.left, top: r.top, width: r.width, height: r.height }
    return {
      left: r.left + code.part.x * r.width,
      top: r.top + code.part.y * r.height,
      width: code.part.w * r.width,
      height: code.part.h * r.height
    }
  }

  /**
   * Пиксели картинки — даже когда сайт не даёт прочитать свой холст.
   *
   * Картинка с другого сайта «пачкает» холст, и getImageData бросает. Сам
   * браузер этим ограничением не связан: он забирает байты и отдаёт их сюда.
   */
  const pixelsOf = async (
    node: HTMLImageElement | HTMLCanvasElement
  ): Promise<ImageData | null> => {
    const w = node instanceof HTMLImageElement ? node.naturalWidth : node.width
    const h = node instanceof HTMLImageElement ? node.naturalHeight : node.height
    if (w < 48 || h < 48 || w > 4000 || h > 4000) return null

    const board = document.createElement('canvas')
    board.width = w
    board.height = h
    const ctx = board.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null

    try {
      ctx.drawImage(node, 0, 0, w, h)
      return ctx.getImageData(0, 0, w, h)
    } catch {
      if (!(node instanceof HTMLImageElement) || !node.currentSrc) return null
      try {
        const bytes: ArrayBuffer | null = await ipcRenderer.invoke('qr:bytes', node.currentSrc)
        if (!bytes) return null
        const url = URL.createObjectURL(new Blob([bytes]))
        const copy = new Image()
        await new Promise((done, fail) => {
          copy.onload = done
          copy.onerror = fail
          copy.src = url
        })
        board.width = copy.naturalWidth
        board.height = copy.naturalHeight
        ctx.drawImage(copy, 0, 0)
        const out = ctx.getImageData(0, 0, board.width, board.height)
        URL.revokeObjectURL(url)
        return out
      } catch {
        return null
      }
    }
  }

  const button = (label: string, primary: boolean) => {
    const b = document.createElement('button')
    b.textContent = label
    b.setAttribute(
      'style',
      [
        'height: 28px',
        'padding: 0 11px',
        'border: 0',
        'border-radius: 8px',
        'cursor: pointer',
        'font: 600 12px/1 system-ui, sans-serif',
        primary
          ? 'background: ' + ink() + '; color: #fff'
          : 'background: rgba(255,255,255,0.08); color: #f2f3f7'
      ].join(';')
    )
    return b
  }

  /** Карточка с тем, что написано в коде. */
  const openCard = (code: Code) => {
    closeCard()
    if (code.hushed) return

    const box = document.createElement('nya-qr')
    box.setAttribute(
      'style',
      [
        'position: fixed',
        'max-width: 320px',
        'z-index: 2147483645',
        'padding: 11px 13px',
        'border-radius: 12px',
        'background: rgba(22, 23, 30, 0.97)',
        'color: #f2f3f7',
        'font: 13px/1.4 system-ui, sans-serif',
        'box-shadow: 0 14px 34px -10px rgba(0, 0, 0, 0.6)',
        'word-break: break-all'
      ].join(';')
    )

    const line = document.createElement('div')
    line.textContent = code.text.length > 160 ? code.text.slice(0, 160) + '…' : code.text
    box.appendChild(line)

    const row = document.createElement('div')
    row.setAttribute('style', 'display:flex;gap:7px;margin-top:9px')

    // Открывать можно только то, что похоже на адрес: код с текстом или с
    // номером телефона открывать некуда.
    if (/^(https?:\/\/|www\.)/i.test(code.text)) {
      const go = button(qrWords.open, true)
      go.addEventListener('click', () => {
        ipcRenderer.send('qr:open', code.text)
        closeCard()
      })
      row.appendChild(go)
    }

    const copy = button(qrWords.copy, false)
    copy.addEventListener('click', () => {
      ipcRenderer.send('qr:copy', code.text)
      closeCard()
    })
    row.appendChild(copy)
    box.appendChild(row)

    host().appendChild(box)
    card = box
    cardFor = code
    place()
  }

  const drop = (code: Code) => {
    code.ring.remove()
    codes.splice(codes.indexOf(code), 1)
    if (cardFor === code) closeCard()
  }

  /**
   * Отметки живут на месте кода: страница прокрутилась — они едут с ней, код
   * убрали — отметка уходит следом.
   */
  const place = () => {
    for (const code of [...codes]) {
      if (!code.anchor.isConnected) {
        drop(code)
        continue
      }
      const r = rectOf(code)
      const seen =
        !code.hushed &&
        code.missed === 0 &&
        r.width > 16 &&
        r.top + r.height > 0 &&
        r.top < window.innerHeight
      code.ring.style.display = seen ? 'block' : 'none'
      code.ring.style.left = r.left - 5 + 'px'
      code.ring.style.top = r.top - 5 + 'px'
      code.ring.style.width = r.width + 10 + 'px'
      code.ring.style.height = r.height + 10 + 'px'
    }
    if (card && cardFor) {
      const r = rectOf(cardFor)
      card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + 'px'
      card.style.top = Math.min(r.top + r.height + 12, window.innerHeight - 110) + 'px'
      card.style.display = r.top + r.height > 0 && r.top < window.innerHeight ? 'block' : 'none'
    }
  }

  const replace = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      place()
    })
    // Скрытой странице кадров не дают вовсе, и без этого флаг остался бы
    // поднятым навсегда — а с ним и кольцо на старом месте.
    setTimeout(() => {
      if (!ticking) return
      ticking = false
      place()
    }, 120)
  }

  /** Насколько два прямоугольника на экране — одно и то же место. */
  const overlap = (
    a: { left: number; top: number; width: number; height: number },
    b: { left: number; top: number; width: number; height: number }
  ) => {
    const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
    const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
    if (w <= 0 || h <= 0) return 0
    return (w * h) / Math.min(a.width * a.height, b.width * b.height)
  }

  /** Новый код — или тот же самый, найденный ещё раз. */
  const adopt = (text: string, anchor: Element, part: Part | null, live: boolean) => {
    const probe: Code = {
      text,
      anchor,
      part,
      live,
      missed: 0,
      hushed: false,
      ring: document.documentElement
    }
    const here = rectOf(probe)
    // Тот же текст на том же месте — тот же код, даже если в этот раз его
    // нашли через другой элемент.
    const same = codes.find(
      (code) =>
        code.text === text &&
        ((code.anchor === anchor &&
          (!part || !code.part || Math.abs(code.part.x - part.x) < 0.25)) ||
          overlap(rectOf(code), here) > 0.5)
    )
    if (same) {
      const back = same.missed > 0
      same.missed = 0
      // Код, прочитанный из самой картинки, обводится по картинке — ровным
      // квадратом, а не по углам, которые нашёл снимок экрана.
      if (!part && same.anchor === anchor) same.part = null
      else if (part && (same.part || same.anchor !== anchor)) same.part = part
      // Код вернулся в кадр — карточка возвращается с ним, если на экране нет
      // другой.
      if (back && !card) openCard(same)
      place()
      return
    }

    const ring = document.createElement('nya-qr-ring')
    ring.setAttribute(
      'style',
      [
        'position: fixed',
        'border: 2px solid ' + ink(),
        'border-radius: 12px',
        'box-shadow: 0 0 0 4px color-mix(in srgb, ' + ink() + ' 18%, transparent)',
        'z-index: 2147483644',
        // Кольцо лежит поверх кода, и если оно ловит нажатия, то по коду,
        // который сам может быть ссылкой, уже не нажать.
        'pointer-events: none'
      ].join(';')
    )
    host().appendChild(ring)

    const code: Code = { text, anchor, part, live, missed: 0, hushed: false, ring }
    codes.push(code)
    place()
    // Карточка открывается сама: иначе о том, что код прочитан, узнает только
    // тот, кто догадается нажать. Но не отнимает место у уже открытой: на
    // странице с тремя кодами карточки иначе перескакивали бы с кода на код.
    if (!card) openCard(code)
  }

  /* ------------------------------------------- картинки и холсты страницы */

  /** Достаточно квадратная и достаточно большая, чтобы быть кодом. */
  const couldBeCode = (node: HTMLImageElement | HTMLCanvasElement) => {
    const r = node.getBoundingClientRect()
    if (r.width < 56 || r.height < 56) return false
    const ratio = r.width / r.height
    return ratio > 0.7 && ratio < 1.4
  }

  const readOne = async (node: HTMLImageElement | HTMLCanvasElement) => {
    if (codes.some((code) => code.anchor === node && !code.part)) return true
    if (looked.has(node) || !couldBeCode(node)) return false
    looked.add(node)
    const pixels = await pixelsOf(node)
    if (!pixels) return false
    const found = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: 'dontInvert'
    })
    if (!found || !found.data) return false
    adopt(found.data, node, null, false)
    return true
  }

  const sweepQr = async () => {
    const nodes = document.querySelectorAll('img, canvas')
    for (let i = 0; i < nodes.length && i < 120; i++) {
      const node = nodes[i] as HTMLImageElement | HTMLCanvasElement
      if (node instanceof HTMLImageElement && !node.complete) continue
      await readOne(node)
    }
  }

  /* ------------------------------------------ всё остальное, что видно */

  /** Видео под точкой — на нём код живёт, пока он в кадре. */
  const videoAt = (x: number, y: number): HTMLVideoElement | null => {
    for (const video of document.querySelectorAll('video')) {
      const r = video.getBoundingClientRect()
      if (r.width > 120 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return video
    }
    return null
  }

  /** Самый глубокий элемент страницы под точкой, не считая наших отметок. */
  const ownerAt = (x: number, y: number): Element | null => {
    for (const node of document.elementsFromPoint(x, y)) {
      if (node.tagName.indexOf('NYA-') === 0) continue
      if (node === document.documentElement || node === document.body) return node
      const r = node.getBoundingClientRect()
      if (r.width >= 24 && r.height >= 24) return node
    }
    return null
  }

  let looking = false
  let lastLook = 0

  /** Кадры видео, которые сейчас видно, — в пикселях страницы. */
  const videoAreas = () => {
    const out: Part[] = []
    for (const video of document.querySelectorAll('video')) {
      const r = video.getBoundingClientRect()
      if (r.width < 120 || r.bottom <= 0 || r.top >= window.innerHeight) continue
      const x = Math.max(0, r.left)
      const y = Math.max(0, r.top)
      out.push({
        x,
        y,
        w: Math.min(window.innerWidth, r.right) - x,
        h: Math.min(window.innerHeight, r.bottom) - y
      })
    }
    return out
  }

  /**
   * Всё на экране, что может оказаться кодом, — в пикселях страницы.
   *
   * Слепо резать весь экран на плитки мало: когда коды стоят тесно, в любую
   * плитку попадает несколько, и не читается ни один. А страница сама знает,
   * где у неё рисунки: векторные, фоновые, холсты, видео, чужие фреймы. Их и
   * смотрят первыми, каждый по отдельности.
   */
  const candidates = (): { node: Element; area: Part }[] => {
    const out: { node: Element; area: Part }[] = []
    const seen = new Set<Element>()
    const add = (node: Element) => {
      if (seen.has(node) || out.length >= 24) return
      seen.add(node)
      const r = node.getBoundingClientRect()
      if (r.width < 56 || r.height < 56) return
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) {
        return
      }
      // Видео и фреймы бывают любой формы; остальное должно быть похоже на
      // квадрат, иначе это баннер, а не код.
      const free = node instanceof HTMLVideoElement || node instanceof HTMLIFrameElement
      const ratio = r.width / r.height
      if (!free && (ratio < 0.6 || ratio > 1.7)) return
      const x = Math.max(0, r.left)
      const y = Math.max(0, r.top)
      out.push({
        node,
        area: {
          x,
          y,
          w: Math.min(window.innerWidth, r.right) - x,
          h: Math.min(window.innerHeight, r.bottom) - y
        }
      })
    }
    for (const node of document.querySelectorAll('svg, video, iframe, canvas, object, embed')) {
      add(node)
    }
    // Фоновые картинки видно только по вычисленному стилю. Смотрим не
    // больше нескольких тысяч элементов: на огромных страницах дальше
    // экрана всё равно ничего не видно.
    const all = document.body ? document.body.getElementsByTagName('*') : null
    for (let i = 0; all && i < all.length && i < 4000; i++) {
      const node = all[i]
      if (node.tagName.indexOf('NYA-') === 0) continue
      const bg = getComputedStyle(node).backgroundImage
      if (bg && bg !== 'none' && bg.indexOf('url(') !== -1) add(node)
    }
    return out
  }

  /**
   * Один просмотр отрисованной страницы.
   *
   * `onlyVideos` — пока идёт ролик, смотреть незачем на всё: стоящее на
   * месте уже осмотрено, а меняется только кадр. Так просмотр раз в секунду
   * стоит в десятки раз дешевле полного.
   */
  const lookAtScreen = async (onlyVideos = false) => {
    if (looking || document.visibilityState !== 'visible') return
    const near = onlyVideos ? [] : candidates()
    const areas = onlyVideos ? videoAreas() : near.map((one) => one.area)
    if (onlyVideos && areas.length === 0) return
    looking = true
    lastLook = Date.now()
    try {
      const found: { text: string; x: number; y: number; w: number; h: number }[] =
        await ipcRenderer.invoke('qr:look', {
          width: window.innerWidth,
          height: window.innerHeight,
          areas,
          frames: onlyVideos
        })

      const seenLive = new Set<Code>()
      for (const hit of found ?? []) {
        if (!hit || !hit.text || hit.w < 12 || hit.h < 12) continue
        const cx = hit.x + hit.w / 2
        const cy = hit.y + hit.h / 2

        // Тот же код, уже найденный в картинке, отмечать второй раз незачем.
        const twin = codes.find((code) => {
          if (code.text !== hit.text || code.live) return false
          const r = rectOf(code)
          return cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height
        })
        if (twin) continue

        const video = videoAt(cx, cy)
        // Хозяин кода — тот из присланных элементов, в котором он лежит, и
        // самый маленький из них. Не «самый глубокий под точкой»: внутри
        // векторного рисунка это то path, то rect, и один и тот же код
        // заводился бы заново при каждом просмотре.
        let owner: Element | null = null
        let smallest = Infinity
        for (const one of near) {
          const a = one.area
          const inside = cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h
          if (inside && a.w * a.h < smallest) {
            smallest = a.w * a.h
            owner = one.node
          }
        }
        const anchor = video ?? owner ?? ownerAt(cx, cy)
        if (!anchor) continue
        const r = anchor.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const part = {
          x: (hit.x - r.left) / r.width,
          y: (hit.y - r.top) / r.height,
          w: hit.w / r.width,
          h: hit.h / r.height
        }
        adopt(hit.text, anchor, part, Boolean(video))
        const code = codes.find((one) => one.text === hit.text && one.anchor === anchor)
        if (code && code.live) seenLive.add(code)
      }

      // Кадр сменился — код, которого в нём больше нет, гаснет сразу: пустое
      // кольцо над видео выглядит как поломка. Совсем уходит он после трёх
      // промахов подряд — кадр мог быть смазан переходом, и тогда код
      // вернётся на своё место без новой карточки.
      for (const code of [...codes]) {
        if (!code.live || seenLive.has(code)) continue
        code.missed++
        if (cardFor === code) closeCard()
        if (code.missed >= 3) drop(code)
      }
      place()
    } catch {
      /* снимка не вышло — посмотрим в следующий раз */
    } finally {
      looking = false
    }
  }

  let soonLook = 0
  const lookSoon = (after: number) => {
    clearTimeout(soonLook)
    const wait = Math.max(after, 800 - (Date.now() - lastLook))
    soonLook = window.setTimeout(() => void lookAtScreen(), wait)
  }

  /** Идёт ли на странице видео, которое сейчас видно. */
  const videoPlaying = () => {
    for (const video of document.querySelectorAll('video')) {
      if (video.paused || video.ended || video.readyState < 2) continue
      const r = video.getBoundingClientRect()
      if (r.width > 120 && r.bottom > 0 && r.top < window.innerHeight) return true
    }
    return false
  }

  if (isTop) {
    let soon = 0
    const sweepSoon = (after: number) => {
      clearTimeout(soon)
      soon = window.setTimeout(() => void sweepQr(), after)
    }

    // Через секунду после загрузки: картинки к этому моменту на месте, а
    // осматривать весь интернет на каждой перерисовке незачем.
    window.addEventListener('load', () => {
      sweepSoon(1200)
      lookSoon(1600)
    })
    // Возвращение назад достаёт страницу из кэша, и load уже не случится.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        for (const code of codes) host().appendChild(code.ring)
        place()
      }
      sweepSoon(400)
      lookSoon(700)
    })

    // Картинки появляются и позже: ленивая подгрузка, галерея, переход внутри
    // одностраничного сайта.
    //
    // Только когда документ уже есть. Этот скрипт запускается раньше самой
    // страницы, и documentElement в этот момент бывает пуст: observe(null)
    // бросает, и всё, что записано ниже, молча не подключалось бы.
    const watchImages = () =>
      new MutationObserver((changes) => {
        for (const change of changes) {
          for (const node of change.addedNodes) {
            if (node instanceof HTMLImageElement || node instanceof HTMLCanvasElement) {
              sweepSoon(900)
              lookSoon(1200)
              return
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true })
    if (document.documentElement) watchImages()
    else document.addEventListener('DOMContentLoaded', watchImages, { once: true })

    // Видео смотрят постоянно, пока оно идёт: код в ролике показывают на
    // несколько секунд. На паузе и после перемотки — сразу: именно так и
    // поступают, заметив код в кадре.
    // Одностраничные сайты — YouTube первым — переходят со страницы на
    // страницу без перезагрузки: pagehide не случается, и отметки с прошлой
    // страницы остались бы висеть над новой. Смена адреса — это смена
    // страницы, как бы сайт её ни делал.
    let lastHref = location.href
    window.setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href
        closeCard()
        for (const code of [...codes]) drop(code)
        looked = new WeakSet<Element>()
        sweepSoon(900)
        lookSoon(1200)
        return
      }
      if (videoPlaying()) void lookAtScreen(true)
    }, 1000)
    for (const name of ['pause', 'seeked', 'play']) {
      document.addEventListener(name, () => lookSoon(250), true)
    }

    /**
     * Нажатие на сам код гасит подсветку и возвращает её.
     *
     * Отдельной кнопки для этого нет: код — сам себе кнопка. Собственное
     * действие страницы не отменяется: если код — ссылка, ссылка сработает.
     * Код в видео так не переключается: нажатие по видео — это пауза, и
     * отнимать её у плеера нельзя.
     */
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element | null
        if (!target || target.closest?.('nya-qr')) return
        const code = codes.find(
          (one) =>
            !one.live &&
            (one.anchor === target || one.anchor.contains(target)) &&
            (() => {
              if (!one.part) return true
              const r = rectOf(one)
              return (
                event.clientX >= r.left &&
                event.clientX <= r.left + r.width &&
                event.clientY >= r.top &&
                event.clientY <= r.top + r.height
              )
            })()
        )
        if (!code) return
        code.hushed = !code.hushed
        if (code.hushed) {
          if (cardFor === code) closeCard()
        } else {
          openCard(code)
        }
        place()
      },
      true
    )

    let settle = 0
    window.addEventListener(
      'scroll',
      () => {
        replace()
        // Прокрутили — на экране новое; смотрим, когда прокрутка остановится.
        clearTimeout(settle)
        settle = window.setTimeout(() => lookSoon(0), 500)
      },
      { passive: true }
    )
    // Изменение окна — сразу, без ожидания кадра: кадр у окна, которое тянут
    // за край, приходит не всегда, а кольцо должно стоять на коде.
    window.addEventListener(
      'resize',
      () => {
        place()
        clearTimeout(settle)
        settle = window.setTimeout(() => lookSoon(0), 500)
      },
      { passive: true }
    )
    // Страница двигает код и сама: сверху догрузилась картинка, раскрылся
    // блок. Ни прокрутки, ни изменения окна при этом нет.
    const layout = new ResizeObserver(replace)
    const watchLayout = () => layout.observe(document.body ?? document.documentElement)
    if (document.body) watchLayout()
    else document.addEventListener('DOMContentLoaded', watchLayout, { once: true })

    // Во весь экран и обратно — отметки переезжают туда, где их видно.
    document.addEventListener('fullscreenchange', () => {
      for (const code of codes) host().appendChild(code.ring)
      if (card) host().appendChild(card)
      place()
      lookSoon(300)
    })
    // Вернулись на вкладку — на ней могло смениться что угодно.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') lookSoon(300)
    })

    // Уходя со страницы — уходим совсем: отметки привязаны к этому документу.
    window.addEventListener('pagehide', () => {
      closeCard()
      for (const code of codes) code.ring.remove()
    })
  }
}

/* ==========================================================================
   Место прокрутки
   ========================================================================== */

/**
 * Страница помнит, докуда её прочитали.
 *
 * Сессия возвращает вкладки, но возвращает их в начало — и человек, закрывший
 * браузер на середине длинной статьи или на сотом письме в списке, приходит
 * обратно на первый экран и ищет своё место заново.
 *
 * Здесь страница рассказывает браузеру, докуда её прокрутили, и сама
 * возвращается на это место, когда её открывают снова. Возвращается не с
 * первой попытки: в момент загрузки страница почти всегда короче, чем будет
 * через секунду, и прокрутка на десять тысяч пикселей по короткой странице
 * не проходит.
 */
{
  if (isTop) {
    let last = -1
    let waiting = false

    // Прокрутка приходит десятками событий в секунду; браузеру достаточно
    // знать положение, а не каждое движение по пути к нему.
    const tellScroll = () => {
      if (waiting) return
      waiting = true
      setTimeout(() => {
        waiting = false
        const y = Math.round(window.scrollY)
        if (y === last) return
        last = y
        ipcRenderer.send('page:scroll', y)
      }, 400)
    }
    window.addEventListener('scroll', tellScroll, { passive: true })

    ipcRenderer.on('page:scroll-to', (_event, y: number) => {
      const want = Number(y) || 0
      if (want <= 0) return
      // Восемь попыток за две секунды: столько живёт дорисовка у тяжёлых
      // страниц. Как только доехали — перестаём, и дальше страница ничья.
      let tries = 0
      const reach = () => {
        window.scrollTo(0, want)
        tries++
        if (Math.abs(window.scrollY - want) < 4 || tries >= 8) return
        setTimeout(reach, 250)
      }
      reach()
    })
  }
}
