import { useMemo, useState } from 'react'
import { t } from '../i18n'
import type { DownloadItem } from '../../../shared/types'
import { Cross, Download, Folder, Pause, Play, Reload, Search, Trash } from '../components/Icons'
import { EmptyState, formatBytes, formatDate } from '../components/ui'

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  progressing: 'загружается',
  paused: 'приостановлено',
  completed: 'готово',
  cancelled: 'отменено',
  interrupted: 'прервано'
}

/** Files a picture can be made of; everything else gets the plain icon. */
const PICTURES = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

export default function DownloadsPage({ items }: { items: DownloadItem[] }) {
  const [looking, setLooking] = useState('')
  const shown = useMemo(() => {
    const needle = looking.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle)
    )
  }, [items, looking])

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <header className="animate-fade-up mb-5 flex items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('Загрузки')}</h1>
            <p className="text-sm text-dim">{items.length} файлов в этой сессии</p>
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
          <button className="btn" onClick={() => window.browser.clearDownloads()}>
            <Trash width={15} height={15} />
            {t('Очистить список')}
          </button>
        </header>

        {shown.length === 0 ? (
          <EmptyState
            icon={<Download width={26} height={26} />}
            title={looking ? t('Ничего не найдено') : t('Загрузок пока нет')}
            hint={looking ? '' : t('Скачанные файлы появятся здесь.')}
          />
        ) : (
          <div className="card stagger overflow-hidden">
            {shown.map((item) => {
              const active = item.state === 'progressing' || item.state === 'paused'
              const pct = item.total > 0 ? Math.round((item.received / item.total) * 100) : 0
              return (
                <div key={item.id} className="px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="flex items-center gap-3">
                    {item.state === 'completed' && PICTURES.test(item.name) && (
                      <img
                        src={`nya-media://download/${encodeURIComponent(item.id)}`}
                        alt=""
                        className="h-[38px] w-[38px] shrink-0 rounded-[var(--radius-sm)] object-cover"
                        style={{ background: 'var(--field-idle)' }}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">{item.name}</span>
                      <span className="block truncate text-sm text-dim">
                        {t(STATE_LABEL[item.state])} · {formatBytes(item.received)}
                        {item.total > 0 ? ` ${t('из')} ${formatBytes(item.total)}` : ''}
                        {active && item.speed > 0 ? ` · ${formatBytes(item.speed)}${t('/с')}` : ''}
                        {!active ? ` · ${formatDate(item.startedAt)}` : ''}
                      </span>
                    </span>

                    {active && (
                      <button className="icon-btn" title={t('Пауза')} onClick={() => window.browser.pauseDownload(item.id)}>
                        {item.state === 'paused' ? <Play width={14} height={14} /> : <Pause width={14} height={14} />}
                      </button>
                    )}
                    {item.state === 'completed' && (
                      <>
                        <button className="btn h-[30px] px-3 text-sm" onClick={() => window.browser.openDownload(item.id)}>
                          {t('Открыть')}
                        </button>
                        <button className="icon-btn" title={t('Показать в папке')} onClick={() => window.browser.revealDownload(item.id)}>
                          <Folder width={14} height={14} />
                        </button>
                      </>
                    )}
                    {!active && (
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
                  </div>

                  {active && (
                    <div className="mt-2 h-[4px] overflow-hidden rounded-pill" style={{ background: 'var(--field-idle)' }}>
                      <div
                        className="h-full rounded-pill"
                        style={{
                          width: `${pct}%`,
                          background: 'var(--accent)',
                          transition: 'width var(--t-base) var(--ease-out)'
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
