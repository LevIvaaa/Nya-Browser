import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { DownloadItem } from '../../../shared/types'
import { Cross, Folder, Pause, Play } from './Icons'
import { formatBytes } from './ui'

/**
 * What a download looks like while it is happening.
 *
 * Until now the only sign that a file was coming down was a dot on the menu
 * button: no name, no size, no way to pause without opening a page about it.
 * This is the plate every browser shows — it slides in when a download starts,
 * follows it, and gets out of the way on its own a few seconds after the last
 * one finishes.
 *
 * It does not replace the downloads page. Everything here is also there, and
 * the page is where you go for what happened yesterday.
 */
const KEEP_AFTER_DONE = 6000

/** The same words the downloads page uses, so one file never has two names. */
const STATE_LABEL: Record<DownloadItem['state'], string> = {
  progressing: 'загружается',
  paused: 'приостановлено',
  queued: 'в очереди',
  completed: 'готово',
  cancelled: 'отменено',
  interrupted: 'прервано'
}

export default function DownloadPlate({
  items,
  onOpenList
}: {
  items: DownloadItem[]
  onOpenList: () => void
}) {
  const [shown, setShown] = useState(false)
  const [hovered, setHovered] = useState(false)
  // Ids already seen, so the plate answers to a new download and not to the
  // progress of one it has already shown and been dismissed for.
  const seen = useRef<Set<string> | null>(null)
  const hideAt = useRef<number | null>(null)

  const busy = items.some(
    (item) => item.state === 'progressing' || item.state === 'paused' || item.state === 'queued'
  )
  /** A link is being dragged over the plate right now. */
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (seen.current === null) {
      // The first list is history, not news: the browser has just started.
      seen.current = new Set(items.map((item) => item.id))
      return
    }
    const fresh = items.filter((item) => !seen.current!.has(item.id))
    for (const item of fresh) seen.current!.add(item.id)
    if (fresh.length > 0) setShown(true)
  }, [items])

  // Away on its own once nothing is running — unless the pointer is on it,
  // which is the one moment when taking it away is certainly wrong.
  useEffect(() => {
    if (!shown || busy || hovered) {
      hideAt.current = null
      return
    }
    hideAt.current = Date.now() + KEEP_AFTER_DONE
    const timer = window.setTimeout(() => setShown(false), KEEP_AFTER_DONE)
    return () => window.clearTimeout(timer)
  }, [shown, busy, hovered])

  if (!shown) return null
  const recent = items.slice(0, 3)
  if (recent.length === 0) return null

  return (
    <div
      className="animate-slide-down fixed right-3 top-[46px] z-40 w-[340px] overflow-hidden rounded-[var(--radius)]"
      style={{
        background: 'var(--elevated)',
        backdropFilter: 'blur(24px) saturate(160%)',
        boxShadow: 'var(--shadow-lg)',
        border: `1px solid ${over ? 'var(--accent)' : 'var(--line)'}`,
        transition: 'border-color var(--t-fast) linear'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      /* A link dragged onto the plate is downloaded. It is the shortest way
         from "that file, over there" to "that file, on this machine", and
         every other browser has quietly had it for years. */
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const url =
          event.dataTransfer
            .getData('text/uri-list')
            .split(/\r?\n/)
            .map((line) => line.trim())
            // A uri-list may carry comments; the first real line is the link.
            .find((line) => line && !line.startsWith('#')) ||
          event.dataTransfer.getData('text/plain')
        if (url && /^https?:\/\//i.test(url.trim())) void window.browser.downloadUrl(url.trim())
      }}
    >
      <header className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
        <span className="flex-1 text-sm font-semibold">{t('Загрузки')}</span>
        <button className="icon-btn" title={t('Загрузки')} onClick={onOpenList}>
          <Folder width={14} height={14} />
        </button>
        <button className="icon-btn" title={t('Убрать из списка')} onClick={() => setShown(false)}>
          <Cross width={14} height={14} />
        </button>
      </header>

      {recent.map((item) => {
        const active =
          item.state === 'progressing' || item.state === 'paused' || item.state === 'queued'
        const pct = item.total > 0 ? Math.min(100, Math.round((item.received / item.total) * 100)) : 0
        return (
          <div key={item.id} className="px-3 py-2.5" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium"
                draggable={item.state === 'completed'}
                onDragStart={(event) => {
                  event.preventDefault()
                  void window.browser.dragDownload(item.id)
                }}
              >
                {item.name}
              </span>
              {item.unasked ? (
                <>
                  <button
                    className="btn btn-primary h-[26px] px-2 text-2xs"
                    onClick={() => window.browser.allowDownload(item.id)}
                  >
                    {t('Разрешить')}
                  </button>
                  <button
                    className="icon-btn"
                    title={t('Отменить')}
                    onClick={() => window.browser.cancelDownload(item.id)}
                  >
                    <Cross width={13} height={13} />
                  </button>
                </>
              ) : active ? (
                <>
                  <button
                    className="icon-btn"
                    title={t('Пауза')}
                    onClick={() => window.browser.pauseDownload(item.id)}
                  >
                    {item.state === 'progressing' ? (
                      <Pause width={13} height={13} />
                    ) : (
                      <Play width={13} height={13} />
                    )}
                  </button>
                  <button
                    className="icon-btn"
                    title={t('Отменить')}
                    onClick={() => window.browser.cancelDownload(item.id)}
                  >
                    <Cross width={13} height={13} />
                  </button>
                </>
              ) : item.state === 'completed' ? (
                <>
                  <button className="btn h-[26px] px-2 text-2xs" onClick={() => window.browser.openDownload(item.id)}>
                    {t('Открыть')}
                  </button>
                  <button
                    className="icon-btn"
                    title={t('Показать в папке')}
                    onClick={() => window.browser.revealDownload(item.id)}
                  >
                    <Folder width={13} height={13} />
                  </button>
                </>
              ) : (
                <span className="text-2xs text-dim">{t(STATE_LABEL[item.state])}</span>
              )}
            </div>

            {/* Said before the numbers, because it is the reason the numbers
                are not moving. */}
            {item.unasked && (
              <p className="mt-1.5 text-2xs" style={{ color: 'var(--warn)' }}>
                {t('Страница начала загрузку сама')}
              </p>
            )}

            {active && !item.unasked && (
              <>
                <div
                  className="mt-2 h-[3px] w-full overflow-hidden rounded-pill"
                  style={{ background: 'var(--field-idle)' }}
                >
                  <div
                    style={{
                      width: item.total > 0 ? `${pct}%` : '35%',
                      height: '100%',
                      borderRadius: 999,
                      background: 'var(--accent)',
                      opacity: item.state === 'paused' ? 0.5 : 1,
                      transition: 'width var(--t-base) var(--ease-out)'
                    }}
                  />
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-dim">
                  <span>{formatBytes(item.received)}</span>
                  {item.total > 0 && (
                    <span>
                      {t('из')} {formatBytes(item.total)}
                    </span>
                  )}
                  {item.state === 'progressing' && item.speed > 0 && (
                    <span className="ml-auto">
                      {formatBytes(item.speed)}
                      {t('/с')}
                    </span>
                  )}
                  {item.state !== 'progressing' && (
                    <span className="ml-auto">{t(STATE_LABEL[item.state])}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
