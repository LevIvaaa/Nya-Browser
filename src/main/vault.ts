import { safeStorage } from 'electron'
import {
  createCipheriv,
  createHash,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'crypto'
import { JsonStore, track } from './store'
import type { AddressFields, AddressMeta, CardMeta, PasswordAudit } from '../shared/types'
import { judge } from '../shared/password'
import { codeFor, secretOf } from './totp'
import { stolenWithPrefix } from './breach'

export type { AddressFields, AddressMeta, CardMeta }

const VAULT_VERSION = 1
const KEY_LEN = 32
const IV_LEN = 12
const SCRYPT = { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

export interface Credential {
  id: string
  /** host only, e.g. "github.com" — credentials never cross origins */
  origin: string
  username: string
  created: number
  used: number
  note?: string
  /** true when a one-time code lives with this entry */
  code?: boolean
  /** the attached file, described but not carried */
  file?: { name: string; size: number }
  /** when it was thrown away; absent while it is in use */
  binned?: number
}

interface Sealed {
  iv: string
  data: string
  tag: string
}

interface VaultEntry extends Credential {
  secret: Sealed
  /** the TOTP secret, sealed like the password */
  totp?: Sealed
  /** the attached file, sealed like everything else here */
  blob?: Sealed
}

interface CardEntry extends CardMeta {
  /** the card number, sealed */
  secret: Sealed
}

interface AddressEntry extends AddressMeta {
  /** the fields, sealed as one piece of JSON */
  secret: Sealed
}

interface VaultFile {
  /** how the master key is protected: OS keychain, or a password only the user knows */
  mode: 'os' | 'password'
  /** master key sealed by the OS keychain (mode 'os') */
  osKey: string
  /** scrypt parameters for mode 'password' */
  salt: string
  /** encrypted probe used to verify a typed master password */
  verifier: Sealed | null
  /**
   * The master key sealed by the OS keychain, kept only so Windows Hello can
   * open the vault: Hello proves who is at the keyboard, it does not derive
   * anything. Present in either mode, absent unless Hello is turned on.
   */
  helloKey: string
  entries: VaultEntry[]
  cards: CardEntry[]
  addresses: AddressEntry[]
}

const emptyVault = (): VaultFile => ({
  mode: 'os',
  osKey: '',
  salt: '',
  verifier: null,
  helloKey: '',
  entries: [],
  cards: [],
  addresses: []
})

/**
 * Suffixes under which a name is somebody else's site, not a subdomain of
 * yours. Chromium carries the whole public suffix list for this; a browser that
 * only needs to decide whether two hosts are the same place can do with the
 * shapes that actually occur — a two-letter country code with a second level
 * under it, and the handful of generic ones that work the same way.
 *
 * Getting this wrong in the loose direction would offer a password saved on
 * one co.uk site while standing on another, so the rule errs the other way: an
 * unrecognised shape is treated as its own site and nothing is shared.
 */
const SECOND_LEVEL = new Set([
  'co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'mil', 'sch', 'or', 'ne', 'go',
  'in', 'nic', 'web', 'info', 'biz', 'name', 'pp', 'me', 'ltd', 'plc', 'firm',
  'gen', 'k12', 'lg', 'priv'
])

/**
 * The registrable name two hosts have to share to count as one site:
 * mail.example.com and accounts.example.com are both 'example.com'.
 * Returns '' for anything that is not a name — an address, or a bare label.
 */
export function siteOf(host: string): string {
  const name = host.toLowerCase().replace(/\.+$/, '')
  if (!name || !name.includes('.')) return ''
  // An IP address is only ever itself.
  if (/^[0-9.]+$/.test(name) || name.includes(':')) return ''
  const parts = name.split('.')
  if (parts.length < 2) return ''
  const tld = parts[parts.length - 1]
  const second = parts[parts.length - 2]
  // 'example.co.uk' keeps three labels; 'example.com' keeps two.
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) && parts.length >= 3 ? 3 : 2
  if (parts.length < keep) return ''
  return parts.slice(-keep).join('.')
}

const b64 = (b: Buffer) => b.toString('base64')
const unb64 = (s: string) => Buffer.from(s, 'base64')

function seal(key: Buffer, plain: string, aad: string): Sealed {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { iv: b64(iv), data: b64(data), tag: b64(cipher.getAuthTag()) }
}

function open(key: Buffer, sealed: Sealed, aad: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, unb64(sealed.iv), { authTagLength: 16 })
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(unb64(sealed.tag))
  return Buffer.concat([decipher.update(unb64(sealed.data)), decipher.final()]).toString('utf8')
}

