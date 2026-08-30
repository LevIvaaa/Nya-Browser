import { app, dialog, shell, type DownloadItem as ElectronDownload, type Session } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { settings } from './settings'
import type { DownloadItem } from '../shared/types'

type Emit = (items: DownloadItem[]) => void

/** Tracks downloads for the active session and exposes control over them. */
class Downloads {
  private items = new Map<string, DownloadItem>()
  private handles = new Map<string, ElectronDownload>()
  private emit: Emit = () => {}
  private lastTick = new Map<string, { at: number; bytes: number }>()

  onChange(emit: Emit) {
    this.emit = emit
  }

  attach(ses: Session) {
    ses.removeAllListeners('will-download')
    ses.on('will-download', (_event, item) => this.track(item))
  }

  private track(item: ElectronDownload) {
    const id = randomUUID()
    const s = settings.get()

    if (!s.askWhereToSave && s.downloadDir) {
      item.setSavePath(join(s.downloadDir, item.getFilename()))
    }

    const snapshot = (): DownloadItem => {
      const received = item.getReceivedBytes()
      const now = Date.now()
      const prev = this.lastTick.get(id)
      let speed = 0
      if (prev && now > prev.at) {
        speed = ((received - prev.bytes) / (now - prev.at)) * 1000
      }
      this.lastTick.set(id, { at: now, bytes: received })
      return {
        id,
        name: item.getFilename(),
        url: item.getURL(),
        path: item.getSavePath(),
        received,
        total: item.getTotalBytes(),
        state: item.getState() === 'progressing' && item.isPaused() ? 'paused' : item.getState(),
        startedAt: item.getStartTime() * 1000,
        speed: Math.max(0, Math.round(speed))
      }
    }

    this.handles.set(id, item)
    this.items.set(id, snapshot())
    this.publish()

    item.on('updated', () => {
      this.items.set(id, snapshot())
      this.publish()
    })
    item.once('done', () => {
      this.items.set(id, snapshot())
      this.handles.delete(id)
      this.lastTick.delete(id)
      this.publish()
    })
  }

  list(): DownloadItem[] {
    return [...this.items.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 100)
  }

  pause(id: string) {
    const handle = this.handles.get(id)
    if (!handle) return
    handle.isPaused() ? handle.resume() : handle.pause()
    this.publish()
  }

  cancel(id: string) {
    this.handles.get(id)?.cancel()
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

  remove(id: string) {
    this.handles.get(id)?.cancel()
    this.handles.delete(id)
    this.items.delete(id)
    this.publish()
  }

  clearFinished() {
    for (const [id, item] of this.items) {
      if (item.state !== 'progressing' && item.state !== 'paused') this.items.delete(id)
    }
    this.publish()
  }

  async chooseFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Папка для загрузок',
      defaultPath: settings.get().downloadDir || app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  }

  private publish() {
    this.emit(this.list())
  }
}

export const downloads = new Downloads()
