import { useMemo, useState } from 'react'
import { t } from '../i18n'
import type { DownloadItem } from '../../../shared/types'
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Cross,
  Download,
  Folder,
  Pause,
  Play,
  Reload,
  Search,
  Trash
} from '../components/Icons'
import { EmptyState, Slider, cx, formatBytes, formatDate } from '../components/ui'

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  progressing: 'загружается',
  paused: 'приостановлено',
  queued: 'в очереди',
  completed: 'готово',
  cancelled: 'отменено',
  interrupted: 'прервано'
}

/** Files a picture can be made of; everything else gets the plain icon. */
const PICTURES = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

/**
 * What a list of downloads is actually looked through for. Not a taxonomy —
 * four questions people really ask: where is that picture, where is that video,
 * where is that document, where is that archive.
 */
const KINDS = {
  all: null,
  pictures: PICTURES,
  video: /\.(mp4|mkv|webm|mov|avi|m4v|mp3|m4a|flac|wav|ogg|opus)$/i,
  docs: /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|ods|epub|fb2|csv)$/i,
  archives: /\.(zip|rar|7z|tar|gz|bz2|xz|iso|dmg)$/i
} as const

type Kind = keyof typeof KINDS

export default function DownloadsPage({ items }: { items: DownloadItem[] }) {
  const [looking, setLooking] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [open, setOpen] = useState<string | null>(null)

  const counts = useMemo(() => {
    const out = { all: items.length } as Record<Kind, number>
    for (const key of Object.keys(KINDS) as Kind[]) {
      if (key === 'all') continue
      const pattern = KINDS[key] as RegExp
      out[key] = items.filter((item) => pattern.test(item.name)).length
    }
    return out
  }, [items])

  const shown = useMemo(() => {
    const needle = looking.trim().toLowerCase()
    const pattern = KINDS[kind]
    return items.filter((item) => {
      if (pattern && !pattern.test(item.name)) return false
      if (!needle) return true
      return (
        item.name.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle)
      )
    })
  }, [items, looking, kind])

  const busy = items.some((item) => item.state === 'progressing' || item.state === 'queued')
  const held = items.some((item) => item.state === 'paused')

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <header className="animate-fade-up mb-5 flex items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('Загрузки')}</h1>
            <p className="text-sm text-dim">
              {items.length} {t('файлов')}
            </p>
          </div>
          <label
            className="flex h-[34px] items-center gap-2 rounded-[var(--radius-md)] px-3"
            style={{ background: 'var(--field-idle)' }}
          >
            <Search width={14} height={14} className="text-faint" />
            <input
              value={looking}
              onChange={(event) => setLooking(event.target.value)}
              placeholder={t('Поиск')}
              className="w-[160px] bg-transparent text-sm outline-none"
            />
          </label>
          {/* One switch for everything that is running: the thing people reach
              for when a call starts, not a row of individual pauses. */}
          {(busy || held) && (
            <button className="btn" onClick={() => window.browser.pauseAllDownloads(!busy)}>
              {busy ? <Pause width={15} height={15} /> : <Play width={15} height={15} />}
              {busy ? t('Остановить всё') : t('Продолжить всё')}
            </button>
          )}
          <button className="btn" onClick={() => window.browser.clearDownloads()}>
            <Trash width={15} height={15} />
            {t('Очистить список')}
          </button>
        </header>

        {items.length > 0 && (
          <div className="animate-fade-up mb-4 flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', t('Все')],
                ['pictures', t('Картинки')],
                ['video', t('Видео и музыка')],
                ['docs', t('Документы')],
                ['archives', t('Архивы')]
              ] as Array<[Kind, string]>
            )
              .filter(([id]) => id === 'all' || counts[id] > 0)
              .map(([id, name]) => (
                <button
                  key={id}
                  className={cx(
                    'flex h-[28px] items-center gap-1.5 rounded-pill px-3 text-sm',
                    kind === id ? 'font-medium' : 'text-dim hover:text-ink'
                  )}
                  style={{
                    color: kind === id ? '#fff' : undefined,
                    background: kind === id ? 'var(--accent)' : 'var(--field-idle)',
                    transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
                  }}
                  onClick={() => setKind(id)}
                >
                  {name}
                  <span className="text-2xs tabular-nums opacity-70">{counts[id]}</span>
                </button>
              ))}
          </div>
        )}

        {shown.length === 0 ? (
          <EmptyState
            icon={<Download width={24} height={24} />}
            title={looking || kind !== 'all' ? t('Ничего не найдено') : t('Загрузок пока нет')}
            hint={looking || kind !== 'all' ? t('Попробуйте другой запрос или другой вид') : t('Скачанные файлы появятся здесь')}
          />
        ) : (
          <div className="card stagger overflow-hidden">
            {shown.map((item) => (
              <Row
                key={item.id}
                item={item}
                open={open === item.id}
                onToggle={() => setOpen(open === item.id ? null : item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- a row */

function Row({
  item,
  open,
  onToggle
}: {
  item: DownloadItem
  open: boolean
  onToggle: () => void
}) {
  const active = item.state === 'progressing' || item.state === 'paused' || item.state === 'queued'
  const pct = item.total > 0 ? Math.round((item.received / item.total) * 100) : 0
  const waiting = item.startsAt && item.startsAt > Date.now()

  return (
    <div className="px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="flex items-center gap-3">
        {item.state === 'completed' && PICTURES.test(item.name) && (
          <img
            src={`nya-media://download/${encodeURIComponent(item.id)}`}
            alt=""
            className="h-[38px] w-[38px] shrink-0 rounded-[var(--radius-sm)] object-cover"
            style={{ background: 'var(--field-idle)' }}
            /* A finished file can be dragged out of the window into a folder,
               a chat or an upload box — the browser hands the real file over,
               which is what every other drag on this machine does. */
            draggable={item.state === 'completed'}
            onDragStart={(event) => {
              event.preventDefault()
              void window.browser.dragDownload(item.id)
            }}
          />
        )}
        <span
          className="min-w-0 flex-1"
          draggable={item.state === 'completed'}
          onDragStart={(event) => {
            event.preventDefault()
            void window.browser.dragDownload(item.id)
          }}
        >
          <span className="block truncate text-base font-medium">{item.name}</span>
          <span className="block truncate text-sm text-dim">
            {item.unasked
              ? t('Страница начала загрузку сама')
              : waiting
                ? `⏱ ${new Date(item.startsAt as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : t(STATE_LABEL[item.state])}
            {' · '}
            {formatBytes(item.received)}
            {item.total > 0 ? ` ${t('из')} ${formatBytes(item.total)}` : ''}
            {item.state === 'progressing' && item.speed > 0
              ? ` · ${formatBytes(item.speed)}${t('/с')}`
              : ''}
            {!active ? ` · ${formatDate(item.startedAt)}` : ''}
          </span>
        </span>

        {item.unasked && (
          <button
            className="btn btn-primary h-[30px] px-3 text-sm"
            onClick={() => window.browser.allowDownload(item.id)}
          >
            {t('Разрешить')}
          </button>
        )}
        {!item.unasked && (item.state === 'progressing' || item.state === 'paused') && (
          <button
            className="icon-btn"
            title={t('Пауза')}
            onClick={() => window.browser.pauseDownload(item.id)}
          >
            {item.state === 'paused' ? <Play width={14} height={14} /> : <Pause width={14} height={14} />}
          </button>
        )}
        {/* An interrupted file that still has its half on disk is worth
            carrying on rather than fetching again from the top. */}
        {item.resumable && (
          <button
            className="btn h-[30px] px-3 text-sm"
            onClick={() => window.browser.resumeDownload(item.id)}
          >
            <Play width={13} height={13} />
            {t('Продолжить')}
          </button>
        )}
        {item.state === 'completed' && (
          <>
            <button
              className="btn h-[30px] px-3 text-sm"
              onClick={() => window.browser.openDownload(item.id)}
            >
              {t('Открыть')}
            </button>
            <button
              className="icon-btn"
              title={t('Показать в папке')}
              onClick={() => window.browser.revealDownload(item.id)}
            >
              <Folder width={14} height={14} />
            </button>
          </>
        )}
        {!active && !item.resumable && (
          <button
            className="icon-btn"
            title={t('Скачать снова')}
            onClick={() => window.browser.downloadAgain(item.id)}
          >
            <Reload width={14} height={14} />
          </button>
        )}
        <button
          className="icon-btn"
          title={active ? t('Отменить') : t('Убрать из списка')}
          onClick={() =>
            active ? window.browser.cancelDownload(item.id) : window.browser.removeDownload(item.id)
          }
        >
          <Cross width={14} height={14} />
        </button>
        <button className="icon-btn" title={t('Свойства')} onClick={onToggle}>
          <ChevronRight
            width={14}
            height={14}
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform var(--t-fast) var(--ease-out)'
            }}
          />
        </button>
      </div>

      {(item.state === 'progressing' || item.state === 'paused' || item.state === 'queued') && (
        <div
          className="mt-2 h-[4px] overflow-hidden rounded-pill"
          style={{ background: 'var(--field-idle)' }}
        >
          <div
            className="h-full rounded-pill"
            style={{
              width: `${pct}%`,
              background: item.state === 'queued' ? 'var(--line-strong)' : 'var(--accent)',
              transition: 'width var(--t-base) var(--ease-out)'
            }}
          />
        </div>
      )}

      {open && <Details item={item} />}
    </div>
  )
}

/**
 * Where a file came from, and what it is.
 *
 * The checksum is here because it is the only way to tell that the installer
 * on the disk is the installer the site published, and because looking it up
 * anywhere else means opening a terminal.
 */
function Details({ item }: { item: DownloadItem }) {
  const [copied, setCopied] = useState('')
  const copy = async (what: string, value: string) => {
    await window.browser.copyText(value)
    setCopied(what)
    window.setTimeout(() => setCopied(''), 1400)
  }
  const line = (label: string, value: string, key: string, mono = false) => (
    <div className="flex items-start gap-2">
      <span className="w-[92px] shrink-0 pt-[3px] text-2xs uppercase tracking-wider text-faint">
        {label}
      </span>
      <span
        className={cx('min-w-0 flex-1 break-all rounded-[8px] px-2.5 py-1.5 text-sm', mono && 'font-mono text-2xs')}
        style={{ background: 'var(--field-idle)' }}
      >
        {value}
      </span>
      <button className="icon-btn shrink-0" title={t('Копировать')} onClick={() => void copy(key, value)}>
        {copied === key ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
      </button>
    </div>
  )

  const running = item.state === 'progressing' || item.state === 'paused' || item.state === 'queued'

  return (
    <div className="animate-fade mt-3 flex flex-col gap-2">
      {line(t('Ссылка'), item.url, 'url')}
      {item.source && line(t('Со страницы'), item.source, 'source')}
      {item.path && line(t('Файл'), item.path, 'path')}
      {item.hash && line('SHA-256', item.hash, 'hash', true)}

      {running && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-[92px] shrink-0 text-2xs uppercase tracking-wider text-faint">
              {t('Скорость')}
            </span>
            <Slider
              value={item.limit ?? 0}
              min={0}
              max={20_480}
              step={256}
              width={200}
              format={(kb) => (kb === 0 ? t('без границ') : `${formatBytes(kb * 1024)}${t('/с')}`)}
              onChange={(kb) => void window.browser.limitDownload(item.id, kb)}
            />
          </div>
          {/* Not now, later — for a file that would eat the evening's line. */}
          <div className="flex items-center gap-2">
            <span className="w-[92px] shrink-0 text-2xs uppercase tracking-wider text-faint">
              {t('Начать')}
            </span>
            <input
              type="time"
              className="field focus-ring h-[30px] text-sm"
              style={{ width: 120 }}
              onChange={(event) => {
                const [h, m] = event.target.value.split(':').map(Number)
                if (Number.isNaN(h) || Number.isNaN(m)) return
                const when = new Date()
                when.setHours(h, m, 0, 0)
                // A time earlier than now means tomorrow, which is what
                // "start it at seven" means when it is nine in the evening.
                if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1)
                void window.browser.startDownloadAt(item.id, when.getTime())
              }}
            />
            {item.startsAt && item.startsAt > Date.now() && (
              <button
                className="btn h-[30px] px-3 text-sm"
                onClick={() => void window.browser.startDownloadAt(item.id, 0)}
              >
                <Clock width={13} height={13} />
                {t('Сейчас')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