/**
 * Password store.
 *
 * Every password is encrypted on its own with AES-256-GCM, and the origin plus
 * user name go in as additional authenticated data — so a saved entry cannot be
 * moved to a different site without the decryption failing.
 *
 * The master key is protected one of two ways:
 *  - `os`: sealed with the OS keychain (DPAPI on Windows). Copying the file to
 *    another machine or another Windows account makes it undecryptable.
 *  - `password`: derived from a master password with scrypt (N=65536). The key
 *    exists only in memory while the vault is unlocked and never touches disk.
 *
 * Plaintext passwords never reach the renderer unless the user explicitly asks
 * for one, and never reach a web page except as an autofill push the user
 * started themselves.
 */
class Vault {
  private store = track(
    new JsonStore<VaultFile>(
      'passwords.json',
      emptyVault,
      VAULT_VERSION,
      (data) => data as Partial<VaultFile>,
      (data) => ({
        mode: data?.mode === 'password' ? 'password' : 'os',
        osKey: typeof data?.osKey === 'string' ? data.osKey : '',
        salt: typeof data?.salt === 'string' ? data.salt : '',
        verifier: data?.verifier ?? null,
        helloKey: typeof data?.helloKey === 'string' ? data.helloKey : '',
        entries: Array.isArray(data?.entries)
          ? data.entries.filter(
              (e) => e && typeof e.origin === 'string' && typeof e.username === 'string' && e.secret
            )
          : [],
        // Cards and addresses are newer than the first vaults written, so a
        // file from before them opens with none rather than with nothing.
        cards: Array.isArray(data?.cards)
          ? data.cards.filter((c) => c && typeof c.id === 'string' && c.secret)
          : [],
        addresses: Array.isArray(data?.addresses)
          ? data.addresses.filter((a) => a && typeof a.id === 'string' && a.secret)
          : []
      })
    )
  )

  /** In-memory only. Cleared on lock and never serialised. */
  private key: Buffer | null = null

  /**
   * `hold` keeps the vault shut even in OS-keychain mode, which is what the
   * "ask when the browser starts" setting means: the keychain would otherwise
   * open it before anyone had been asked anything.
   */
  load(dir: string, hold = false) {
    this.key = null
    this.store.open(dir)
    if (!hold && this.store.get().mode === 'os') this.unlockWithOs()
  }

  get mode() {
    return this.store.get().mode
  }

  get locked() {
    return this.key === null
  }

  get count() {
    return this.store.get().entries.length
  }

  get encryptionAvailable() {
    return safeStorage.isEncryptionAvailable()
  }

  /** Whether this vault has a key put aside for Windows Hello to open. */
  get helloEnabled() {
    return this.store.get().helloKey !== ''
  }

  /* ------------------------------------------------------------ unlocking */
  private unlockWithOs(): boolean {
    const file = this.store.get()
    if (!safeStorage.isEncryptionAvailable()) return false
    try {
      if (file.osKey) {
        const decoded = unb64(safeStorage.decryptString(unb64(file.osKey)))
        if (decoded.length !== KEY_LEN) return false
        this.key = decoded
        return true
      }
      const key = randomBytes(KEY_LEN)
      this.store.set({ osKey: b64(safeStorage.encryptString(b64(key))), mode: 'os' })
      this.store.flush()
      this.key = key
      return true
    } catch {
      this.key = null
      return false
    }
  }

  unlock(password: string): boolean {
    const file = this.store.get()
    if (file.mode === 'os') return this.unlockWithOs()
    if (!file.salt || !file.verifier) return false
    const key = scryptSync(password, unb64(file.salt), KEY_LEN, SCRYPT)
    try {
      const probe = open(key, file.verifier, 'verifier')
      if (probe !== 'nya-vault') return false
      this.key = key
      return true
    } catch {
      return false
    }
  }

