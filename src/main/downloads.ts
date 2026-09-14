import {
  app,
  dialog,
  shell,
  type DownloadItem as ElectronDownload,
  type Session,
  type WebContents
} from 'electron'
import { createHash, randomUUID } from 'crypto'
import { createReadStream, statSync } from 'fs'
import { statfs } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { settings } from './settings'
import { JsonStore, track } from './store'
import { unzip } from './unzip'
import type { DownloadItem } from '../shared/types'

type Emit = (items: DownloadItem[]) => void

/**
 * Downloads, and everything that happens around them.
 *
 * The engine underneath is Chromium's: it knows about redirects, cookies,
 * content-disposition and resuming an interrupted transfer, and none of that
 * is worth rewriting. What is added here is the part Chromium leaves out —
 * a queue, a speed limit, a file that survives a restart half-finished, a
 * checksum, and the rules a person wants applied to a filename.
 *
 * The speed limit is honest about what it is. There is no throttle in the API,
 * so what happens instead is an allowance: from the moment the ceiling applies,
 * the transfer is entitled to so many bytes a second, and it is paused whenever
 * it has taken more than that. Over a minute the average is the number that was
 * asked for. Over the first second it is not — Chromium reads ahead, and on a
 * fast link a burst has already arrived before the first pause can land. For
 * the purpose people want this for, which is leaving a large file to download
 * without losing a video call, that is the right trade.
 */

/** What is written down about a download so it can outlive the window. */
interface Record {
  id: string
  name: string
  url: string
  path: string
  received: number
  total: number
  state: DownloadItem['state']
  startedAt: number
  finishedAt?: number
  /** the page it was started from */
  source?: string
  /** sha-256 of the finished file, lower case hex */
  hash?: string
  /** what Chromium needs to pick an interrupted transfer back up */
  chain?: string[]
  etag?: string
  modified?: string
  mime?: string
}

interface DownloadData {
  items: Record[]
}

/** Two hundred rows is a year of ordinary use and a small file. */
const KEEP = 200
/** How often the limiter looks at what each transfer is doing. */
const TICK_MS = 250
/**
 * How long a click counts for. Three seconds covers the ordinary case — a
 * button pressed, a redirect, a file — and does not cover a page that waits
 * and then helps itself.
 */
const GESTURE_MS = 3000

function sanitize(data: Partial<DownloadData>): DownloadData {
  const items: Record[] = []
  for (const value of Array.isArray(data.items) ? data.items : []) {
    const row = value as Partial<Record>
    if (!row || typeof row.id !== 'string' || typeof row.url !== 'string') continue
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
    const states: DownloadItem['state'][] = [
      'progressing',
      'paused',
      'queued',
      'completed',
      'cancelled',
      'interrupted'
    ]
    const state = states.includes(row.state as DownloadItem['state'])
      ? (row.state as DownloadItem['state'])
      : 'interrupted'
    items.push({
      id: row.id.slice(0, 64),
      name: String(row.name ?? '').slice(0, 300),
      url: row.url.slice(0, 4000),
      path: String(row.path ?? '').slice(0, 1000),
      received: num(row.received),
      total: num(row.total),
      // Nothing is still running when it is read back off the disk.
      state: state === 'progressing' || state === 'paused' || state === 'queued' ? 'interrupted' : state,
      startedAt: num(row.startedAt),
      finishedAt: row.finishedAt ? num(row.finishedAt) : undefined,
      source: typeof row.source === 'string' ? row.source.slice(0, 4000) : undefined,
      hash: typeof row.hash === 'string' && /^[0-9a-f]{64}$/.test(row.hash) ? row.hash : undefined,
      chain: Array.isArray(row.chain)
        ? row.chain.filter((u) => typeof u === 'string').slice(0, 10).map((u) => u.slice(0, 4000))
        : undefined,
      etag: typeof row.etag === 'string' ? row.etag.slice(0, 200) : undefined,
      modified: typeof row.modified === 'string' ? row.modified.slice(0, 200) : undefined,
      mime: typeof row.mime === 'string' ? row.mime.slice(0, 200) : undefined
    })
  }
  return { items: items.slice(0, KEEP) }
}

