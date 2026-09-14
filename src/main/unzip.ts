import { inflateRawSync } from 'zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, normalize, sep } from 'path'

/**
 * Opening a zip file, without a dependency for it.
 *
 * A zip is a list of files with a table of contents at the end, and the only
 * compression anything in the wild uses is deflate, which Node already has.
 * That is the whole format as far as this is concerned: read the table, walk
 * it, inflate each entry. Anything else — encryption, zip64, a method nobody
 * uses — is refused rather than half-supported.
 *
 * The part that matters for safety is the path. An entry is allowed to name a
 * file underneath the folder it is being unpacked into and nothing else: not
 * `..`, not an absolute path, not a drive letter. That is the whole of the
 * "zip slip" family of bugs, and it is checked on every single entry.
 */

/** The table of contents lives at the end, behind a signature. */
const END = 0x06054b50
const CENTRAL = 0x02014b50

export interface ZipEntry {
  name: string
  size: number
  method: number
  offset: number
  flags: number
}

/** Reads the table of contents. Returns null when this is not a zip at all. */
export function readIndex(buffer: Buffer): ZipEntry[] | null {
  // The end record is at most 22 bytes plus a comment of up to 64 KiB.
  const from = Math.max(0, buffer.length - 22 - 0xffff)
  let end = -1
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === END) {
      end = i
      break
    }
  }
  if (end < 0) return null
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL) return null
    const flags = buffer.readUInt16LE(at + 8)
    const method = buffer.readUInt16LE(at + 10)
    const size = buffer.readUInt32LE(at + 24)
    const nameLen = buffer.readUInt16LE(at + 28)
    const extraLen = buffer.readUInt16LE(at + 30)
    const commentLen = buffer.readUInt16LE(at + 32)
    const offset = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLen)
    entries.push({ name, size, method, offset, flags })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * Where an entry is allowed to land. Returns null for anything that tries to
 * leave the folder — which is the only interesting thing a zip can try to do.
 */
export function safeJoin(root: string, name: string): string | null {
  if (!name || name.includes('\0')) return null
  const cleaned = name.replace(/\\/g, '/')
  if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) return null
  if (cleaned.split('/').some((part) => part === '..')) return null
  const full = normalize(join(root, cleaned))
  const base = normalize(root.endsWith(sep) ? root : root + sep)
  return full.startsWith(base) ? full : null
}

export interface Unpacked {
  files: number
  bytes: number
}

/** How much a zip is allowed to become; past this it is a decompression bomb. */
const MAX_TOTAL = 2 * 1024 * 1024 * 1024
const MAX_FILES = 5000

/**
 * Unpacks a zip into a folder. Returns what it wrote, or null when the file is
 * not a plain, unencrypted, deflate-or-stored zip.
 */
export function unzip(file: string, into: string): Unpacked | null {
  let buffer: Buffer
  try {
    buffer = readFileSync(file)
  } catch {
    return null
  }
  const index = readIndex(buffer)
  if (!index || index.length === 0 || index.length > MAX_FILES) return null
  // Bit 0 of the flags is "encrypted", and there is nothing to be done here
  // about a password nobody has asked for.
  if (index.some((entry) => (entry.flags & 0x1) !== 0)) return null
  if (index.some((entry) => entry.method !== 0 && entry.method !== 8)) return null
  if (index.reduce((sum, entry) => sum + entry.size, 0) > MAX_TOTAL) return null

  let files = 0
  let bytes = 0
  for (const entry of index) {
    const where = safeJoin(into, entry.name)
    if (!where) return null
    if (entry.name.endsWith('/')) {
      try {
        mkdirSync(where, { recursive: true })
      } catch {
        return null
      }
      continue
    }
    // The local header repeats the name and extra length, and only those two
    // numbers are trustworthy for finding where the bytes start.
    const at = entry.offset
    if (at + 30 > buffer.length) return null
    const nameLen = buffer.readUInt16LE(at + 26)
    const extraLen = buffer.readUInt16LE(at + 28)
    const start = at + 30 + nameLen + extraLen
    const raw = buffer.subarray(start, buffer.length)
    let data: Buffer
    try {
      data = entry.method === 0 ? raw.subarray(0, entry.size) : inflateRawSync(raw)
    } catch {
      return null
    }
    if (data.length !== entry.size) data = data.subarray(0, entry.size)
    try {
      mkdirSync(dirname(where), { recursive: true })
      writeFileSync(where, data)
    } catch {
      return null
    }
    files += 1
    bytes += data.length
  }
  return { files, bytes }
}