  lock() {
    if (this.key) this.key.fill(0)
    this.key = null
  }

  /* --------------------------------------------------------- Windows Hello */

  /**
   * Puts a copy of the master key aside, sealed by the OS keychain, so a Hello
   * verification can open the vault without a password being typed. The vault
   * has to be open already: this stores what is there, it does not find it.
   *
   * The copy is no weaker than the keychain that holds it — the same protection
   * OS mode already relies on — and reaching it in this process additionally
   * costs a PIN, a fingerprint or a face.
   */
  enableHello(): boolean {
    if (!this.key || !safeStorage.isEncryptionAvailable()) return false
    this.store.set({ helloKey: b64(safeStorage.encryptString(b64(this.key))) })
    this.store.flush()
    return true
  }

  disableHello() {
    this.store.set({ helloKey: '' })
    this.store.flush()
  }

  /**
   * Opens the vault with the key Hello guards. The caller does the verifying —
   * this is only reached once someone has actually answered the prompt.
   */
  unlockWithHelloKey(): boolean {
    const file = this.store.get()
    if (!file.helloKey || !safeStorage.isEncryptionAvailable()) return false
    try {
      const decoded = unb64(safeStorage.decryptString(unb64(file.helloKey)))
      if (decoded.length !== KEY_LEN) return false
      this.key?.fill(0)
      this.key = decoded
      return true
    } catch {
      return false
    }
  }

  /* -------------------------------------------------- master password mode */
  /** Turns on master-password mode, re-encrypting every stored secret. */
  setMasterPassword(current: string | null, next: string): boolean {
    const file = this.store.get()
    if (file.mode === 'password') {
      if (!current || !this.unlock(current)) return false
    } else if (!this.key && !this.unlockWithOs()) {
      return false
    }
    if (next.length < 8) return false

    const plain = this.decryptAll()
    if (!plain) return false

    const salt = randomBytes(16)
    const key = scryptSync(next, salt, KEY_LEN, SCRYPT)
    const entries = plain.map((item) => ({
      ...item.meta,
      secret: seal(key, item.password, `${item.meta.origin}|${item.meta.username}`)
    }))
    const rest = this.resealRest(key)
    if (!rest) return false
    this.store.replace({
      mode: 'password',
      osKey: '',
      salt: b64(salt),
      verifier: seal(key, 'nya-vault', 'verifier'),
      // The key changed, so any copy Hello was holding is stale. Turning Hello
      // back on re-seals the new one.
      helloKey: '',
      entries,
      ...rest
    })
    this.store.flush()
    this.key?.fill(0)
    this.key = key
    return true
  }

  /** Goes back to OS-keychain protection (requires the current password). */
  removeMasterPassword(current: string): boolean {
    const file = this.store.get()
    if (file.mode !== 'password') return true
    if (!this.unlock(current)) return false
    if (!safeStorage.isEncryptionAvailable()) return false

    const plain = this.decryptAll()
    if (!plain) return false
    const key = randomBytes(KEY_LEN)
    const entries = plain.map((item) => ({
      ...item.meta,
      secret: seal(key, item.password, `${item.meta.origin}|${item.meta.username}`)
    }))
    const rest = this.resealRest(key)
    if (!rest) return false
    this.store.replace({
      mode: 'os',
      osKey: b64(safeStorage.encryptString(b64(key))),
      salt: '',
      verifier: null,
      helloKey: '',
      entries,
      ...rest
    })
    this.store.flush()
    this.key?.fill(0)
    this.key = key
    return true
  }