/**
 * A name the way the person asked for it. Tokens rather than a language:
 * {name} {ext} {host} {date} {time} — anything else is left as typed, so a
 * rule with no tokens in it simply is not a rule.
 */
export function applyRule(rule: string, name: string, url: string, when = new Date()): string {
  if (!rule.trim()) return name
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* a download with no address keeps an empty host */
  }
  const two = (n: number) => String(n).padStart(2, '0')
  const date = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`
  const time = `${two(when.getHours())}-${two(when.getMinutes())}`
  const out = rule
    .replace(/\{name\}/g, stem)
    .replace(/\{ext\}/g, ext.replace(/^\./, ''))
    .replace(/\{host\}/g, host)
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    // A rule that forgets the extension gets it back: a file Windows cannot
    // open is not what anybody meant by "rename".
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  if (!out) return name
  return ext && !out.toLowerCase().endsWith(ext.toLowerCase()) ? out + ext : out
}

/** example.zip → example (2).zip, and so on, without asking the filesystem. */
function uniqueName(dir: string, name: string, taken: Set<string>): string {
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  let n = 1
  while (taken.has(join(dir, candidate).toLowerCase())) {
    n += 1
    candidate = `${stem} (${n})${ext}`
  }
  return candidate
}

class Downloads {
  private handles = new Map<string, ElectronDownload>()
  private emit: Emit = () => {}
  /**
   * The last few seconds of each transfer, for the number on screen.
   *
   * A speed worked out from one quarter-second is a number that jumps around
   * and is never the one people mean. Worse, a transfer the limiter is
   * holding would read as zero for seconds at a time, which looks broken
   * rather than limited. Four seconds of samples is what "how fast is this
   * going" actually means.
   */
  private samples = new Map<string, Array<{ at: number; bytes: number }>>()
  /** per download, bytes a second; 0 means whatever the line will give */
  private limits = new Map<string, number>()
  /** held back until this moment */
  private later = new Map<string, number>()
  /** paused by the limiter rather than by a person */
  private throttled = new Set<string>()
  /** where each limited transfer's allowance is measured from */
  private meters = new Map<string, { since: number; base: number }>()
  /** waiting for a free slot rather than for anything else */
  private queued = new Set<string>()
  /** the page each transfer was started from */
  private from = new Map<string, string>()
  /** the half-written file the next will-download is meant to carry on */
  private resuming: { path: string; from: number } | null = null
  /** when each view was last touched by a person */
  private gestures = new Map<number, number>()
  /** started by the page, not by anybody, and waiting to be allowed */
  private unasked = new Set<string>()
  private ses: Session | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private store = track(
    new JsonStore<DownloadData>(
      'downloads.json',
      () => ({ items: [] }),
      1,
      (d) => d as Partial<DownloadData>,
      sanitize
    )
  )
  /** live rows, newest first; the store holds the same rows for next time */
  private items = new Map<string, Record>()

  onChange(emit: Emit) {
    this.emit = emit
  }

  load(dir: string) {
    this.store.open(dir)
    this.items = new Map(this.store.get().items.map((row) => [row.id, row]))
    this.publish()
  }

  attach(ses: Session) {
    this.ses = ses
    ses.removeAllListeners('will-download')
    ses.on('will-download', (_event, item, wc) => void this.track(item, wc))
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  /**
   * A page reported that somebody touched it. Kept per view, because the
   * question a download has to answer is "did anyone ask for this" — and the
   * only evidence of that is a click or a key in the page that started it.
   */
  noteGesture(wcId: number) {
    this.gestures.set(wcId, Date.now())
  }

  /** Let through a download the page started by itself. */
  allow(id: string) {
    const row = this.items.get(id)
    const handle = this.handles.get(id)
    if (!row || !handle) return
    this.unasked.delete(id)
    this.admit(id, handle)
    this.publish()
  }

  /** The page a download is about to be started from, for the record. */
  noteSource(url: string) {
    this.from.set('next', url)
  }

  private async track(item: ElectronDownload, wc?: WebContents) {
    const id = randomUUID()
    const s = settings.get()
    // Nobody touched the page this came from: it was not asked for.
    const touched = wc ? this.gestures.get(wc.id) ?? 0 : Date.now()
    const unasked = s.downloadAsk && Date.now() - touched > GESTURE_MS
    // The page it came from, for the list to say later where a file was found.
    let where = this.from.get('next') ?? ''
    if (!where && wc && !wc.isDestroyed()) {
      try {
        const url = wc.getURL()
        if (/^https?:/i.test(url)) where = url
      } catch {
        /* a view that has gone has no address to give */
      }
    }

    /*
     * Where it goes, and under what name.
     *
     * A transfer being resumed goes back to its own half-written file, and
     * nothing here may touch that: a new name would mean a new file and the
     * bytes already on disk would be downloaded again. Chromium does not set
     * the path on the item before this fires, so the browser has to remember
     * which file it just asked to be picked up.
     */
    const carryOn = this.resuming
    this.resuming = null
    if (carryOn) {
      item.setSavePath(carryOn.path)
    } else if (!s.askWhereToSave && s.downloadDir && !item.getSavePath()) {
      const taken = new Set(
        [...this.items.values()].filter((row) => row.path).map((row) => row.path.toLowerCase())
      )
      const named = applyRule(s.downloadNameRule, item.getFilename(), item.getURL())
      item.setSavePath(join(s.downloadDir, uniqueName(s.downloadDir, named, taken)))
    }

    const row: Record = {
      id,
      name: basename(item.getSavePath()) || item.getFilename(),
      url: item.getURL(),
      path: item.getSavePath(),
      received: item.getReceivedBytes(),
      total: item.getTotalBytes(),
      state: 'progressing',
      startedAt: (item.getStartTime() || Date.now() / 1000) * 1000,
      source: where || undefined,
      chain: item.getURLChain(),
      etag: item.getETag() || undefined,
      modified: item.getLastModifiedTime() || undefined,
      mime: item.getMimeType() || undefined
    }
    this.from.delete('next')
    this.handles.set(id, item)
    this.items.set(id, row)
    // Before anything else, and before the first await: a transfer that
    // finishes while this method is still deciding what to do about it must
    // still be heard, or the row stays "downloading" over a finished file.
    this.watch(id, item)

    // Room on the disk, before a gigabyte is poured onto a full one.
    const free = await this.freeSpace(dirname(item.getSavePath()))
    if (free !== null && row.total > 0 && row.total > free) {
      item.cancel()
      this.items.set(id, { ...row, state: 'cancelled' })
      this.publish()
      this.emitNoRoom(row.name)
      return
    }

    // Started by the page rather than by a person: held, and said out loud.
    if (unasked) {
      item.pause()
      this.unasked.add(id)
      this.items.set(id, { ...row, state: 'paused' })
      this.publish()
      return
    }

    this.admit(id, item)
    this.publish()
  }

  /**
   * A slot, or a place in the queue. Counting the ones already moving rather
   * than the ones that exist: a paused download is not using the line.
   */
  private admit(id: string, item: ElectronDownload) {
    const row = this.items.get(id)
    if (!row) return
    if (this.running(id) >= Math.max(1, settings.get().downloadAtOnce)) {
      item.pause()
      this.queued.add(id)
      this.items.set(id, { ...row, state: 'queued' })
    } else {
      this.queued.delete(id)
      if (item.isPaused()) item.resume()
      this.items.set(id, { ...row, state: this.stateOf(id, item) })
    }
  }

  /** Everything this transfer will say from now until it is finished. */
  private watch(id: string, item: ElectronDownload) {
    item.on('updated', () => {
      const current = this.items.get(id)
      if (!current) return
      this.items.set(id, {
        ...current,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        path: item.getSavePath(),
        state: this.stateOf(id, item),
        chain: item.getURLChain(),
        etag: item.getETag() || current.etag,
        modified: item.getLastModifiedTime() || current.modified
      })
      this.publish()
    })

    item.once('done', (_event, state) => {
      const current = this.items.get(id)
      this.handles.delete(id)
      this.samples.delete(id)
      this.throttled.delete(id)
      this.queued.delete(id)
      this.limits.delete(id)
      this.unasked.delete(id)
      this.meters.delete(id)
      if (current) {
        this.items.set(id, {
          ...current,
          received: item.getReceivedBytes(),
          total: item.getTotalBytes(),
          path: item.getSavePath(),
          state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted',
          finishedAt: Date.now()
        })
      }
      this.publish()
      this.save()
      this.next()
      if (state === 'completed') void this.finish(id)
    })
  }

  /** What a live transfer is doing, in the words the list uses. */
  private stateOf(id: string, item: ElectronDownload): DownloadItem['state'] {
    if (item.getState() !== 'progressing') return item.getState()
    if (this.queued.has(id)) return 'queued'
    // A pause the limiter put there is not a pause the person asked for, and
    // showing it as one makes the button look broken.
    if (item.isPaused() && this.throttled.has(id)) return 'progressing'
    return item.isPaused() ? 'paused' : 'progressing'
  }

  /**
   * Transfers actually moving right now, not counting one of them.
   *
   * The exception is the point: the question is always "is there room for
   * this one", and whether this one happens to be moving already while the
   * answer is being worked out must not change it.
   */
  private running(except?: string): number {
    let n = 0
    for (const [id, item] of this.handles) {
      if (id === except) continue
      if (item.getState() !== 'progressing') continue
      if (this.queued.has(id) || this.later.has(id) || this.unasked.has(id)) continue
      if (item.isPaused() && !this.throttled.has(id)) continue
      n += 1
    }
    return n
  }

  /**
   * Every quarter second: hold back anything running over its budget, let go
   * of anything that has come back under it, and start whatever was waiting
   * for a time that has now come.
   */
  private tick() {
    const now = Date.now()
    let changed = false

    for (const [id, at] of this.later) {
      if (at > now) continue
      this.later.delete(id)
      this.queued.add(id)
      changed = true
    }

    const global = Math.max(0, settings.get().downloadLimit) * 1024
    const moving = [...this.handles.entries()].filter(
      ([id, item]) =>
        item.getState() === 'progressing' && !this.queued.has(id) && !this.later.has(id) && !this.unasked.has(id)
    )
    const share = global > 0 && moving.length > 0 ? global / moving.length : 0

    for (const [id, item] of moving) {
      const row = this.items.get(id)
      if (!row) continue
      const budget = this.limits.get(id) || share
      const received = item.getReceivedBytes()
      const at = Date.now()

      if (budget > 0) {
        /*
         * A budget, not a speedometer.
         *
         * The first version of this compared the last quarter-second's speed
         * against the ceiling and paused when it was over — which gives a
         * duty cycle of about half whatever the line can do, and no relation
         * at all to the number that was asked for.
         *
         * This one keeps an allowance instead: from the moment limiting
         * began, the transfer is entitled to budget × seconds, and is held
         * whenever it has taken more than that. What it actually averages is
         * then the budget, because that is the only rate at which the
         * allowance and the file grow together.
         */
        const meter = this.meters.get(id) ?? { since: at, base: received }
        if (!this.meters.has(id)) this.meters.set(id, meter)
        let allowed = meter.base + (budget * (at - meter.since)) / 1000
        /*
         * A very large head start is not a debt.
         *
         * Chromium reads ahead, so on a fast link tens of megabytes can land
         * before the first pause takes effect. Paying that back at the budget
         * rate would freeze the transfer for minutes and read as broken. So
         * once — and only once it is absurdly far ahead — the allowance is
         * re-based: what has arrived has arrived, and the ceiling applies from
         * there on.
         *
         * The threshold has to be well above an ordinary read-ahead burst, or
         * every burst re-bases and there is no limit at all. Sixteen megabytes
         * is far more than Chromium buffers in the ordinary case and far less
         * than the head start a local server can give it.
         */
        if (received - allowed > Math.max(budget * 30, 16 * 1024 * 1024)) {
          meter.since = at
          meter.base = received
          allowed = received
        }
        if (received > allowed && !item.isPaused()) {
          item.pause()
          this.throttled.add(id)
          changed = true
        } else if (received <= allowed && item.isPaused() && this.throttled.has(id)) {
          item.resume()
          this.throttled.delete(id)
          changed = true
        }
      } else if (this.meters.has(id)) {
        // The ceiling was lifted: let it go and forget the allowance.
        this.meters.delete(id)
        if (item.isPaused() && this.throttled.has(id)) {
          item.resume()
          this.throttled.delete(id)
          changed = true
        }
      }

      this.items.set(id, { ...row, received })
      this.note(id, at, received)
    }

    // A paused-by-the-limiter transfer never sends 'updated', so the clock has
    // to be what moves the numbers on screen.
    if (this.throttled.size > 0 || changed) this.publish()
    this.next()

    // And on disk every few seconds, so a crash costs seconds of a download
    // rather than all of it.
    if (moving.length > 0 && now - this.savedAt > 5000) {
      this.savedAt = now
      this.save()
      this.store.flush()
    }
  }

  /** Lets the next queued transfer through if there is room for it. */
  private next() {
    const room = Math.max(1, settings.get().downloadAtOnce) - this.running()
    if (room <= 0 || this.queued.size === 0) return
    const waiting = [...this.queued]
      .map((id) => ({ id, row: this.items.get(id) }))
      .filter((x) => x.row)
      .sort((a, b) => (a.row as Record).startedAt - (b.row as Record).startedAt)
    for (const { id } of waiting.slice(0, room)) {
      const item = this.handles.get(id)
      if (!item) {
        this.queued.delete(id)
        continue
      }
      this.queued.delete(id)
      if (item.isPaused()) item.resume()
    }
    this.publish()
  }

  /** One more reading of how far along a transfer is. */
  private note(id: string, at: number, bytes: number) {
    const list = this.samples.get(id) ?? []
    list.push({ at, bytes })
    // Four seconds' worth, and never more than that.
    while (list.length > 2 && at - list[0].at > 4000) list.shift()
    this.samples.set(id, list)
  }

  /** How fast it is going, over the last few seconds rather than the last tick. */
  private speedOf(id: string): number {
    const list = this.samples.get(id)
    if (!list || list.length < 2) return 0
    const first = list[0]
    const last = list[list.length - 1]
    const passed = last.at - first.at
    if (passed <= 0) return 0
    return Math.max(0, Math.round(((last.bytes - first.bytes) / passed) * 1000))
  }

  /** Bytes free where this file is going, or null when the disk will not say. */
  private async freeSpace(dir: string): Promise<number | null> {
    try {
      const info = await statfs(dir)
      return Number(info.bsize) * Number(info.bavail)
    } catch {
      return null
    }
  }

  private noRoom: ((name: string) => void) | null = null
  private done: ((row: DownloadItem) => void) | null = null
  private unpacked: ((name: string, files: number) => void) | null = null

  onUnpacked(unpacked: (name: string, files: number) => void) {
    this.unpacked = unpacked
  }

  /** Two things the window wants to say something about. */
  onTrouble(noRoom: (name: string) => void) {
    this.noRoom = noRoom
  }
  onDone(done: (row: DownloadItem) => void) {
    this.done = done
  }
  private emitNoRoom(name: string) {
    this.noRoom?.(name)
  }

  /**
   * After a file lands: its checksum, and whatever was asked to happen to it.
   * Both are slow enough to be worth doing off the path of the download
   * itself, and neither is allowed to fail loudly.
   */
  private async finish(id: string) {
    const row = this.items.get(id)
    if (!row?.path) return
    const hash = await this.hashOf(row.path)
    if (hash) {
      const current = this.items.get(id)
      if (current) this.items.set(id, { ...current, hash })
      this.publish()
      this.save()
    }
    // An archive is almost never wanted as an archive. Unpacked beside itself,
    // into a folder of its own name, so it never scatters loose files into the
    // downloads folder.
    if (settings.get().downloadUnzip && /\.zip$/i.test(row.path)) {
      const into = row.path.replace(/\.zip$/i, '')
      const result = unzip(row.path, into)
      if (result) this.unpacked?.(basename(into), result.files)
    }
    this.done?.(this.view(this.items.get(id) as Record))
  }

  /** The file's sha-256, read in a stream so a large one costs no memory. */
  private hashOf(path: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const hash = createHash('sha256')
        const stream = createReadStream(path)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('error', () => resolve(null))
        stream.on('end', () => resolve(hash.digest('hex')))
      } catch {
        resolve(null)
      }
    })
  }

  /** One row as the interface sees it — the record plus what it is doing now. */
  private view(row: Record): DownloadItem {
    const live = this.handles.get(row.id)
    const speed = live ? this.speedOf(row.id) : 0
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      path: row.path,
      received: row.received,
      total: row.total,
      state: row.state,
      startedAt: row.startedAt,
      speed,
      source: row.source,
      hash: row.hash,
      mime: row.mime,
      limit: Math.round((this.limits.get(row.id) ?? 0) / 1024),
      unasked: this.unasked.has(row.id),
      startsAt: this.later.get(row.id),
      resumable: row.state === 'interrupted' && Boolean(row.chain?.length && row.path)
    }
  }

  list(): DownloadItem[] {
    return [...this.items.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, KEEP)
      .map((row) => this.view(row))
  }

  /**
   * Everything, including what is still running.
   *
   * A transfer in flight is written down too, with how far it has got and
   * what Chromium needs to pick it back up. That is the whole point: a
   * browser that is closed — or that crashes — in the middle of a large file
   * should be able to carry on rather than start again. On the way back in,
   * anything that was moving is read as interrupted, because it is.
   */
  private save() {
    this.store.replace({
      items: [...this.items.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, KEEP)
    })
  }

  /** Written down at most this often while something is moving. */
  private savedAt = 0

  pause(id: string) {
    const handle = this.handles.get(id)
    if (!handle) return
    if (handle.isPaused()) {
      this.throttled.delete(id)
      this.queued.delete(id)
      this.meters.delete(id)
      handle.resume()
    } else {
      handle.pause()
      this.meters.delete(id)
    }
    const row = this.items.get(id)
    if (row) this.items.set(id, { ...row, state: this.stateOf(id, handle) })
    this.publish()
  }

  /** Everything at once, which is what a video call actually needs. */
  pauseAll(resume: boolean) {
    for (const [id, handle] of this.handles) {
      if (handle.getState() !== 'progressing') continue
      if (resume) {
        this.throttled.delete(id)
        this.queued.delete(id)
        if (handle.isPaused()) handle.resume()
      } else if (!handle.isPaused()) {
        handle.pause()
      }
      const row = this.items.get(id)
      if (row) this.items.set(id, { ...row, state: this.stateOf(id, handle) })
    }
    this.publish()
  }

  /** How fast this one download may go, in kilobytes a second. 0 lifts it. */
  setLimit(id: string, kbs: number) {
    if (kbs > 0) this.limits.set(id, Math.round(kbs) * 1024)
    else this.limits.delete(id)
    // A new ceiling is measured from now, not from whatever the file has
    // already taken — otherwise raising it does nothing for a minute.
    this.meters.delete(id)
    this.publish()
  }

  /** Not now: held until a moment, then queued like anything else. */
  setStart(id: string, at: number) {
    const handle = this.handles.get(id)
    if (!handle) return
    if (at > Date.now()) {
      this.later.set(id, at)
      this.queued.delete(id)
      if (!handle.isPaused()) handle.pause()
      const row = this.items.get(id)
      if (row) this.items.set(id, { ...row, state: 'queued' })
    } else {
      this.later.delete(id)
      this.queued.add(id)
    }
    this.publish()
    this.next()
  }

  /**
   * An interrupted transfer, picked up where it stopped. Chromium keeps the
   * half-written file and the offset; all this does is hand back what it needs
   * to carry on — which is why it works after the browser has been closed.
   */
  resume(id: string): boolean {
    const row = this.items.get(id)
    if (!row || !this.ses || row.state !== 'interrupted' || !row.chain?.length || !row.path) {
      return false
    }
    // Chromium will only pick up a file it can see, at exactly the offset it
    // is told. Anything else and it would silently start again from nothing.
    let onDisk = 0
    try {
      onDisk = statSync(row.path).size
    } catch {
      return false
    }
    if (onDisk === 0) return false
    /*
     * The file on disk is the truth, not the number in the list.
     *
     * The list is written down every few seconds; a browser that was closed
     * between two of those writes has more bytes on disk than it remembers.
     * Chromium writes a download sequentially, so the size of the file is
     * exactly how far it got — and telling it anything smaller makes it refuse
     * the resume outright.
     */
    const offset = row.total > 0 ? Math.min(onDisk, row.total) : onDisk
    try {
      this.resuming = { path: row.path, from: offset }
      this.ses.createInterruptedDownload({
        path: row.path,
        urlChain: row.chain,
        offset,
        length: row.total,
        lastModified: row.modified,
        eTag: row.etag,
        startTime: row.startedAt / 1000,
        mimeType: row.mime
      })
      this.items.delete(id)
      this.publish()
      /*
       * Carrying on is not always possible.
       *
       * A partial file can only be picked up where the server answers ranges
       * and the browser still recognises the half-written file as its own.
       * When either is not true, Chromium hands the transfer straight back as
       * interrupted, having asked for nothing. Rather than leave a button that
       * visibly does nothing, the file is then fetched again from the start —
       * which is slower, and is what every browser falls back to.
       */
      const url = row.chain[row.chain.length - 1] ?? row.url
      setTimeout(() => {
        const carried = [...this.items.values()].some(
          (other) => other.path === row.path && other.state !== 'interrupted'
        )
        if (carried) return
        for (const [otherId, other] of this.items) {
          if (other.path === row.path) this.items.delete(otherId)
        }
        this.publish()
        this.ses?.downloadURL(url)
      }, 2500)
      return true
    } catch {
      this.resuming = null
      return false
    }
  }

  cancel(id: string) {
    this.handles.get(id)?.cancel()
    this.later.delete(id)
    this.queued.delete(id)
    this.publish()
  }

  open(id: string) {
    const item = this.items.get(id)
    if (item?.state === 'completed' && item.path) void shell.openPath(item.path)
  }

  reveal(id: string) {
    const item = this.items.get(id)
    if (item?.path) shell.showItemInFolder(item.path)
  }

  /**
   * Where a finished file lies, for the preview protocol and for dragging it
   * out of the window. By id, never by a path from the renderer: the renderer
   * cannot ask for a file the browser did not download itself.
   */
  pathOf(id: string): string | null {
    const item = this.items.get(id)
    return item?.state === 'completed' && item.path ? item.path : null
  }

  /** The address a file came from, so it can be asked for again. */
  sourceOf(id: string): string | null {
    return this.items.get(id)?.url ?? null
  }

  remove(id: string) {
    this.handles.get(id)?.cancel()
    this.handles.delete(id)
    this.items.delete(id)
    this.limits.delete(id)
    this.later.delete(id)
    this.queued.delete(id)
    this.unasked.delete(id)
    this.meters.delete(id)
    this.publish()
    this.save()
  }

  clearFinished() {
    for (const [id, item] of this.items) {
      if (item.state !== 'progressing' && item.state !== 'paused' && item.state !== 'queued') {
        this.items.delete(id)
      }
    }
    this.publish()
    this.save()
  }

  async chooseFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Папка для загрузок',
      defaultPath: settings.get().downloadDir || app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  }

  flush() {
    this.save()
    this.store.flush()
  }

  private publish() {
    this.emit(this.list())
  }
}

export const downloads = new Downloads()
