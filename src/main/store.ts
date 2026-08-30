import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Durable JSON store.
 *
 * Every save is a transaction: the payload is written to a temp file, flushed to
 * the physical disk with fsync, and only then renamed over the real file — a
 * rename is atomic, so a crash or a kill can never leave a half-written file.
 * The previous version is kept as `<name>.bak`, and a corrupt main file falls
 * back to it instead of silently resetting the user's data.
 *
 * A `version` field is stored alongside the data so future format changes can
 * migrate old files instead of throwing them away.
 */
export class JsonStore<T> {
  private path = ''
  private backup = ''
  private cache: T
  private dirty = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly fileName: string,
    private readonly defaults: () => T,
    private readonly version: number,
    private readonly migrate: (data: unknown, fromVersion: number) => Partial<T> = (d) => d as Partial<T>,
    private readonly sanitize: (data: Partial<T>) => T = (d) => d as T
  ) {
    this.cache = this.sanitize(this.defaults() as Partial<T>)
  }

  /** Points the store at a directory and loads what is there. */
  open(dir: string): T {
    this.flush()
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, this.fileName)
    this.backup = this.path + '.bak'
    const existed = existsSync(this.path) || existsSync(this.backup)
    this.cache = this.sanitize(this.read())
    // A store that had no file yet must persist its defaults immediately —
    // otherwise state created on first run (e.g. the initial profile) would
    // evaporate on restart and the app would start from scratch every time.
    if (!existed) {
      this.dirty = true
      this.flush()
    }
    return this.cache
  }

  get(): T {
    return this.cache
  }

  set(next: Partial<T>): T {
    this.cache = this.sanitize({ ...(this.cache as object), ...(next as object) } as Partial<T>)
    this.dirty = true
    this.schedule()
    return this.cache
  }

  replace(next: T): T {
    this.cache = this.sanitize(next as Partial<T>)
    this.dirty = true
    this.schedule()
    return this.cache
  }

  reset(): T {
    this.cache = this.sanitize(this.defaults() as Partial<T>)
    this.dirty = true
    this.flush()
    return this.cache
  }

  /** Reads the main file, falling back to the backup when it is unreadable. */
  private read(): Partial<T> {
    for (const file of [this.path, this.backup]) {
      if (!file || !existsSync(file)) continue
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        const version = typeof raw?.version === 'number' ? raw.version : 0
        const payload = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw
        return version === this.version ? (payload as Partial<T>) : this.migrate(payload, version)
      } catch {
        // try the backup next
      }
    }
    return this.defaults() as Partial<T>
  }

  private schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 150)
  }

  /** Writes pending changes through to disk. Safe to call at any time. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty || !this.path) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const body = JSON.stringify({ version: this.version, data: this.cache })
      const tmp = this.path + '.tmp'

      const fd = openSync(tmp, 'w')
      try {
        writeSync(fd, body, 0, 'utf8')
        fsyncSync(fd) // the bytes must be on the platter before the rename
      } finally {
        closeSync(fd)
      }

      if (existsSync(this.path)) {
        try {
          if (existsSync(this.backup)) unlinkSync(this.backup)
          renameSync(this.path, this.backup)
        } catch {
          // a missing backup is not fatal
        }
      }
      renameSync(tmp, this.path)
      this.dirty = false
    } catch {
      // keep the change in memory; the next flush will retry
    }
  }

  get file() {
    return this.path
  }

  get hasUnsaved() {
    return this.dirty
  }
}

const stores: Array<JsonStore<unknown>> = []

/** Registers a store so every exit path can flush it. */
export function track<T>(store: JsonStore<T>): JsonStore<T> {
  stores.push(store as JsonStore<unknown>)
  return store
}

export function flushAll() {
  for (const store of stores) store.flush()
}

/**
 * Flush on every way the process can end, including SIGTERM and a plain
 * `exit` — the only case that can still lose data is a hard power cut, and even
 * then the previous version survives in the backup file.
 */
export function installExitHooks() {
  const done = new Set<string>()
  const hook = (event: string, exit = false) => {
    process.on(event as 'exit', () => {
      if (done.has(event)) return
      done.add(event)
      flushAll()
      if (exit) process.exit(0)
    })
  }
  hook('exit')
  hook('SIGINT', true)
  hook('SIGTERM', true)
  hook('SIGHUP', true)
}