  /* ------------------------------------------------------------- entries */
  list(): Credential[] {
    return this.store
      .get()
      .entries.filter((e) => !e.binned)
      .map(({ secret: _secret, totp: _totp, blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.used - a.used)
  }

  /** What was thrown away and is still recoverable. */
  binned(): Credential[] {
    return this.store
      .get()
      .entries.filter((e) => e.binned)
      .map(({ secret: _secret, totp: _totp, blob: _blob, ...meta }) => meta)
      .sort((a, b) => (b.binned ?? 0) - (a.binned ?? 0))
  }

  /**
   * Entries worth offering on a host: the ones saved for exactly it first, then
   * the ones saved elsewhere on the same site.
   *
   * Exact-only matching was too strict to be useful — a password saved on
   * accounts.example.com was not offered on mail.example.com, which is one
   * sign-in as far as anyone using it is concerned. Nothing is filled without
   * being picked, and the offer says which address a credential was saved for
   * when it is not this one.
   */
  forOrigin(origin: string): Credential[] {
    const host = origin.toLowerCase().replace(/^www\./, '')
    if (!host) return []
    const site = siteOf(host)
    return this.list()
      .filter((e) => e.origin === host || (site !== '' && siteOf(e.origin) === site))
      .sort((a, b) => Number(b.origin === host) - Number(a.origin === host) || b.used - a.used)
  }

  /** True when a credential may be filled into this host. */
  matches(origin: string, entry: Credential): boolean {
    const host = origin.toLowerCase().replace(/^www\./, '')
    if (!host) return false
    if (entry.origin === host) return true
    const site = siteOf(host)
    return site !== '' && siteOf(entry.origin) === site
  }

  save(origin: string, username: string, password: string, note?: string): boolean {
    if (this.locked || !this.key) return false
    const host = origin.toLowerCase().replace(/^www\./, '')
    if (!host || !password) return false

    const file = this.store.get()
    const existing = file.entries.find((e) => e.origin === host && e.username === username)
    const meta: Credential = existing
      ? { ...existing, used: Date.now(), note: note ?? existing.note }
      : {
          id: randomUUID(),
          origin: host,
          username: username.slice(0, 200),
          created: Date.now(),
          used: Date.now(),
          note
        }
    const entry: VaultEntry = {
      ...meta,
      secret: seal(this.key, password, `${host}|${meta.username}`)
    }
    const entries = existing
      ? file.entries.map((e) => (e.id === existing.id ? entry : e))
      : [...file.entries, entry]
    this.store.replace({ ...file, entries })
    this.store.flush()
    return true
  }

  /**
   * The one-time code secret, kept beside the password it belongs to. An empty
   * string takes it away again.
   */
  setCode(id: string, input: string): boolean {
    if (this.locked || !this.key) return false
    const file = this.store.get()
    const entry = file.entries.find((e) => e.id === id)
    if (!entry) return false
    const secret = input.trim() ? secretOf(input) : ''
    if (input.trim() && !secret) return false
    const entries = file.entries.map((e) =>
      e.id === id
        ? {
            ...e,
            code: Boolean(secret),
            totp: secret ? seal(this.key as Buffer, secret, `totp|${id}`) : undefined
          }
        : e
    )
    this.store.replace({ ...file, entries })
    this.store.flush()
    return true
  }

  /** The six digits for right now, and the seconds they have left. */
  code(id: string): { digits: string; left: number } | null {
    if (this.locked || !this.key) return null
    const entry = this.store.get().entries.find((e) => e.id === id)
    if (!entry?.totp) return null
    try {
      return codeFor(open(this.key, entry.totp, `totp|${id}`))
    } catch {
      return null
    }
  }

  /**
   * Which saved passwords are worth changing: the weak ones, the ones used in
   * more than one place, and the ones that have not been changed in a year.
   *
   * Reading every password to judge it is exactly what this vault exists to
   * prevent, so it happens here, in the main process, and only the verdicts
   * leave — never the passwords.
   */
  audit(): PasswordAudit[] {
    if (this.locked || !this.key) return []
    const year = Date.now() - 365 * 24 * 60 * 60 * 1000
    const seen = new Map<string, number>()
    const read: Array<{ entry: VaultEntry; password: string }> = []
    for (const entry of this.store.get().entries) {
      if (entry.binned) continue
      try {
        const password = open(this.key, entry.secret, `${entry.origin}|${entry.username}`)
        read.push({ entry, password })
        seen.set(password, (seen.get(password) ?? 0) + 1)
      } catch {
        /* an entry sealed by a key that is gone cannot be judged */
      }
    }
    return read.map(({ entry, password }) => ({
      id: entry.id,
      origin: entry.origin,
      username: entry.username,
      verdict: judge(password),
      reused: (seen.get(password) ?? 1) > 1,
      old: entry.created < year
    }))
  }

  /**
   * Which of the saved passwords are already in somebody's list of stolen
   * ones. Only five characters of each hash leave this machine; see breach.ts
   * for why that is enough to ask and not enough to tell.
   */
  async stolen(): Promise<string[]> {
    if (this.locked || !this.key) return []
    const byPrefix = new Map<string, Array<{ id: string; suffix: string }>>()
    for (const entry of this.store.get().entries) {
      if (entry.binned) continue
      let password = ''
      try {
        password = open(this.key, entry.secret, `${entry.origin}|${entry.username}`)
      } catch {
        continue
      }
      const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
      const prefix = hash.slice(0, 5)
      const list = byPrefix.get(prefix) ?? []
      list.push({ id: entry.id, suffix: hash.slice(5) })
      byPrefix.set(prefix, list)
    }
    const found: string[] = []
    for (const [prefix, wanted] of byPrefix) {
      const stolen = await stolenWithPrefix(prefix)
      for (const item of wanted) if (stolen.has(item.suffix)) found.push(item.id)
    }
    return found
  }

  /**
   * Every password as text, for moving into another manager. The one moment
   * this vault gives everything up at once, so it is only ever reached from a
   * button somebody pressed.
   */
  exportCsv(): string | null {
    if (this.locked || !this.key) return null
    const rows = [['url', 'username', 'password', 'note']]
    for (const entry of this.store.get().entries) {
      if (entry.binned) continue
      let password = ''
      try {
        password = open(this.key, entry.secret, `${entry.origin}|${entry.username}`)
      } catch {
        continue
      }
      rows.push([`https://${entry.origin}`, entry.username, password, entry.note ?? ''])
    }
    return rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n')
  }

  /** The same shape back in: what Chrome, Bitwarden and the rest write out. */
  importCsv(text: string): number {
    if (this.locked || !this.key) return 0
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length < 2) return 0
    const cells = (line: string): string[] => {
      const out: string[] = []
      let cell = ''
      let quoted = false
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cell += '"'
            i += 1
          } else if (ch === '"') quoted = false
          else cell += ch
        } else if (ch === '"') quoted = true
        else if (ch === ',') {
          out.push(cell)
          cell = ''
        } else cell += ch
      }
      out.push(cell)
      return out
    }
    const head = cells(lines[0]).map((h) => h.trim().toLowerCase())
    const at = (names: string[]) => head.findIndex((h) => names.includes(h))
    const urlAt = at(['url', 'login_uri', 'website', 'site', 'origin'])
    const userAt = at(['username', 'login_username', 'user', 'login', 'email'])
    const passAt = at(['password', 'login_password', 'pass'])
    const noteAt = at(['note', 'notes', 'comment'])
    if (urlAt < 0 || passAt < 0) return 0
    let added = 0
    for (const line of lines.slice(1)) {
      const row = cells(line)
      const raw = (row[urlAt] ?? '').trim()
      const password = (row[passAt] ?? '').trim()
      if (!raw || !password) continue
      let host = raw
      try {
        host = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`).hostname
      } catch {
        continue
      }
      if (this.save(host, (row[userAt] ?? '').trim(), password, (row[noteAt] ?? '').trim() || undefined)) {
        added += 1
      }
    }
    return added
  }

  /**
   * The note beside a password: a recovery code, the answer to a security
   * question, which of three accounts this is. Sealed like the password,
   * because that is what people put in it.
   */
  setNote(id: string, text: string): boolean {
    if (this.locked) return false
    const file = this.store.get()
    if (!file.entries.some((e) => e.id === id)) return false
    const note = text.trim().slice(0, 4000)
    this.store.replace({
      ...file,
      entries: file.entries.map((e) => (e.id === id ? { ...e, note: note || undefined } : e))
    })
    this.store.flush()
    return true
  }

  /**
   * One file kept with an entry — the recovery-codes PDF a bank hands out, a
   * screenshot of a licence key. Half a megabyte is the cap: the whole vault
   * is read and rewritten as one file, so a large attachment would make every
   * save slow for the sake of one entry.
   */
  attach(id: string, name: string, dataUrl: string): boolean {
    if (this.locked || !this.key) return false
    const file = this.store.get()
    const entry = file.entries.find((e) => e.id === id)
    if (!entry) return false
    if (!/^data:[\w.+-]*\/?[\w.+-]*;base64,/.test(dataUrl)) return false
    const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
    if (size > 512 * 1024) return false
    const clean = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'file'
    this.store.replace({
      ...file,
      entries: file.entries.map((e) =>
        e.id === id
          ? { ...e, file: { name: clean, size }, blob: seal(this.key as Buffer, dataUrl, `blob|${id}`) }
          : e
      )
    })
    this.store.flush()
    return true
  }

  /** The attached file itself, as the data URL it went in as. */
  attachment(id: string): string | null {
    if (this.locked || !this.key) return null
    const entry = this.store.get().entries.find((e) => e.id === id)
    if (!entry?.blob) return null
    try {
      return open(this.key, entry.blob, `blob|${id}`)
    } catch {
      return null
    }
  }

  /** Takes the file away again. */
  detach(id: string): boolean {
    if (this.locked) return false
    const file = this.store.get()
    if (!file.entries.some((e) => e.id === id && e.file)) return false
    this.store.replace({
      ...file,
      entries: file.entries.map((e) =>
        e.id === id ? { ...e, file: undefined, blob: undefined } : e
      )
    })
    this.store.flush()
    return true
  }

  /**
   * Everything that matches a few typed letters, anywhere in the vault.
   *
   * This is what the offer over a login form uses when the password for this
   * site was saved under another name — a work account on a different
   * subdomain, a login shared with a sister site. It searches what is already
   * public inside the profile (hosts, usernames, labels) and never the
   * passwords.
   */
  search(query: string, limit = 20): Credential[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return this.list()
      .filter(
        (e) =>
          e.origin.toLowerCase().includes(q) ||
          e.username.toLowerCase().includes(q) ||
          (e.note ?? '').toLowerCase().includes(q)
      )
      .slice(0, limit)
  }

  /** Reveals one password. Callers must have a user action behind them. */
  reveal(id: string): string | null {
    if (this.locked || !this.key) return null
    const entry = this.store.get().entries.find((e) => e.id === id)
    if (!entry) return null
    try {
      return open(this.key, entry.secret, `${entry.origin}|${entry.username}`)
    } catch {
      return null
    }
  }

  remove(id: string): boolean {
    // A shut vault does not give its entries up and does not lose them either.
    // Reading one takes the key; deleting one took nothing at all, so anyone at
    // an unattended machine could throw away every password without ever
    // proving they were allowed to see one.
    if (this.locked) return false
    const file = this.store.get()
    const found = file.entries.find((e) => e.id === id)
    if (!found) return false
    // Thrown away, not gone: a password deleted by mistake is not recoverable
    // from anywhere else, so it waits thirty days first.
    const entries = file.entries.map((e) => (e.id === id ? { ...e, binned: Date.now() } : e))
    this.store.replace({ ...file, entries })
    this.store.flush()
    return true
  }

  /** Back out of the bin. */
  restore(id: string): boolean {
    if (this.locked) return false
    const file = this.store.get()
    const found = file.entries.find((e) => e.id === id && e.binned)
    if (!found) return false
    const entries = file.entries.map((e) =>
      e.id === id ? { ...e, binned: undefined, used: Date.now() } : e
    )
    this.store.replace({ ...file, entries })
    this.store.flush()
    return true
  }

  /**
   * Empties the bin: everything in it, or only what has waited long enough.
   * Called on load, so a forgotten bin does not keep passwords forever.
   */
  emptyBin(all = false): number {
    const file = this.store.get()
    const edge = Date.now() - 30 * 24 * 60 * 60 * 1000
    const entries = file.entries.filter((e) => !e.binned || (!all && e.binned > edge))
    const gone = file.entries.length - entries.length
    if (gone > 0) {
      this.store.replace({ ...file, entries })
      this.store.flush()
    }
    return gone
  }

  touch(id: string) {
    const file = this.store.get()
    this.store.replace({
      ...file,
      entries: file.entries.map((e) => (e.id === id ? { ...e, used: Date.now() } : e))
    })
  }

  /* --------------------------------------------------------------- cards */

  cards(): CardMeta[] {
    return this.store
      .get()
      .cards.map(({ secret: _secret, ...meta }) => meta)
      .sort((a, b) => b.used - a.used)
  }

  /**
   * Saves a card. The number is sealed under the card's own id, so a sealed
   * number cannot be moved onto another card's record; `cvc` is not a
   * parameter here and never will be.
   */
  saveCard(input: {
    id?: string
    label: string
    number: string
    holder: string
    month: number
    year: number
  }): boolean {
    if (this.locked || !this.key) return false
    const digits = input.number.replace(/\D/g, '')
    if (digits.length < 12 || digits.length > 19) return false
    const file = this.store.get()
    const existing = input.id ? file.cards.find((c) => c.id === input.id) : undefined
    const meta: CardMeta = {
      id: existing?.id ?? randomUUID(),
      label: input.label.slice(0, 60),
      brand: brandOf(digits),
      last4: digits.slice(-4),
      holder: input.holder.slice(0, 100),
      month: Math.min(12, Math.max(1, Math.round(input.month))),
      year: Math.min(2100, Math.max(2000, Math.round(input.year))),
      created: existing?.created ?? Date.now(),
      used: Date.now()
    }
    const entry: CardEntry = { ...meta, secret: seal(this.key, digits, `card|${meta.id}`) }
    const cards = existing
      ? file.cards.map((c) => (c.id === existing.id ? entry : c))
      : [...file.cards, entry]
    this.store.replace({ ...file, cards })
    this.store.flush()
    return true
  }

  /** The number of one card. Callers must have a user action behind them. */
  revealCard(id: string): string | null {
    if (this.locked || !this.key) return null
    const card = this.store.get().cards.find((c) => c.id === id)
    if (!card) return null
    try {
      return open(this.key, card.secret, `card|${card.id}`)
    } catch {
      return null
    }
  }

  removeCard(id: string): boolean {
    if (this.locked) return false
    const file = this.store.get()
    const cards = file.cards.filter((c) => c.id !== id)
    if (cards.length === file.cards.length) return false
    this.store.replace({ ...file, cards })
    this.store.flush()
    return true
  }

  touchCard(id: string) {
    const file = this.store.get()
    this.store.replace({
      ...file,
      cards: file.cards.map((c) => (c.id === id ? { ...c, used: Date.now() } : c))
    })
  }

  /* ----------------------------------------------------------- addresses */

  addresses(): AddressMeta[] {
    return this.store
      .get()
      .addresses.map(({ secret: _secret, ...meta }) => meta)
      .sort((a, b) => b.used - a.used)
  }

  saveAddress(input: { id?: string; label: string; fields: AddressFields }): boolean {
    if (this.locked || !this.key) return false
    const fields = cleanAddress(input.fields)
    const file = this.store.get()
    const existing = input.id ? file.addresses.find((a) => a.id === input.id) : undefined
    const meta: AddressMeta = {
      id: existing?.id ?? randomUUID(),
      label: input.label.slice(0, 60),
      city: fields.city,
      created: existing?.created ?? Date.now(),
      used: Date.now()
    }
    const entry: AddressEntry = {
      ...meta,
      secret: seal(this.key, JSON.stringify(fields), `address|${meta.id}`)
    }
    const addresses = existing
      ? file.addresses.map((a) => (a.id === existing.id ? entry : a))
      : [...file.addresses, entry]
    this.store.replace({ ...file, addresses })
    this.store.flush()
    return true
  }

  revealAddress(id: string): AddressFields | null {
    if (this.locked || !this.key) return null
    const address = this.store.get().addresses.find((a) => a.id === id)
    if (!address) return null
    try {
      return cleanAddress(JSON.parse(open(this.key, address.secret, `address|${address.id}`)))
    } catch {
      return null
    }
  }

  removeAddress(id: string): boolean {
    if (this.locked) return false
    const file = this.store.get()
    const addresses = file.addresses.filter((a) => a.id !== id)
    if (addresses.length === file.addresses.length) return false
    this.store.replace({ ...file, addresses })
    this.store.flush()
    return true
  }

  touchAddress(id: string) {
    const file = this.store.get()
    this.store.replace({
      ...file,
      addresses: file.addresses.map((a) => (a.id === id ? { ...a, used: Date.now() } : a))
    })
  }

  /** Generates a strong password: 20 chars from a 74-symbol alphabet ≈ 124 bits. */
  generate(length = 20): string {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?'
    const bytes = randomBytes(length * 2)
    let out = ''
    for (let i = 0; out.length < length && i < bytes.length; i++) {
      const value = bytes[i]
      // reject values that would bias the distribution
      if (value >= 256 - (256 % alphabet.length)) continue
      out += alphabet[value % alphabet.length]
    }
    return out
  }

  flush() {
    this.store.flush()
  }

  private decryptAll(): Array<{ meta: Credential; password: string }> | null {
    if (!this.key) return null
    const out: Array<{ meta: Credential; password: string }> = []
    for (const entry of this.store.get().entries) {
      try {
        const { secret, ...meta } = entry
        out.push({ meta, password: open(this.key, secret, `${entry.origin}|${entry.username}`) })
      } catch {
        return null
      }
    }
    return out
  }

  /**
   * The cards and addresses, opened with the key in force and sealed again
   * under a new one. Changing the master password rewrites the whole file, and
   * anything left behind would be sealed under a key that no longer exists —
   * which is losing it, quietly, at the moment somebody tightens their
   * security.
   */
  private resealRest(next: Buffer): { cards: CardEntry[]; addresses: AddressEntry[] } | null {
    if (!this.key) return null
    const file = this.store.get()
    try {
      const cards = file.cards.map((card) => ({
        ...card,
        secret: seal(next, open(this.key as Buffer, card.secret, `card|${card.id}`), `card|${card.id}`)
      }))
      const addresses = file.addresses.map((address) => ({
        ...address,
        secret: seal(
          next,
          open(this.key as Buffer, address.secret, `address|${address.id}`),
          `address|${address.id}`
        )
      }))
      return { cards, addresses }
    } catch {
      return null
    }
  }

  /** Used by the security self-test: proves the file on disk is not readable. */
  cipherSample(): { file: string; sample: string; mode: string } {
    const file = this.store.get()
    const first = file.entries[0]
    return {
      file: this.store.file,
      sample: first ? `${first.secret.iv}.${first.secret.data.slice(0, 24)}…` : '',
      mode: file.mode
    }
  }
}

/**
 * Which card this is, by the digits it starts with. Only for the icon and
 * for telling two cards apart in a list — nothing is decided by it.
 */
export function brandOf(digits: string): string {
  if (/^4/.test(digits)) return 'visa'
  if (/^220[0-4]/.test(digits)) return 'mir'
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^35/.test(digits)) return 'jcb'
  if (/^62/.test(digits)) return 'unionpay'
  if (/^6(011|5)/.test(digits)) return 'discover'
  return ''
}

/**
 * The Luhn check every card number satisfies. It catches a typed digit that
 * is wrong; it says nothing about whether a card exists, and nothing is
 * refused because of it — the person may know better than we do.
 */
export function looksLikeCard(digits: string): boolean {
  if (digits.length < 12 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (n < 0 || n > 9) return false
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }
  return sum % 10 === 0
}

/** Every field a string, every string trimmed and bounded. */
function cleanAddress(fields: Partial<AddressFields> | null): AddressFields {
  const text = (value: unknown, max = 120) => String(value ?? '').trim().slice(0, max)
  return {
    name: text(fields?.name),
    phone: text(fields?.phone, 40),
    email: text(fields?.email),
    country: text(fields?.country, 80),
    region: text(fields?.region, 80),
    city: text(fields?.city, 80),
    street: text(fields?.street, 200),
    house: text(fields?.house, 40),
    flat: text(fields?.flat, 40),
    postcode: text(fields?.postcode, 20)
  }
}

export function constantTimeEqual(a: string, b: string) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export const vault = new Vault()
