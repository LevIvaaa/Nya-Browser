import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { settings } from './settings'
import { bookmarks } from './bookmarks'
import { history } from './history'
import { sites } from './sites'
import { vault } from './vault'
import type { BackupCounts } from '../shared/types'

/**
 * The whole profile in one file, locked with one password.
 *
 * This is the answer to the only question that could not be answered before:
 * what happens to everything when Windows is reinstalled. Passwords, cards,
 * addresses, bookmarks, history, settings and per-site rules go into a single
 * sealed file that means nothing without the password, and come back out into
 * a fresh profile.
 *
 * Deliberately not a folder copy. A copy of the profile folder carries the
 * machine's own key with it — on Windows the vault is sealed by the account,
 * and the copy would open on this machine and nowhere else, which is the
 * opposite of a backup.
 */
const MAGIC = 'nya-backup'
const VERSION = 1
const KEY_LEN = 32
const IV_LEN = 12
const SCRYPT = { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

export interface BackupFile {
  magic: string
  version: number
  made: number
  salt: string
  iv: string
  tag: string
  data: string
}



interface Body {
  settings: unknown
  bookmarks: unknown
  history: unknown
  sites: unknown
  passwords: Array<{ origin: string; username: string; password: string; note?: string }>
  cards: Array<{ label: string; number: string; holder: string; month: number; year: number }>
  addresses: Array<{ label: string; fields: unknown }>
}

const b64 = (b: Buffer) => b.toString('base64')
const unb64 = (s: string) => Buffer.from(s, 'base64')

/** Everything worth carrying, as plain objects, before it is sealed. */
function gather(withSecrets: boolean): { body: Body; counts: BackupCounts } {
  const passwords: Body['passwords'] = []
  const cards: Body['cards'] = []
  const addresses: Body['addresses'] = []

  // The vault is only readable while it is open. A locked vault does not stop
  // the backup — bookmarks and settings are still worth keeping — but it is
  // said out loud in the counts, so nobody discovers it a year later.
  if (withSecrets && !vault.locked) {
    for (const entry of vault.list()) {
      const password = vault.reveal(entry.id)
      if (password === null) continue
      passwords.push({
        origin: entry.origin,
        username: entry.username,
        password,
        note: entry.note
      })
    }
    for (const card of vault.cards()) {
      const number = vault.revealCard(card.id)
      if (number === null) continue
      cards.push({
        label: card.label,
        number,
        holder: card.holder,
        month: card.month,
        year: card.year
      })
    }
    for (const address of vault.addresses()) {
      const fields = vault.revealAddress(address.id)
      if (fields === null) continue
      addresses.push({ label: address.label, fields })
    }
  }

  const entries = history.all().slice(0, 5000)
  const rules = sites.all()
  const body: Body = {
    settings: settings.get(),
    bookmarks: bookmarks.all(),
    history: entries,
    sites: rules,
    passwords,
    cards,
    addresses
  }
  return {
    body,
    counts: {
      passwords: passwords.length,
      cards: cards.length,
      addresses: addresses.length,
      bookmarks: (body.bookmarks as unknown[]).length,
      history: entries.length,
      sites: rules.length
    }
  }
}

/** The file itself: scrypt from the password, AES-256-GCM over the body. */
export function makeBackup(password: string): { file: BackupFile; counts: BackupCounts } | null {
  if (password.length < 4) return null
  const { body, counts } = gather(true)
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(`${MAGIC}|${VERSION}`, 'utf8'))
  const data = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()])
  return {
    file: {
      magic: MAGIC,
      version: VERSION,
      made: Date.now(),
      salt: b64(salt),
      iv: b64(iv),
      tag: b64(cipher.getAuthTag()),
      data: b64(data)
    },
    counts
  }
}

/** Reads a backup back. A wrong password fails here and changes nothing. */
export function readBackup(file: unknown, password: string): Body | null {
  const raw = file as Partial<BackupFile> | null
  if (!raw || raw.magic !== MAGIC || typeof raw.data !== 'string') return null
  if (typeof raw.salt !== 'string' || typeof raw.iv !== 'string' || typeof raw.tag !== 'string') return null
  try {
    const key = scryptSync(password, unb64(raw.salt), KEY_LEN, SCRYPT)
    const decipher = createDecipheriv('aes-256-gcm', key, unb64(raw.iv), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(`${MAGIC}|${raw.version ?? VERSION}`, 'utf8'))
    decipher.setAuthTag(unb64(raw.tag))
    const plain = Buffer.concat([decipher.update(unb64(raw.data)), decipher.final()]).toString('utf8')
    const body = JSON.parse(plain) as Body
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/**
 * Puts a backup back into this profile.
 *
 * Adds rather than replaces: a bookmark that is already here stays once, a
 * password for a site that already has one is written over. The settings are
 * applied whole, because half-applied settings are a broken browser.
 */
export function applyBackup(body: Body): BackupCounts {
  const counts: BackupCounts = {
    passwords: 0,
    cards: 0,
    addresses: 0,
    bookmarks: 0,
    history: 0,
    sites: 0
  }

  if (body.settings && typeof body.settings === 'object') {
    settings.patch(body.settings as Record<string, never>)
  }

  if (Array.isArray(body.bookmarks)) {
    const here = new Set(bookmarks.all().map((b) => b.url))
    for (const raw of body.bookmarks as Array<Record<string, unknown>>) {
      const url = String(raw?.url ?? '')
      if (!/^https?:\/\//i.test(url) || here.has(url)) continue
      const added = bookmarks.add({
        title: String(raw.title ?? url),
        url,
        folder: typeof raw.folder === 'string' ? raw.folder : undefined,
        pinned: raw.pinned === true
      })
      if (added) counts.bookmarks += 1
    }
  }

  if (Array.isArray(body.history)) {
    for (const raw of body.history as Array<Record<string, unknown>>) {
      const url = String(raw?.url ?? '')
      if (!/^https?:\/\//i.test(url)) continue
      history.record(url, String(raw.title ?? ''))
      counts.history += 1
    }
  }

  if (Array.isArray(body.sites)) {
    for (const raw of body.sites as Array<{ host?: unknown; rules?: unknown }>) {
      const host = String(raw?.host ?? '')
      if (!host || !raw.rules || typeof raw.rules !== 'object') continue
      sites.set(host, raw.rules as Record<string, never>)
      counts.sites += 1
    }
  }

  if (!vault.locked) {
    for (const entry of body.passwords ?? []) {
      if (!entry?.origin || !entry?.password) continue
      if (vault.save(entry.origin, entry.username ?? '', entry.password, entry.note)) counts.passwords += 1
    }
    for (const card of body.cards ?? []) {
      if (!card?.number) continue
      if (
        vault.saveCard({
          label: card.label ?? '',
          number: card.number,
          holder: card.holder ?? '',
          month: Number(card.month) || 1,
          year: Number(card.year) || 2030
        })
      ) {
        counts.cards += 1
      }
    }
    for (const address of body.addresses ?? []) {
      if (!address?.fields) continue
      if (vault.saveAddress({ label: address.label ?? '', fields: address.fields as never })) {
        counts.addresses += 1
      }
    }
  }

  return counts
}
