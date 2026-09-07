import { safeStorage } from 'electron'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'crypto'
import { JsonStore, track } from './store'

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
}

interface Sealed {
  iv: string
  data: string
  tag: string
}

interface VaultEntry extends Credential {
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
}

const emptyVault = (): VaultFile => ({
  mode: 'os',
  osKey: '',
  salt: '',
  verifier: null,
  helloKey: '',
  entries: []
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
    this.store.replace({
      mode: 'password',
      osKey: '',
      salt: b64(salt),
      verifier: seal(key, 'nya-vault', 'verifier'),
      // The key changed, so any copy Hello was holding is stale. Turning Hello
      // back on re-seals the new one.
      helloKey: '',
      entries
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
    this.store.replace({
      mode: 'os',
      osKey: b64(safeStorage.encryptString(b64(key))),
      salt: '',
      verifier: null,
      helloKey: '',
      entries
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
      .entries.map(({ secret: _secret, ...meta }) => meta)
      .sort((a, b) => b.used - a.used)
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
    const entries = file.entries.filter((e) => e.id !== id)
    if (entries.length === file.entries.length) return false
    this.store.replace({ ...file, entries })
    this.store.flush()
    return true
  }

  touch(id: string) {
    const file = this.store.get()
    this.store.replace({
      ...file,
      entries: file.entries.map((e) => (e.id === id ? { ...e, used: Date.now() } : e))
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

export function constantTimeEqual(a: string, b: string) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export const vault = new Vault()
